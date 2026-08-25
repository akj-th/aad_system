// 지형 고도(DEM) 격자 조회 — 브이월드 XDServer 3D 데이터 경유.
//
// 포맷(런타임 introspection으로 확인): 타일당 65×65 float32(LE) = 16,900바이트,
// heightScale 1 / offset 0 이므로 값이 곧 미터. 타일 스킴은 level 0에 10×5,
// 전 지구(-180~180, -90~90), 최대 레벨 15(약 1.5m 간격).
// IDY는 남쪽(-90)에서 위로 센다.
//
// XDServer 는 REST 키가 아니라 3D 전용 토큰을 요구한다 —
// selectApiKeyJson.do 로 발급받아 프로세스 메모리에만 둔다.
//
// B-5 절대 규칙: DEM 데이터는 서버에 저장·캐싱하지 않는다. 받아서 바로 전달하고 버린다.
// (토큰만 메모리에 캐시한다 — 지형 데이터가 아니다)

const TILE = 65;
const MAX_LEVEL = 15;
const TILE_BYTES = TILE * TILE * 4;
const MAX_TILES = 64; // 요청당 상한 — 넘으면 레벨을 낮춘다
const MAX_GRID = 400; // 반환 격자 한 변 상한 (400×400 = 16만 점)

let cachedToken: { value: string; at: number } | null = null;
const TOKEN_TTL_MS = 30 * 60 * 1000;

async function get3dToken(): Promise<string> {
  if (cachedToken && Date.now() - cachedToken.at < TOKEN_TTL_MS) return cachedToken.value;
  const key = process.env.VWORLD_API_KEY;
  const domain = process.env.VWORLD_DOMAIN ?? "localhost";
  if (!key) throw new Error("VWORLD_API_KEY is not set");
  const res = await fetch(
    `http://map.vworld.kr/dtkmap/selectApiKeyJson.do?apiKey=${key}&output=json`,
    { headers: { Referer: `http://${domain}:3000/` }, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`3D 토큰 발급 실패 (HTTP ${res.status})`);
  const json = (await res.json()) as { apiKey?: string };
  if (!json.apiKey) throw new Error("3D 토큰이 응답에 없습니다");
  cachedToken = { value: json.apiKey, at: Date.now() };
  return json.apiKey;
}

function tilesAtLevel(level: number) {
  return { nx: 10 * 2 ** level, ny: 5 * 2 ** level };
}

/** 요청 범위에 대해 타일 수 상한을 지키는 최대 레벨 */
function pickLevel(west: number, south: number, east: number, north: number, wanted: number) {
  for (let level = Math.min(wanted, MAX_LEVEL); level >= 0; level--) {
    const { nx, ny } = tilesAtLevel(level);
    const x0 = Math.floor(((west + 180) / 360) * nx);
    const x1 = Math.floor(((east + 180) / 360) * nx);
    const y0 = Math.floor(((south + 90) / 180) * ny);
    const y1 = Math.floor(((north + 90) / 180) * ny);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= MAX_TILES) return level;
  }
  return 0;
}

async function fetchTile(level: number, idx: number, idy: number, token: string, domain: string) {
  const sub = ["xdworld", "xdworld1", "xdworld2", "xdworld3"][(idx + idy) % 4];
  const url =
    `https://${sub}.vworld.kr/XDServer/3DData?Version=2.0.0.0&Request=GetLayer&Layer=dem` +
    `&Level=${level}&IDX=${idx}&IDY=${idy}&Key=${encodeURIComponent(token)}`;
  const res = await fetch(url, { headers: { Referer: `http://${domain}:3000/` }, cache: "no-store" });
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  return buf.byteLength === TILE_BYTES ? new DataView(buf) : null;
}

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const bbox = (sp.get("bbox") ?? "").split(",").map(Number);
  if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v))) {
    return Response.json({ error: "bbox=minLon,minLat,maxLon,maxLat required" }, { status: 400 });
  }
  const [west, south, east, north] = bbox;
  // 격자 한 변 개수 (라이노 메시 밀도) — 상한을 둬서 과도한 요청을 막는다
  const grid = Math.max(2, Math.min(MAX_GRID, parseInt(sp.get("grid") ?? "129", 10) || 129));
  const wantedLevel = parseInt(sp.get("level") ?? String(MAX_LEVEL), 10);

  try {
    const domain = process.env.VWORLD_DOMAIN ?? "localhost";
    const token = await get3dToken();
    const level = pickLevel(west, south, east, north, wantedLevel);
    const { nx, ny } = tilesAtLevel(level);
    const x0 = Math.floor(((west + 180) / 360) * nx);
    const x1 = Math.floor(((east + 180) / 360) * nx);
    const y0 = Math.floor(((south + 90) / 180) * ny);
    const y1 = Math.floor(((north + 90) / 180) * ny);

    // 필요한 타일을 병렬로 받는다 (저장하지 않고 메모리에서 바로 소비)
    const jobs: Promise<void>[] = [];
    const tiles = new Map<string, DataView>();
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        jobs.push(
          fetchTile(level, tx, ty, token, domain).then((dv) => {
            if (dv) tiles.set(`${tx}/${ty}`, dv);
          }),
        );
      }
    }
    await Promise.all(jobs);

    // 타일 격자에서 요청 격자로 샘플링 (최근접)
    const tileLonSpan = 360 / nx;
    const tileLatSpan = 180 / ny;
    const heights: number[] = new Array(grid * grid);
    let min = Infinity;
    let max = -Infinity;
    let missing = 0;
    for (let r = 0; r < grid; r++) {
      const lat = south + ((north - south) * r) / (grid - 1);
      const ty = Math.min(y1, Math.max(y0, Math.floor(((lat + 90) / 180) * ny)));
      // 타일 내 행 (남→북이 위로 증가한다고 보고 아래에서부터)
      const latInTile = (lat + 90 - ty * tileLatSpan) / tileLatSpan;
      const row = Math.min(TILE - 1, Math.max(0, Math.round(latInTile * (TILE - 1))));
      for (let c = 0; c < grid; c++) {
        const lon = west + ((east - west) * c) / (grid - 1);
        const tx = Math.min(x1, Math.max(x0, Math.floor(((lon + 180) / 360) * nx)));
        const lonInTile = (lon + 180 - tx * tileLonSpan) / tileLonSpan;
        const col = Math.min(TILE - 1, Math.max(0, Math.round(lonInTile * (TILE - 1))));
        const dv = tiles.get(`${tx}/${ty}`);
        let h = 0;
        if (dv) {
          // 타일 데이터는 위(북)에서 아래로 저장된다 — 행을 뒤집어 읽는다
          const srcRow = TILE - 1 - row;
          h = dv.getFloat32((srcRow * TILE + col) * 4, true);
          if (!Number.isFinite(h)) h = 0;
        } else {
          missing++;
        }
        heights[r * grid + c] = Math.round(h * 100) / 100;
        if (h < min) min = h;
        if (h > max) max = h;
      }
    }

    return Response.json({
      bbox: [west, south, east, north],
      grid,
      level,
      tiles: tiles.size,
      missing,
      // 남→북, 서→동 순서 (row-major). 라이노에서 그대로 메시로 쓴다
      heights,
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) ? max : 0,
      note: "브이월드 DEM — 저장·재배포 금지, 실시간 조회만",
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "elevation lookup failed" },
      { status: 502 },
    );
  }
}
