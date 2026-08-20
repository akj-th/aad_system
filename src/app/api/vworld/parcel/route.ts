import { vworldFetch } from "@/lib/server/vworld";
import type { SiteGeometry } from "@/types/project";

export interface ParcelFeature {
  pnu: string;
  jibun: string;
  addr: string;
  jiga: number | null;
  geometry: SiteGeometry;
}

interface VworldDataResponse {
  response?: {
    status?: string;
    result?: {
      featureCollection?: {
        features?: {
          geometry: SiteGeometry;
          properties: {
            pnu?: string;
            jibun?: string;
            addr?: string;
            jiga?: string;
          };
        }[];
      };
    };
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lon = Number(searchParams.get("lon"));
  const lat = Number(searchParams.get("lat"));
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return Response.json(
      { error: "lon and lat parameters are required" },
      { status: 400 },
    );
  }

  try {
    const json = (await vworldFetch("data", {
      service: "data",
      request: "GetFeature",
      version: "2.0",
      data: "LP_PA_CBND_BUBUN", // 연속지적도
      geomfilter: `POINT(${lon} ${lat})`,
      crs: "EPSG:4326",
      geometry: "true",
      attribute: "true",
      size: "1",
      errorformat: "json",
    })) as VworldDataResponse;

    const feature = json.response?.result?.featureCollection?.features?.[0];
    if (!feature) {
      return Response.json({ parcel: null });
    }

    const p = feature.properties;
    const parcel: ParcelFeature = {
      pnu: p.pnu ?? "",
      jibun: p.jibun ?? "",
      addr: p.addr ?? "",
      jiga: p.jiga ? Number(p.jiga) : null,
      geometry: feature.geometry,
    };
    return Response.json({ parcel });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "parcel lookup failed" },
      { status: 502 },
    );
  }
}
