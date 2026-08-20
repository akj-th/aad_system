import CanvasView from "@/components/canvas/CanvasView";
import SetMapLayer from "@/components/SetMapLayer";

export default function Home() {
  if (!process.env.VWORLD_API_KEY) {
    return (
      <div className="flex h-screen w-full items-center justify-center p-8 text-center">
        <p className="text-lg text-zinc-700">
          .env.local에 VWORLD_API_KEY를 설정한 뒤 dev 서버를 재시작하세요.
        </p>
      </div>
    );
  }

  // 메인 화면 = 노드 캔버스. 지도는 MapHost(레이아웃)가 들고 있고
  // 노드 확장 뷰에서만 overlay로 올라온다.
  return (
    <>
      <SetMapLayer layer="hidden" />
      <div className="fixed inset-0 z-10 bg-zinc-50">
        <CanvasView />
      </div>
    </>
  );
}
