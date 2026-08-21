"use client";

// 다이어그램·영상 (M10). 다이어그램은 상태에서 결정론 생성, 영상은 3D 뷰 플라이어라운드 녹화.

import { useState } from "react";
import { centroid } from "@turf/turf";
import { useProjectStore } from "@/store/project";
import { costDonutSvg, massCompareSvg, useStackSvg } from "@/lib/media/diagrams";
import { canRecord, recordOrbit } from "@/lib/media/record";

function SvgCard({ title, svg }: { title: string; svg: string }) {
  function download() {
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${title}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-zinc-700">{title}</span>
        <button className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] hover:bg-zinc-200" onClick={download}>
          SVG
        </button>
      </div>
      <div
        className="overflow-hidden rounded border border-zinc-200"
        dangerouslySetInnerHTML={{ __html: svg.replace("<svg ", '<svg style="width:100%;height:auto;display:block" ') }}
        data-testid={`diagram-${title}`}
      />
    </div>
  );
}

export default function MediaPanel() {
  const exportProject = useProjectStore((s) => s.exportProject);
  const snapshot = exportProject();
  const active = snapshot.massing.scenarios.find((s) => s.id === snapshot.meta.activeScenarioId);
  const placement = snapshot.massing.placement;

  const [seconds, setSeconds] = useState(8);
  const [recording, setRecording] = useState(false);
  const [progress, setProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 궤도 중심: 활성 매스 → glb 배치 → 대지 중심
  function orbitTarget() {
    if (active?.footprint) {
      const c = centroid({ type: "Feature", properties: {}, geometry: active.footprint }).geometry.coordinates;
      const h = active.height ?? 20;
      return { lon: c[0], lat: c[1], height: h / 2, range: Math.max(120, h * 3) };
    }
    if (placement) return { lon: placement.lon, lat: placement.lat, height: 20, range: 160 };
    if (snapshot.site.boundary) {
      const c = centroid({ type: "Feature", properties: {}, geometry: snapshot.site.boundary }).geometry.coordinates;
      return { lon: c[0], lat: c[1], height: 10, range: 150 };
    }
    return null;
  }

  async function record() {
    const target = orbitTarget();
    if (!target) {
      setError("대지·매스·건물 중 하나가 있어야 녹화할 수 있습니다");
      return;
    }
    setRecording(true);
    setError(null);
    setProgress(0);
    try {
      const blob = await recordOrbit({ target, seconds, onProgress: setProgress });
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e instanceof Error ? e.message : "녹화 실패");
    } finally {
      setRecording(false);
    }
  }

  return (
    <section className="space-y-4">
      <h1 className="text-base font-bold text-zinc-900">다이어그램 · 영상</h1>

      <SvgCard title="용도 구성" svg={useStackSvg(snapshot)} />
      <SvgCard title="매스 대안 비교" svg={massCompareSvg(snapshot)} />
      <SvgCard title="사업비 구성" svg={costDonutSvg(snapshot)} />

      <div className="space-y-2 rounded bg-zinc-50 p-3 text-xs">
        <p className="font-semibold text-zinc-700">플라이어라운드 영상 (3D 뷰 녹화)</p>
        {!canRecord() ? (
          <p className="text-zinc-400">이 브라우저는 캔버스 녹화를 지원하지 않습니다</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">길이</span>
              {[6, 8, 12].map((s) => (
                <button
                  key={s}
                  className={`rounded px-2 py-0.5 ${seconds === s ? "bg-blue-600 text-white" : "bg-white shadow-sm"}`}
                  onClick={() => setSeconds(s)}
                >
                  {s}s
                </button>
              ))}
              <button
                className="ml-auto rounded bg-rose-600 px-3 py-1 text-white hover:bg-rose-700 disabled:opacity-50"
                onClick={record}
                disabled={recording}
                data-testid="media-record"
              >
                {recording ? `녹화 중 ${Math.round(progress * 100)}%` : "● 녹화"}
              </button>
            </div>
            <p className="text-[10px] text-zinc-400">
              활성 매스(없으면 glb·대지) 중심으로 카메라가 한 바퀴 돕니다. 녹화 중엔 지도를 조작하지 마세요.
            </p>
            {error && <p className="text-red-600">{error}</p>}
            {videoUrl && (
              <div className="space-y-1" data-testid="media-video">
                <video src={videoUrl} controls className="w-full rounded border border-zinc-200" />
                <a href={videoUrl} download="flyaround.webm" className="text-blue-600 hover:underline">
                  WebM 다운로드
                </a>
              </div>
            )}
          </>
        )}
      </div>

      <p className="border-t border-zinc-200 pt-2 text-[10px] font-medium text-amber-700">
        다이어그램은 현재 상태의 결정론 산출물 · 영상은 브이월드 3D 기반(배경 건물은 실데이터)
      </p>
    </section>
  );
}
