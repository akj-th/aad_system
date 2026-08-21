"use client";

// 매스 스터디 (M4) + 시나리오 비교 (A-4). 규칙 기반 대안 — AI 없음.

import { useProjectStore } from "@/store/project";
import { officialSiteArea } from "@/lib/regulation/landinfo";
import { buildScenario, generateMassAlternatives, type MassParams } from "@/lib/massing/generate";
import { calcParking } from "@/lib/regulation/parking";
import { flyToMass } from "@/lib/map/controller";

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

  function regenerate() {
    if (!params) return;
    setScenarios(generateMassAlternatives(params));
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
