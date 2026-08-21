"use client";

import { useState } from "react";
import { useProjectStore } from "@/store/project";
import { capture2Pass } from "@/lib/map/capture";

function fmt(n: number, digits = 5): string {
  return n.toFixed(digits);
}

/** captureId를 주면 그 캡처를 고정 표시(노드 확장 뷰용), 없으면 최신 캡처 */
export default function CapturePanel({ captureId }: { captureId?: string }) {
  // 캡처 대상 = glb 모델 또는 활성 매스 대안
  const hasModel = useProjectStore(
    (s) => !!s.massing.placement || !!s.meta.activeScenarioId,
  );
  const captures = useProjectStore((s) => s.captures);
  const addCapture = useProjectStore((s) => s.addCapture);
  const removeCapture = useProjectStore((s) => s.removeCapture);

  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runCapture() {
    setCapturing(true);
    setError(null);
    try {
      addCapture(await capture2Pass());
    } catch (e) {
      setError(e instanceof Error ? e.message : "캡처 실패");
    } finally {
      setCapturing(false);
    }
  }

  const latest = captureId
    ? captures.find((c) => c.id === captureId)
    : captures[0];

  return (
    <section className="space-y-3">
      <h1 className="text-base font-bold text-zinc-900">캡처</h1>

      <button
        className="w-full rounded bg-blue-600 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        onClick={runCapture}
        disabled={!hasModel || capturing}
        data-testid="capture-button"
      >
        {capturing ? "캡처 중…" : "2패스 캡처"}
      </button>
      {!hasModel && (
        <p className="text-xs text-zinc-400">
          건물 glb를 올리거나 매스 대안을 활성화해야 캡처할 수 있습니다
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}

      {latest && (
        <div className="space-y-2" data-testid="capture-result">
          <div className="grid grid-cols-3 gap-1">
            {(
              [
                ["뷰티", latest.beauty, "beauty"],
                ["실루엣", latest.silhouette, "silhouette"],
                ["마스크", latest.mask, "mask"],
              ] as const
            ).map(([label, url, key]) => (
              <figure key={key} className="space-y-1">
                {/* dataURL 미리보기라 next/image 대상 아님 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={label}
                  className={`w-full rounded border border-zinc-200 ${
                    key === "mask" ? "bg-[repeating-conic-gradient(#e4e4e7_0%_25%,white_0%_50%)] bg-[length:12px_12px]" : ""
                  }`}
                  data-testid={`capture-img-${key}`}
                />
                <figcaption className="flex items-center justify-between text-[10px] text-zinc-500">
                  {label}
                  <a
                    href={url}
                    download={`${key}-${latest.createdAt.replace(/[:.]/g, "-")}.png`}
                    className="text-blue-600 hover:underline"
                  >
                    다운로드
                  </a>
                </figcaption>
              </figure>
            ))}
          </div>
          <div className="rounded bg-zinc-50 p-2 text-[10px] leading-relaxed text-zinc-500">
            <p data-testid="capture-camera">
              카메라 {fmt(latest.camera.lon)}, {fmt(latest.camera.lat)} · 고도{" "}
              {latest.camera.height.toFixed(0)}m
            </p>
            <p>
              heading {latest.camera.heading.toFixed(1)}° · pitch{" "}
              {latest.camera.pitch.toFixed(1)}°
            </p>
            <p>
              태양시각 {new Date(latest.clockTime).toLocaleString("ko-KR")} ·
              캡처 {new Date(latest.createdAt).toLocaleTimeString("ko-KR")}
            </p>
          </div>
          {captures.length > 1 && (
            <p className="text-[10px] text-zinc-400">
              이전 캡처 {captures.length - 1}건 보관 중
            </p>
          )}
          <button
            className="text-xs text-zinc-400 hover:text-red-600"
            onClick={() => removeCapture(latest.id)}
          >
            이 캡처 삭제
          </button>
        </div>
      )}
    </section>
  );
}
