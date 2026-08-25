// 라이노 스크립트가 서버 기동 여부를 확인하는 데 쓴다.
// 외부 API 를 부르지 않으므로 응답이 즉시 온다.

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { ok: true, service: "aad" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
