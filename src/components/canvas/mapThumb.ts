// viewport 노드 카드용 지도 스냅샷 (클라이언트 전용).
// 캡처 모듈과 같은 postRender 우회를 쓰되, 카드용이므로 축소 저장한다.

import { getViewer } from "@/lib/map/controller";

const THUMB_WIDTH = 320;

export function snapshotMapThumb(): Promise<string | null> {
  const viewer = getViewer();
  if (!viewer) return Promise.resolve(null);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      remove();
      resolve(null);
    }, 2000);
    const remove = viewer.scene.postRender.addEventListener(() => {
      clearTimeout(timeout);
      remove();
      try {
        const src = viewer.scene.canvas as HTMLCanvasElement;
        const scale = THUMB_WIDTH / src.width;
        const canvas = document.createElement("canvas");
        canvas.width = THUMB_WIDTH;
        canvas.height = Math.round(src.height * scale);
        canvas
          .getContext("2d")!
          .drawImage(src, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      } catch {
        resolve(null);
      }
    });
    viewer.scene.requestRender();
  });
}
