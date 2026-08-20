import { vworldFetch } from "@/lib/server/vworld";

export interface SearchResultItem {
  title: string;
  roadAddr: string;
  parcelAddr: string;
  lon: number;
  lat: number;
}

interface VworldSearchItem {
  title?: string;
  address?: { road?: string; parcel?: string };
  point?: { x: string; y: string };
}

interface VworldSearchResponse {
  response?: {
    status?: string;
    result?: { items?: VworldSearchItem[] };
  };
}

async function search(
  q: string,
  type: "address" | "place",
  category?: "ROAD" | "PARCEL",
): Promise<SearchResultItem[]> {
  const params: Record<string, string> = {
    service: "search",
    request: "search",
    version: "2.0",
    crs: "EPSG:4326",
    size: "5",
    query: q,
    type,
    errorformat: "json",
  };
  if (category) params.category = category;

  const json = (await vworldFetch("search", params)) as VworldSearchResponse;
  const items = json.response?.result?.items ?? [];
  return items
    .filter((it) => it.point?.x && it.point?.y)
    .map((it) => ({
      title: it.title ?? it.address?.road ?? it.address?.parcel ?? "",
      roadAddr: it.address?.road ?? "",
      parcelAddr: it.address?.parcel ?? "",
      lon: Number(it.point!.x),
      lat: Number(it.point!.y),
    }));
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q) {
    return Response.json({ error: "q parameter is required" }, { status: 400 });
  }

  try {
    // 지번·도로명 주소를 우선하고, 둘 다 없으면 장소 검색으로 보완한다
    const [parcel, road] = await Promise.all([
      search(q, "address", "PARCEL"),
      search(q, "address", "ROAD"),
    ]);
    let items = [...parcel, ...road];
    if (items.length === 0) items = await search(q, "place");

    // 좌표 기준 중복 제거
    const seen = new Set<string>();
    items = items.filter((it) => {
      const k = `${it.lon.toFixed(6)},${it.lat.toFixed(6)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    return Response.json({ items: items.slice(0, 10) });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "search failed" },
      { status: 502 },
    );
  }
}
