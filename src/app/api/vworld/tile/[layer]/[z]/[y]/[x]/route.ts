// 브이월드 2D WMTS 타일 프록시. 키를 클라이언트에 노출하지 않기 위해 서버를 경유한다.
// 기본지도 타일이며 DEM/지형이 아니므로 브라우저 캐시는 허용한다 (B-5).

const ALLOWED = new Set(["Base", "gray", "midnight", "Hybrid", "Satellite"]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ layer: string; z: string; y: string; x: string }> },
) {
  const { layer, z, y, x } = await params;
  const key = process.env.VWORLD_API_KEY;
  const domain = process.env.VWORLD_DOMAIN ?? "localhost";
  if (!key) return new Response("VWORLD_API_KEY missing", { status: 500 });
  if (!ALLOWED.has(layer) || ![z, y, x].every((v) => /^\d+$/.test(v))) {
    return new Response("bad tile request", { status: 400 });
  }
  const ext = layer === "Satellite" ? "jpeg" : "png";
  const upstream = await fetch(
    `https://api.vworld.kr/req/wmts/1.0.0/${key}/${layer}/${z}/${y}/${x}.${ext}`,
    { headers: { Referer: `http://${domain}:3000/` } },
  );
  if (!upstream.ok) return new Response("tile unavailable", { status: upstream.status });
  return new Response(await upstream.arrayBuffer(), {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? `image/${ext}`,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
