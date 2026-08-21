// 화면 범위(bbox) 안의 연속지적도 필지 벡터 조회 — 2D 필지 선택 지도용.
import { vworldFetch } from "@/lib/server/vworld";

const MAX_SPAN_DEG = 0.025; // 약 2km — 과도한 범위 요청 방지 (z17 화면 기준, size 1000 상한)

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("bbox");
  const bbox = raw?.split(",").map(Number) ?? [];
  if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v))) {
    return Response.json({ error: "bbox=minLon,minLat,maxLon,maxLat required" }, { status: 400 });
  }
  const [minLon, minLat, maxLon, maxLat] = bbox;
  if (maxLon - minLon > MAX_SPAN_DEG || maxLat - minLat > MAX_SPAN_DEG) {
    return Response.json({ error: "bbox too large — zoom in", tooLarge: true }, { status: 400 });
  }

  try {
    const json = (await vworldFetch("data", {
      service: "data",
      request: "GetFeature",
      version: "2.0",
      data: "LP_PA_CBND_BUBUN",
      geomfilter: `BOX(${minLon},${minLat},${maxLon},${maxLat})`,
      crs: "EPSG:4326",
      geometry: "true",
      attribute: "true",
      size: "1000",
      errorformat: "json",
    })) as {
      response?: { status?: string; result?: { featureCollection?: unknown } };
    };
    const fc = json.response?.result?.featureCollection ?? {
      type: "FeatureCollection",
      features: [],
    };
    return Response.json(fc);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "parcels lookup failed" },
      { status: 502 },
    );
  }
}
