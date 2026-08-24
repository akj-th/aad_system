"use client";

import { useRef, useState } from "react";
import { centroid } from "@turf/turf";
import { useProjectStore } from "@/store/project";
import { inspectGlb, type GlbReport } from "@/lib/model/inspect";
import {
  cameraCenterLonLat,
  flyToModel,
  getBuildingsVisible,
  getSunState,
  hasBuildingModelUrl,
  setBuildingModelUrl,
  setBuildingsVisible,
  setSun,
  terrainHeightAt,
} from "@/lib/map/controller";

const NUDGE_STEPS = [0.1, 1, 5] as const; // m

export default function BuildingPanel() {
  const massing = useProjectStore((s) => s.massing);
  const site = useProjectStore((s) => s.site);
  const setModel = useProjectStore((s) => s.setModel);
  const updatePlacement = useProjectStore((s) => s.updatePlacement);
  const clearModel = useProjectStore((s) => s.clearModel);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [modelReport, setModelReport] = useState<GlbReport | null>(null);
  // input.value를 비우면 files가 사라지므로 강제 로드용으로 따로 잡아둔다
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const modelSize = modelReport?.stats.size;
  const [nudgeStep, setNudgeStep] = useState<number>(1);

  // 초기값은 지도의 실제 상태에서 읽는다 (패널이 닫혔다 열려도 어긋나지 않게)
  const [sunDate, setSunDate] = useState(() => {
    const d = getSunState().date;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [sunHour, setSunHour] = useState(() => {
    const d = getSunState().date;
    return d.getHours() + Math.round((d.getMinutes() / 60) * 4) / 4;
  });
  const [shadowsOn, setShadowsOn] = useState(() => getSunState().shadows);
  const [buildingsOn, setBuildingsOn] = useState(() => getBuildingsVisible());

  const placement = massing.placement;

  /** 업로드 전 구조 검사 — 치명적이면 막고, 경고는 알린 뒤 진행 */
  async function loadFile(file: File) {
    if (!/\.(glb|gltf)$/i.test(file.name)) return;
    setModelReport(null);
    setPendingFile(null);
    let unitScale = 1;
    try {
      const report = inspectGlb(await file.arrayBuffer(), file.name);
      setModelReport(report);
      unitScale = report.unit.scale;
      if (!report.ok) {
        setPendingFile(file); // 치명적 — 로드하지 않고 강제 로드 선택지만 남긴다
        return;
      }
    } catch {
      // 검사 실패는 막지 않는다 (Cesium 쪽 복구 로직이 받아준다)
    }
    placeFile(file, unitScale);
  }

  /** unitScale: 모델 단위를 미터로 바꾸는 배율 (mm 모델이면 0.001) */
  function placeFile(file: File, unitScale = 1) {
    // 불러온 프로젝트처럼 배치값이 이미 있으면(파일만 없음) 배치를 유지하고 파일만 교체
    if (placement) {
      setBuildingModelUrl(URL.createObjectURL(file));
      setModel(file.name, placement);
      setTimeout(flyToModel, 600);
      return;
    }

    // 초기 위치: 대지 경계 중심 → 없으면 카메라 중심
    let lon: number, lat: number;
    if (site.boundary) {
      const c = centroid({
        type: "Feature",
        properties: {},
        geometry: site.boundary,
      });
      [lon, lat] = c.geometry.coordinates;
    } else {
      const center = cameraCenterLonLat();
      if (!center) return;
      ({ lon, lat } = center);
    }

    setBuildingModelUrl(URL.createObjectURL(file));
    setModel(file.name, {
      lon,
      lat,
      baseHeight: terrainHeightAt(lon, lat) ?? 0,
      heightOffset: 0,
      heading: 0,
      // 감지된 모델 단위를 미터로 맞춘다 (Rhino 등 mm 모델이면 0.001)
      scale: unitScale,
    });
    setTimeout(flyToModel, 600);
  }

  function nudge(dxMeters: number, dyMeters: number) {
    if (!placement) return;
    const dLat = dyMeters / 111320;
    const dLon =
      dxMeters / (111320 * Math.cos((placement.lat * Math.PI) / 180));
    updatePlacement({ lon: placement.lon + dLon, lat: placement.lat + dLat });
  }

  function snapToTerrain() {
    if (!placement) return;
    const h = terrainHeightAt(placement.lon, placement.lat);
    if (h !== null) updatePlacement({ baseHeight: h });
  }

  function applySun(dateStr: string, hour: number, shadows: boolean) {
    setSunDate(dateStr);
    setSunHour(hour);
    setShadowsOn(shadows);
    const d = new Date(dateStr);
    d.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
    setSun(d, shadows);
  }

  return (
    <section className="space-y-4">
      <h1 className="text-base font-bold text-zinc-900">건물</h1>

      {/* glb 업로드 */}
      <div
        className={`flex cursor-pointer flex-col items-center justify-center rounded border-2 border-dashed p-4 text-center text-xs transition-colors ${
          dragOver
            ? "border-blue-500 bg-blue-50 text-blue-700"
            : "border-zinc-300 text-zinc-500 hover:border-zinc-400"
        }`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) void loadFile(file);
        }}
        data-testid="model-dropzone"
      >
        {massing.modelRef ? (
          <span className="font-medium text-zinc-700">
            {massing.modelRef}
            {!hasBuildingModelUrl() && (
              <span className="ml-1 text-[10px] font-normal text-amber-600">
                (파일 재업로드 필요 — 배치값은 유지됨)
              </span>
            )}
          </span>
        ) : (
          <>
            <span>glb 파일을 끌어다 놓거나 클릭해 선택</span>
            <span className="mt-1 text-[10px] text-zinc-400">
              외부 리소스를 참조하는 gltf는 지원되지 않음 — glb 권장
            </span>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".glb,.gltf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void loadFile(file);
            e.target.value = "";
          }}
          data-testid="model-file-input"
        />
      </div>

      {/* 업로드 전 구조 검사 결과 */}
      {modelReport && (
        <div
          className={`space-y-1 rounded border p-2 text-xs ${
            modelReport.ok ? "border-zinc-200 bg-zinc-50" : "border-red-300 bg-red-50"
          }`}
          data-testid="model-report"
        >
          {modelReport.fatal.map((m) => (
            <p key={m} className="font-medium text-red-700">✕ {m}</p>
          ))}
          {modelReport.warnings.map((m) => (
            <p key={m} className="text-amber-700">⚠ {m}</p>
          ))}
          {modelReport.unit.meters && (
            <p className="text-[11px] text-zinc-700">
              단위 감지: <b>{modelReport.unit.label}</b> → 스케일 ×
              {modelReport.unit.scale} 적용 (실치수{" "}
              {modelReport.unit.meters.map((v) => v.toFixed(1)).join(" × ")}m)
              {!modelReport.unit.confident && (
                <span className="text-amber-700"> — 확신 낮음, 아래 단위 버튼으로 조정하세요</span>
              )}
            </p>
          )}
          <p className="text-[10px] text-zinc-500">
            노드 {modelReport.stats.nodes.toLocaleString("ko-KR")} · 메시{" "}
            {modelReport.stats.meshes.toLocaleString("ko-KR")} · 조각{" "}
            {modelReport.stats.primitives.toLocaleString("ko-KR")} · 계층{" "}
            {modelReport.stats.maxDepth}단 · {modelReport.stats.fileMB.toFixed(1)}MB
            {modelReport.stats.generator && ` · ${modelReport.stats.generator}`}
          </p>
          {!modelReport.ok && (
            <div className="space-y-1 border-t border-red-200 pt-1 text-[11px] text-zinc-700">
              <p className="font-medium">해결 방법 — 조각 병합</p>
              <p>
                가장 확실한 방법은 명령 한 줄로 병합하는 것입니다. 프로젝트 폴더에서:
              </p>
              <code className="block break-all rounded bg-zinc-900 px-1.5 py-1 text-[10px] text-zinc-100">
                npm run optimize-glb -- &quot;C:/경로/모델.glb&quot;
              </code>
              <p className="text-[10px] text-zinc-500">
                조각을 병합하고 형태는 그대로 둡니다(단순화·압축 없음). 같은 폴더에
                -optimized.glb가 생깁니다.
              </p>
              <details>
                <summary className="cursor-pointer text-zinc-600">
                  모델링 툴에서 미리 줄이려면
                </summary>
                <div className="mt-1 space-y-1">
                  <p>
                    <b>Rhino</b>: 내보내기 전 <code>SelAll</code> → <code>Mesh</code>(메시 변환)
                    → 재질(레이어)별로 선택해 <code>Join</code>. 폴리서피스를 그대로 내보내면
                    면마다 조각이 생깁니다. glTF 내보내기 옵션에서 Draco 압축은 끄세요.
                  </p>
                  <p>
                    <b>Blender</b>: 전체 선택(A) → 병합(Ctrl+J) → glb 재내보내기.
                  </p>
                  <p>
                    <b>SketchUp</b>: 재질 수를 줄이고 불필요한 그룹·컴포넌트를 정리 후 내보내기.
                  </p>
                </div>
              </details>
              <button
                className="rounded bg-zinc-900 px-2 py-1 text-[11px] text-white"
                onClick={() => {
                  const f = pendingFile;
                  const s = modelReport.unit.scale;
                  setModelReport(null);
                  setPendingFile(null);
                  if (f) placeFile(f, s);
                }}
              >
                그래도 올려보기 (지도가 멈출 수 있음)
              </button>
            </div>
          )}
        </div>
      )}

      {massing.modelRef && (
        <div className="flex gap-2 text-xs">
          <button
            className="rounded bg-zinc-100 px-2 py-1 hover:bg-zinc-200"
            onClick={flyToModel}
          >
            모델로 이동
          </button>
          <button
            className="rounded bg-zinc-100 px-2 py-1 text-red-600 hover:bg-red-50"
            onClick={() => {
              setBuildingModelUrl(null);
              clearModel();
            }}
          >
            제거
          </button>
        </div>
      )}

      {/* 배치 조정 */}
      {placement && (
        <div className="space-y-3 rounded bg-zinc-50 p-3" data-testid="placement-controls">
          <h2 className="font-semibold text-zinc-700">배치 조정</h2>

          <div className="flex items-center gap-3">
            <div className="grid grid-cols-3 gap-1">
              <span />
              <button className="rounded bg-white px-2 py-1 shadow-sm hover:bg-blue-50" onClick={() => nudge(0, nudgeStep)} data-testid="nudge-n">↑</button>
              <span />
              <button className="rounded bg-white px-2 py-1 shadow-sm hover:bg-blue-50" onClick={() => nudge(-nudgeStep, 0)} data-testid="nudge-w">←</button>
              <span className="self-center text-center text-[10px] text-zinc-400">{nudgeStep}m</span>
              <button className="rounded bg-white px-2 py-1 shadow-sm hover:bg-blue-50" onClick={() => nudge(nudgeStep, 0)} data-testid="nudge-e">→</button>
              <span />
              <button className="rounded bg-white px-2 py-1 shadow-sm hover:bg-blue-50" onClick={() => nudge(0, -nudgeStep)} data-testid="nudge-s">↓</button>
              <span />
            </div>
            <div className="flex flex-col gap-1">
              {NUDGE_STEPS.map((s) => (
                <button
                  key={s}
                  className={`rounded px-2 py-0.5 text-xs ${
                    nudgeStep === s
                      ? "bg-blue-600 text-white"
                      : "bg-white text-zinc-600 shadow-sm hover:bg-zinc-100"
                  }`}
                  onClick={() => setNudgeStep(s)}
                >
                  {s}m
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-xs text-zinc-500">
              회전 (heading) {placement.heading.toFixed(0)}°
            </span>
            <input
              type="range"
              min={0}
              max={360}
              step={1}
              value={placement.heading}
              onChange={(e) =>
                updatePlacement({ heading: Number(e.target.value) })
              }
              className="w-full"
              data-testid="heading-slider"
            />
          </label>

          <label className="block">
            <span className="text-xs text-zinc-500">
              고도 오프셋 {placement.heightOffset.toFixed(1)}m
            </span>
            <input
              type="range"
              min={-50}
              max={50}
              step={0.1}
              value={placement.heightOffset}
              onChange={(e) =>
                updatePlacement({ heightOffset: Number(e.target.value) })
              }
              className="w-full"
              data-testid="height-slider"
            />
          </label>

          {/* 스케일 — mm 모델(×0.001)까지 다뤄야 하므로 로그 슬라이더 + 단위 프리셋 */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">
                스케일 ×
                {placement.scale < 0.01
                  ? placement.scale.toPrecision(3)
                  : placement.scale.toFixed(2)}
              </span>
              {modelSize && (
                <span className="text-[10px] text-zinc-400">
                  실치수 {modelSize.map((v) => (v * placement.scale).toFixed(1)).join(" × ")}m
                </span>
              )}
            </div>
            <input
              type="range"
              min={-3}
              max={1}
              step={0.01}
              value={Math.log10(placement.scale)}
              onChange={(e) =>
                updatePlacement({ scale: 10 ** Number(e.target.value) })
              }
              className="w-full"
              data-testid="scale-slider"
            />
            <div className="flex items-center gap-1 text-[11px]">
              <span className="text-zinc-500">모델 단위</span>
              {(
                [
                  ["m", 1],
                  ["mm", 0.001],
                  ["cm", 0.01],
                  ["in", 0.0254],
                  ["ft", 0.3048],
                ] as const
              ).map(([label, s]) => (
                <button
                  key={label}
                  className={`rounded px-1.5 py-0.5 ${
                    Math.abs(placement.scale - s) < s * 0.01
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-100 hover:bg-zinc-200"
                  }`}
                  onClick={() => updatePlacement({ scale: s })}
                  data-testid={`unit-${label}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button
            className="w-full rounded bg-blue-600 py-1.5 text-white hover:bg-blue-700"
            onClick={snapToTerrain}
            data-testid="snap-button"
          >
            지형에 스냅
          </button>
          <p className="text-[10px] text-zinc-400">
            기준 고도 {placement.baseHeight.toFixed(1)}m + 오프셋. SketchUp
            원점이 다르면 오프셋으로 보정하세요.
          </p>
        </div>
      )}

      {/* 일조·그림자 */}
      <div className="space-y-2">
        <h2 className="font-semibold text-zinc-700">일조·그림자</h2>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={shadowsOn}
            onChange={(e) => applySun(sunDate, sunHour, e.target.checked)}
            data-testid="shadows-toggle"
          />
          그림자 표시
        </label>
        <input
          type="date"
          value={sunDate}
          onChange={(e) => applySun(e.target.value, sunHour, shadowsOn)}
          className="w-full rounded border border-zinc-300 px-2 py-1 text-xs"
          data-testid="sun-date"
        />
        <label className="block">
          <span className="text-xs text-zinc-500">
            시각 {Math.floor(sunHour)}:{String(Math.round((sunHour % 1) * 60)).padStart(2, "0")}
          </span>
          <input
            type="range"
            min={6}
            max={20}
            step={0.25}
            value={sunHour}
            onChange={(e) =>
              applySun(sunDate, Number(e.target.value), shadowsOn)
            }
            className="w-full"
            data-testid="sun-hour"
          />
        </label>
      </div>

      {/* 주변 3D 건물 */}
      <div className="space-y-1">
        <h2 className="font-semibold text-zinc-700">주변 3D 건물</h2>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={buildingsOn}
            onChange={(e) => {
              setBuildingsOn(e.target.checked);
              setBuildingsVisible(e.target.checked);
            }}
            data-testid="buildings-toggle"
          />
          표시
        </label>
        <p className="text-[10px] text-zinc-400">
          지역에 따라 3D 건물 데이터가 없을 수 있음 — 없는 지역은 렌더 시 AI가
          배경을 임의로 생성하므로 주의
        </p>
      </div>
    </section>
  );
}
