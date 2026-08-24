"use client";

// 매스 스터디 (M4) + 시나리오 비교 (A-4). 규칙 기반 대안 — AI 없음.

import { useProjectStore } from "@/store/project";
import { useUiStore } from "@/store/ui";
import { officialSiteArea } from "@/lib/regulation/landinfo";
import {
  buildCustomScenario,
  buildScenario,
  generateMassAlternatives,
  type MassParams,
} from "@/lib/massing/generate";
import { calcParking } from "@/lib/regulation/parking";
import { flyToMass } from "@/lib/map/controller";
import { makeFrame, ringArea, ringToGeometry } from "@/lib/map/draw";
import { setView2D } from "@/lib/map/map2d";
import { centroid } from "@turf/turf";

function fmt(n: number, d = 0): string {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: d });
}

export default function MassPanel() {
  const site = useProjectStore((s) => s.site);
  const regulation = useProjectStore((s) => s.regulation);
  const program = useProjectStore((s) => s.program);
  const massing = useProjectStore((s) => s.massing);
  const activeId = useProjectStore((s) => s.meta.activeScenarioId);
  const setScenarios = useProjectStore((s) => s.setScenarios);
  const updateScenario = useProjectStore((s) => s.updateScenario);
  const setActiveScenario = useProjectStore((s) => s.setActiveScenario);
  const addScenario = useProjectStore((s) => s.addScenario);

  const draft = useUiStore((s) => s.footprintDraft);
  const gridModule = useUiStore((s) => s.gridModule);
  const startDrawing = useUiStore((s) => s.startDrawing);
  const undoVertex = useUiStore((s) => s.undoVertex);
  const cancelDrawing = useUiStore((s) => s.cancelDrawing);
  const setGridModule = useUiStore((s) => s.setGridModule);

  const { area: siteArea } = officialSiteArea(site.parcels);
  const ready = !!site.boundary && regulation.bcr.applied > 0;
  const params: MassParams | null = ready
    ? {
        boundary: site.boundary!,
        siteArea,
        bcr: regulation.bcr.applied,
        far: regulation.far.applied,
        floorHeight: program.floorHeight ?? 3,
        useZone: regulation.useZone,
      }
    : null;

  const addr = site.parcels[0]?.addr ?? "";
  const parkingFor = (gross: number) =>
    program.uses.length
      ? calcParking(
          program.uses.map((u) => ({ code: u.code, area: (gross * u.ratio) / 100 })),
          addr,
        ).legal
      : null;

  // 그리는 중인 외곽선의 실시간 지표
  const draftArea = draft && draft.length >= 3 ? ringArea(draft) : 0;
  const maxBuildingArea = (siteArea * regulation.bcr.applied) / 100;
  const draftBcr = siteArea > 0 ? (draftArea / siteArea) * 100 : 0;
  const draftOverBcr = draftArea > maxBuildingArea + 0.5;

  function regenerate() {
    if (!params) return;
    setScenarios(generateMassAlternatives(params));
  }

  /** 드로잉 시작 — 2D 지도를 대지 중심으로 맞춰 바로 그릴 수 있게 한다 */
  function beginDrawing() {
    if (site.boundary) {
      const c = centroid({ type: "Feature", properties: {}, geometry: site.boundary })
        .geometry.coordinates;
      setView2D(c[0], c[1], 19);
    }
    startDrawing();
  }

  function finishDrawing() {
    if (!params || !draft || draft.length < 3 || !site.boundary) return;
    const geometry = ringToGeometry(makeFrame(site.boundary), draft);
    addScenario(buildCustomScenario(params, geometry));
    cancelDrawing();
    setTimeout(flyToMass, 500);
  }

  function changeRatio(id: string, ratio: number) {
    if (!params) return;
    const sc = massing.scenarios.find((x) => x.id === id);
    if (!sc) return;
    const rebuilt = buildScenario(params, ratio, sc.name, sc.description);
    updateScenario(id, { ...rebuilt, id, createdAt: sc.createdAt });
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-bold text-zinc-900">매스 스터디 · 대안 비교</h1>
        <button
          className="rounded bg-violet-600 px-2 py-1 text-xs text-white hover:bg-violet-700 disabled:opacity-50"
          onClick={regenerate}
          disabled={!ready}
          data-testid="mass-generate"
        >
          {massing.scenarios.length ? "대안 다시 생성" : "대안 3개 생성"}
        </button>
      </div>

      {/* 직접 그리기 (WP 방식) — 축척 근사가 아닌 실제 지오메트리 */}
      {ready && (
        <div className="space-y-2 rounded border border-zinc-200 p-2" data-testid="draw-controls">
          {draft === null ? (
            <button
              className="w-full rounded bg-zinc-900 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
              onClick={beginDrawing}
              data-testid="draw-start"
            >
              ✏ 건물 외곽선 직접 그리기
            </button>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-700">외곽선 그리는 중</span>
                <span className="text-zinc-400">{draft.length}점</span>
              </div>
              <div className="flex items-center gap-1 text-[11px]">
                <span className="text-zinc-500">스냅</span>
                {[0, 1, 3, 10].map((m) => (
                  <button
                    key={m}
                    className={`rounded px-1.5 py-0.5 ${gridModule === m ? "bg-blue-600 text-white" : "bg-zinc-100 hover:bg-zinc-200"}`}
                    onClick={() => setGridModule(m)}
                    data-testid={`grid-${m}`}
                  >
                    {m === 0 ? "없음" : `${m}m`}
                  </button>
                ))}
              </div>
              {draft.length >= 3 && (
                <div className="rounded bg-blue-50 p-2 text-xs" data-testid="draw-metrics">
                  <p>
                    건축면적 <strong>{fmt(draftArea, 1)}㎡</strong> · 건폐율{" "}
                    <strong className={draftOverBcr ? "text-red-600" : ""}>
                      {fmt(draftBcr, 1)}%
                    </strong>
                    <span className="text-zinc-400"> / 법정 {regulation.bcr.applied}%</span>
                  </p>
                  {draftOverBcr && (
                    <p className="text-[10px] text-red-600">
                      최대 건축면적 {fmt(maxBuildingArea, 0)}㎡ 초과
                    </p>
                  )}
                </div>
              )}
              <div className="flex gap-1 text-xs">
                <button
                  className="flex-1 rounded bg-zinc-100 py-1 hover:bg-zinc-200 disabled:opacity-40"
                  onClick={undoVertex}
                  disabled={draft.length === 0}
                >
                  ← 취소
                </button>
                <button
                  className="flex-1 rounded bg-zinc-100 py-1 hover:bg-zinc-200"
                  onClick={cancelDrawing}
                >
                  중단
                </button>
                <button
                  className="flex-[2] rounded bg-violet-600 py-1 font-medium text-white hover:bg-violet-700 disabled:opacity-40"
                  onClick={finishDrawing}
                  disabled={draft.length < 3}
                  data-testid="draw-finish"
                >
                  매스로 확정
                </button>
              </div>
              <p className="text-[10px] text-zinc-400">
                지도를 클릭해 꼭짓점을 찍으세요. 꼭짓점마다 첫 점 기준 상대좌표(WP)가 표시됩니다.
              </p>
            </>
          )}
        </div>
      )}

      {!ready ? (
        <p className="text-xs text-zinc-400">대지 경계와 법규(건폐율·용적률)가 있어야 생성됩니다</p>
      ) : massing.scenarios.length === 0 ? (
        <p className="text-xs text-zinc-400">
          건폐율 대비 바닥 비율 100% / 70% / 45%의 규칙 기반 대안을 만듭니다. 연면적은 법정 최대에 맞춥니다.
        </p>
      ) : (
        <div className="space-y-2" data-testid="mass-list">
          {massing.scenarios.map((sc) => {
            const active = sc.id === activeId;
            const parking = parkingFor(sc.grossFloorArea);
            return (
              <div
                key={sc.id}
                className={`rounded border p-2 text-xs ${active ? "border-violet-500 bg-violet-50" : "border-zinc-200"}`}
                data-testid="mass-item"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-800">
                    {sc.name}
                    {!sc.sunlightOk && (
                      <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">일조 검토 필요</span>
                    )}
                  </span>
                  <button
                    className={`rounded px-2 py-0.5 text-[11px] ${active ? "bg-violet-600 text-white" : "bg-zinc-100 hover:bg-zinc-200"}`}
                    onClick={() => {
                      setActiveScenario(active ? null : sc.id);
                      if (!active) setTimeout(flyToMass, 500);
                    }}
                    data-testid="mass-activate"
                  >
                    {active ? "활성" : "활성화"}
                  </button>
                </div>
                <p className="text-[10px] text-zinc-400">{sc.description}</p>
                <table className="mt-1 w-full text-[11px]">
                  <tbody>
                    <tr><td className="text-zinc-500">바닥면적</td><td className="text-right">{fmt(sc.footprintArea ?? 0)}㎡ (건폐율 {sc.bcr.toFixed(1)}%)</td></tr>
                    <tr><td className="text-zinc-500">층수 · 높이</td><td className="text-right">{sc.floors}층 · {fmt(sc.height ?? 0, 1)}m</td></tr>
                    <tr><td className="text-zinc-500">연면적</td><td className="text-right">{fmt(sc.grossFloorArea)}㎡ (용적률 {sc.far}%)</td></tr>
                    {parking !== null && <tr><td className="text-zinc-500">법정 주차</td><td className="text-right">{parking}대</td></tr>}
                  </tbody>
                </table>
                <label className="mt-1 flex items-center gap-2 text-[11px]">
                  <span className="text-zinc-500">바닥 비율</span>
                  <input
                    type="range"
                    min={0.2}
                    max={1}
                    step={0.05}
                    value={sc.footprintRatio ?? 1}
                    onChange={(e) => changeRatio(sc.id, Number(e.target.value))}
                    className="flex-1"
                  />
                  <span className="w-10 text-right">{Math.round((sc.footprintRatio ?? 1) * 100)}%</span>
                </label>
                {sc.notes?.map((n, i) => (
                  <p key={i} className="text-[10px] text-zinc-400">· {n}</p>
                ))}
              </div>
            );
          })}
          <p className="text-[10px] text-zinc-400">
            활성 대안은 3D 뷰에 압출체로 표시되고, 캡처·렌더의 건물로 쓰입니다 (glb가 있으면 함께). 활성화 시 규모의 계획 연면적이 대안 값으로 맞춰집니다.
          </p>
        </div>
      )}

      <p className="border-t border-zinc-200 pt-2 text-[10px] font-medium text-amber-700">
        규칙 기반 개략 매스 — 배치·형태는 설계 판단으로 확정할 것
      </p>
    </section>
  );
}
