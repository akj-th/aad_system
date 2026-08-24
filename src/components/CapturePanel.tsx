"use client";

import { useState } from "react";
import { useProjectStore } from "@/store/project";
import { capture2Pass } from "@/lib/map/capture";
import {
  getBuildingsVisible,
  setBuildingsVisible,
  setViewpoint,
  VIEWPOINTS,
  type ViewpointKind,
} from "@/lib/map/controller";
import { bbox, centroid } from "@turf/turf";

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
  const [busyView, setBusyView] = useState<ViewpointKind | null>(null);

  // 시점 이동 대상 = 활성 매스 → glb 배치 → 대지 중심
  // (객체를 돌려주는 셀렉터는 매 렌더마다 새 참조가 되므로 원시 조각으로 받아 계산한다)
  const activeMass = useProjectStore((s) =>
    s.massing.scenarios.find((x) => x.id === s.meta.activeScenarioId),
  );
  const placement = useProjectStore((s) => s.massing.placement);
  const boundary = useProjectStore((s) => s.site.boundary);

  let target: {
    lon: number;
    lat: number;
    height: number;
    footprintRadius?: number;
  } | null = null;
  if (activeMass?.footprint) {
    const feature = { type: "Feature" as const, properties: {}, geometry: activeMass.footprint };
    const c = centroid(feature).geometry.coordinates;
    // 바닥 bbox 대각선의 절반 = 외접 반경 근사
    const [minLon, minLat, maxLon, maxLat] = bbox(feature);
    const w = (maxLon - minLon) * 111_320 * Math.cos((c[1] * Math.PI) / 180);
    const d = (maxLat - minLat) * 111_320;
    target = {
      lon: c[0],
      lat: c[1],
      height: activeMass.height ?? 20,
      footprintRadius: Math.hypot(w, d) / 2,
    };
  } else if (placement) {
    target = { lon: placement.lon, lat: placement.lat, height: 20 };
  } else if (boundary) {
    const c = centroid({ type: "Feature", properties: {}, geometry: boundary })
      .geometry.coordinates;
    target = { lon: c[0], lat: c[1], height: 15 };
  }

  /** 프리셋 시점으로 이동 후 그 자리에서 2패스 캡처 (이미지 변환이 아니라 실제 재촬영) */
  async function captureFrom(kind: ViewpointKind) {
    if (!target) return;
    setBusyView(kind);
    setError(null);
    // 저층 시점은 도심에서 옆 건물에 가려진다 — 그 시점에서만 주변 건물을 잠시 숨긴다
    const lowAngle = kind === "street" || kind === "detail";
    const buildingsWere = getBuildingsVisible();
    try {
      if (lowAngle && buildingsWere) setBuildingsVisible(false);
      setViewpoint(kind, target);
      // 타일·모델이 새 시점에서 로드될 시간을 준다
      await new Promise((r) => setTimeout(r, 2500));
      addCapture(await capture2Pass());
    } catch (e) {
      setError(e instanceof Error ? e.message : "캡처 실패");
    } finally {
      if (lowAngle && buildingsWere) setBuildingsVisible(true);
      setBusyView(null);
    }
  }

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

      {/* 뷰포인트 프리셋 — 카메라를 실제로 옮겨 재촬영하므로 형태 정합이 유지된다 */}
      {hasModel && target && (
        <div className="space-y-1" data-testid="viewpoint-presets">
          <p className="text-xs font-semibold text-zinc-700">시점 프리셋에서 캡처</p>
          <div className="grid grid-cols-3 gap-1">
            {VIEWPOINTS.map((v) => (
              <button
                key={v.kind}
                className="rounded bg-zinc-100 px-1 py-1.5 text-[11px] hover:bg-zinc-200 disabled:opacity-40"
                onClick={() => captureFrom(v.kind)}
                disabled={capturing || busyView !== null}
                title={v.desc}
                data-testid={`viewpoint-${v.kind}`}
              >
                {busyView === v.kind ? "…" : v.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-zinc-400">
            이미지 변환이 아니라 3D 카메라를 옮겨 다시 촬영합니다 (형태 정합 유지).
            스트리트·디테일은 옆 건물에 가리지 않도록 주변 3D 건물을 잠시 숨겨 촬영합니다.
          </p>
        </div>
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
