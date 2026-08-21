// 플라이어라운드 영상 녹화 (M10). Cesium 캔버스를 MediaRecorder로 담는다.
// 뷰어가 requestRenderMode라 매 프레임 requestRender를 직접 호출한다.

import { getViewer } from "@/lib/map/controller";

export interface OrbitTarget {
  lon: number;
  lat: number;
  /** 타깃 높이(지형 위 m) — 건물 중간 높이 정도 */
  height: number;
  /** 카메라 거리(m) */
  range: number;
}

export interface RecordOptions {
  target: OrbitTarget;
  seconds: number;
  fps?: number;
  pitchDeg?: number;
  onProgress?: (ratio: number) => void;
}

export function canRecord(): boolean {
  return typeof MediaRecorder !== "undefined" && !!getViewer()?.scene?.canvas?.captureStream;
}

export function recordOrbit(opts: RecordOptions): Promise<Blob> {
  const viewer = getViewer();
  if (!viewer) return Promise.reject(new Error("viewer not ready"));
  const fps = opts.fps ?? 30;
  const canvas = viewer.scene.canvas as HTMLCanvasElement;
  const stream = canvas.captureStream(fps);
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) =>
    MediaRecorder.isTypeSupported(m),
  );
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const center = Cesium.Cartesian3.fromDegrees(opts.target.lon, opts.target.lat, opts.target.height);
  const pitch = Cesium.Math.toRadians(opts.pitchDeg ?? -25);
  const total = opts.seconds * 1000;

  return new Promise((resolve, reject) => {
    recorder.onerror = () => reject(new Error("MediaRecorder error"));
    recorder.onstop = () => {
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      resolve(new Blob(chunks, { type: mime ?? "video/webm" }));
    };
    const start = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / total);
      viewer.camera.lookAt(center, new Cesium.HeadingPitchRange(t * Math.PI * 2, pitch, opts.target.range));
      viewer.scene.requestRender();
      opts.onProgress?.(t);
      if (t < 1) requestAnimationFrame(tick);
      else setTimeout(() => recorder.stop(), 120);
    };
    recorder.start(200);
    requestAnimationFrame(tick);
  });
}
