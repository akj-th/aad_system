// 여러 필지의 건축물대장 정보를 한 번에 조회 — 라이노 주변 건물 매스 생성용.
// 필지마다 landinfo 를 부르면 왕복이 너무 많아 서버에서 병렬로 묶는다.

const NED_BASE = "https://api.vworld.kr/ned/data";
const MAX_PNUS = 120;
const CONCURRENCY = 12;

export interface BuildingBrief {
  pnu: string;
  /** 지상 층수 */
  floors: number | null;
  /** 대장 높이(m). 없으면 층수로 추정한다 */
  height: number | null;
  mainUse: string;
  structure: string;
  buildingArea: number | null;
  approvedAt: string | null;
}

interface BuildingRecord {
  buldNm?: string;
  mainPrposCodeNm?: string;
  strctCodeNm?: string;
  buldBildngAr?: string;
  groundFloorCo?: string;
  buldHg?: string;
  useConfmDe?: string;
}

const num = (v?: string): number | null =>
  v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;

async function fetchBuilding(pnu: string, key: string, domain: string): Promise<BuildingBrief | null> {
  const query = new URLSearchParams({ key, format: "json", pnu, numOfRows: "10" });
  try {
    const res = await fetch(`${NED_BASE}/getBuildingUse?${query}`, {
      headers: { Referer: `http://${domain}:3000/` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { buildingUses?: { field?: BuildingRecord[] } };
    const rows = json.buildingUses?.field ?? [];
    if (!rows.length) return null;
    // 한 필지에 여러 동이면 가장 큰(높은) 것을 대표로 쓴다
    const best = rows.reduce((a, b) =>
      (num(b.buldHg) ?? num(b.groundFloorCo) ?? 0) > (num(a.buldHg) ?? num(a.groundFloorCo) ?? 0) ? b : a,
    );
    const floors = num(best.groundFloorCo);
    const rawHeight = num(best.buldHg);
    // 대장 높이가 없거나 0으로 기재된 경우가 흔하다 (실측: 13층 아파트가 0m)
    // — 그럴 때는 층당 3.3m 로 추정한다
    const height =
      rawHeight != null && rawHeight > 0
        ? rawHeight
        : floors != null && floors > 0
          ? floors * 3.3
          : null;
    return {
      pnu,
      floors,
      height,
      mainUse: best.mainPrposCodeNm ?? "",
      structure: best.strctCodeNm ?? "",
      buildingArea: num(best.buldBildngAr),
      approvedAt: best.useConfmDe
        ? best.useConfmDe.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")
        : null,
    };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("pnus") ?? "";
  const pnus = [...new Set(raw.split(",").map((p) => p.trim()).filter((p) => /^\d{19}$/.test(p)))];
  if (!pnus.length) {
    return Response.json({ error: "pnus=<19자리 PNU 목록, 콤마 구분> required" }, { status: 400 });
  }
  if (pnus.length > MAX_PNUS) {
    return Response.json(
      { error: `PNU 는 한 번에 ${MAX_PNUS}개까지 (요청 ${pnus.length}개)` },
      { status: 400 },
    );
  }

  const key = process.env.VWORLD_API_KEY;
  const domain = process.env.VWORLD_DOMAIN ?? "localhost";
  if (!key) return Response.json({ error: "VWORLD_API_KEY is not set" }, { status: 500 });

  const buildings: BuildingBrief[] = [];
  for (let i = 0; i < pnus.length; i += CONCURRENCY) {
    const batch = pnus.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((p) => fetchBuilding(p, key, domain)));
    for (const r of results) if (r) buildings.push(r);
  }

  return Response.json({ requested: pnus.length, found: buildings.length, buildings });
}
