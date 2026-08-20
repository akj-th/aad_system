import MapViewport from "@/components/MapViewport";
import SitePanel from "@/components/SitePanel";

export default function Home() {
  const apiKey = process.env.VWORLD_API_KEY;

  if (!apiKey) {
    return (
      <div className="flex h-screen w-full items-center justify-center p-8 text-center">
        <p className="text-lg text-zinc-700">
          .env.local에 VWORLD_API_KEY를 설정한 뒤 dev 서버를 재시작하세요.
        </p>
      </div>
    );
  }

  // 브이월드 초기화 스크립트는 내부에서 document.write로 하위 스크립트를 로드하므로
  // next/script(비동기)가 아니라 파서 블로킹 <script>로 로드해야 한다.
  // 지도용 인증키는 URL에 포함되는 구조라 클라이언트 노출이 불가피하며, 도메인 등록으로 보호된다.
  const scriptSrc = `https://map.vworld.kr/js/webglMapInit.js.do?version=3.0&apiKey=${encodeURIComponent(apiKey)}`;

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-sync-scripts -- document.write 기반 로더라 동기 로드 필수 */}
      <script src={scriptSrc} />
      <div className="flex h-screen w-full overflow-hidden">
        <SitePanel />
        <div className="min-w-0 flex-1">
          <MapViewport />
        </div>
      </div>
    </>
  );
}
