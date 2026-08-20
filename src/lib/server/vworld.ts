// 브이월드 REST API 서버측 호출 헬퍼.
// CORS 때문에 브라우저 직접 호출이 막히므로 모든 검색·데이터 요청은 app/api/vworld/* 를 경유한다.
// 키 검증이 Referer 기반이라 등록 도메인을 Referer로 넣어 호출한다 (curl로 동작 확인됨).

const BASE = "https://api.vworld.kr/req";

function requireEnv(name: "VWORLD_API_KEY" | "VWORLD_DOMAIN"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}

export async function vworldFetch(
  path: "search" | "data",
  params: Record<string, string>,
): Promise<unknown> {
  const key = requireEnv("VWORLD_API_KEY");
  const domain = requireEnv("VWORLD_DOMAIN");

  const query = new URLSearchParams({
    key,
    format: "json",
    ...params,
  });

  const res = await fetch(`${BASE}/${path}?${query}`, {
    headers: { Referer: `http://${domain}:3000/` },
    // 지형·DEM이 아닌 검색/속성 조회지만, 보수적으로 캐싱하지 않는다 (B-5)
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`vworld ${path} API responded ${res.status}`);
  }
  return res.json();
}
