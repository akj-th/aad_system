"use client";

import { useState } from "react";
import { useProjectStore } from "@/store/project";
import { calcAreas } from "@/lib/regulation/calc";
import {
  localOrdinanceUrl,
  officialSiteArea,
  refreshRegulation,
} from "@/lib/regulation/landinfo";
import { checkSunlight } from "@/lib/regulation/sunlight";

function fmt(n: number, digits = 1): string {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

export default function RegulationPanel() {
  const site = useProjectStore((s) => s.site);
  const regulation = useProjectStore((s) => s.regulation);
  // 층고는 program(규모 입력)과 공유하는 사용자 입력값
  const floorHeight = useProjectStore((s) => s.program.floorHeight ?? 3);
  const updateProgram = useProjectStore((s) => s.updateProgram);
  const setFloorHeight = (v: number) => updateProgram({ floorHeight: v });
  const [refreshing, setRefreshing] = useState(false);
  // 일조 검토용 건물 높이: 기본값은 개략 높이, 사용자가 덮어쓸 수 있다
  const [heightOverride, setHeightOverride] = useState<number | null>(null);

  const hasParcels = site.parcels.length > 0;
  const addr = site.parcels[0]?.addr ?? "";
  const { area: baseArea, allOfficial } = officialSiteArea(site.parcels);
  const ready = hasParcels && regulation.useZone && regulation.bcr.applied > 0;
  const result = ready
    ? calcAreas(baseArea, regulation.bcr.applied, regulation.far.applied, floorHeight)
    : null;
  const checkHeight = heightOverride ?? result?.estHeight ?? 0;
  const sunlight = ready
    ? checkSunlight(regulation.useZone, checkHeight, site.boundary)
    : null;

  async function refresh() {
    setRefreshing(true);
    try {
      await refreshRegulation(useProjectStore.getState().site.parcels);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-bold text-zinc-900">법규 검토 (계산부)</h1>
        {hasParcels && (
          <button
            className="rounded bg-zinc-100 px-2 py-1 text-xs hover:bg-zinc-200 disabled:opacity-50"
            onClick={refresh}
            disabled={refreshing}
            data-testid="regulation-refresh"
          >
            {refreshing ? "조회 중…" : "재조회"}
          </button>
        )}
      </div>

      {!hasParcels ? (
        <p className="text-xs text-zinc-400">먼저 대지(필지)를 선택하세요</p>
      ) : !regulation.useZone ? (
        <p className="text-xs text-zinc-400">
          토지이용계획 조회 중이거나 실패했습니다 — 재조회를 눌러보세요
        </p>
      ) : (
        <>
          {/* 용도지역·지구 */}
          <div className="space-y-1">
            <p className="text-sm">
              <span
                className="rounded bg-blue-600 px-1.5 py-0.5 text-xs font-semibold text-white"
                data-testid="regulation-zone"
              >
                {regulation.useZone}
              </span>
              {regulation.mixedZones && (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                  필지 간 용도지역 상이 — 대표 용도지역 기준 (안분 미지원)
                </span>
              )}
            </p>
            {/* 지구단위계획 등 — 지침은 해석하지 않고 원문 확인을 요구한다 (A-6 최대 난관) */}
            {regulation.dpUnitPlan.applies && (
              <div
                className="space-y-1 rounded bg-zinc-900 p-2.5 text-white"
                data-testid="dp-unit-plan"
              >
                <p className="text-[11px] font-semibold text-amber-300">
                  ⚠ 지침 원문 확인 필수
                </p>
                <p className="text-xs">
                  이 대지에는 지구단위계획 등 별도 지침이 적용됩니다. 지침의
                  건축한계선·높이·용도 제한은 <strong>아래 계산에 반영되지 않습니다</strong>.
                </p>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {regulation.dpUnitPlan.documentRefs.map((d) => (
                    <a
                      key={d.title}
                      href={d.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded bg-white/15 px-2 py-1 text-[11px] hover:bg-white/25"
                    >
                      {d.title} ↗
                    </a>
                  ))}
                </div>
              </div>
            )}

            {regulation.useDistrict.length > 0 && (
              <details className="text-[11px] text-zinc-500">
                <summary className="cursor-pointer">
                  용도지구·구역 등 {regulation.useDistrict.length}건
                </summary>
                <ul className="mt-1 max-h-28 list-inside list-disc overflow-y-auto">
                  {regulation.useDistrict.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {/* 면적 기준 */}
          <div className="rounded bg-zinc-50 p-2 text-xs" data-testid="regulation-area">
            <p>
              계산 기준 대지면적 <strong>{fmt(baseArea)}㎡</strong>{" "}
              <span className="text-[10px] text-zinc-400">
                {allOfficial
                  ? "(지적공부 면적 합)"
                  : "(일부 필지 공부면적 미조회 — 도형면적 폴백 포함)"}
              </span>
            </p>
            <p className="text-[10px] text-zinc-400">
              도형(geometry) 면적 {fmt(site.area)}㎡ — 병기용, 계산에는 미사용
            </p>
          </div>

          {/* 건폐율·용적률 표 */}
          <table className="w-full text-xs" data-testid="regulation-table">
            <thead>
              <tr className="text-left text-[10px] text-zinc-400">
                <th className="py-1 font-normal"></th>
                <th className="py-1 font-normal">법정 상한</th>
                <th className="py-1 font-normal">적용값</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-zinc-100">
                <td className="py-1 text-zinc-500">건폐율</td>
                <td>{regulation.bcr.legal}%</td>
                <td className="font-semibold">{regulation.bcr.applied}%</td>
              </tr>
              <tr className="border-t border-zinc-100">
                <td className="py-1 text-zinc-500">용적률</td>
                <td>{regulation.far.legal}%</td>
                <td className="font-semibold">{regulation.far.applied}%</td>
              </tr>
            </tbody>
          </table>
          {regulation.basis && (
            <p className="text-[10px] leading-relaxed text-zinc-400">
              근거: 건폐율 — {regulation.basis.bcr} · 용적률 —{" "}
              {regulation.basis.far}
              {addr && (
                <>
                  {" · "}
                  <a
                    href={localOrdinanceUrl(addr)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    조례 원문 ↗
                  </a>
                </>
              )}
            </p>
          )}

          {/* 층고 입력 */}
          <label className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500">기준 층고</span>
            <input
              type="number"
              min={2}
              max={10}
              step={0.1}
              value={floorHeight}
              onChange={(e) => setFloorHeight(Number(e.target.value) || 3)}
              className="w-20 rounded border border-zinc-300 px-2 py-1"
              data-testid="floor-height"
            />
            <span className="text-zinc-500">m</span>
            <span className="text-[10px] text-zinc-400">(사용자 입력)</span>
          </label>

          {/* 계산 결과 */}
          {result && (
            <div className="space-y-1 rounded bg-blue-50 p-3 text-xs" data-testid="regulation-result">
              <p>
                최대 건축면적{" "}
                <strong data-testid="max-building-area">
                  {fmt(result.maxBuildingArea)}㎡
                </strong>{" "}
                <span className="text-[10px] text-zinc-400">
                  = {fmt(baseArea)}㎡ × {regulation.bcr.applied}%
                </span>
              </p>
              <p>
                최대 연면적{" "}
                <strong data-testid="max-gross-area">
                  {fmt(result.maxGrossArea)}㎡
                </strong>{" "}
                <span className="text-[10px] text-zinc-400">
                  = {fmt(baseArea)}㎡ × {regulation.far.applied}%
                </span>
              </p>
              <p>
                개략 층수 <strong>{result.estFloors}층</strong> · 개략 높이{" "}
                <strong>{fmt(result.estHeight)}m</strong>{" "}
                <span className="text-[10px] text-zinc-400">
                  (기준층=최대 건축면적 가정, 층고 {floorHeight}m 사용자 입력)
                </span>
              </p>
              <p className="text-[10px] text-zinc-400">
                일조·사선·높이제한·주차는 미반영 (다음 단계)
              </p>
            </div>
          )}

          {/* 정북일조 개략 */}
          {sunlight && (
            <div className="space-y-1 rounded bg-zinc-50 p-3 text-xs" data-testid="sunlight-result">
              <p className="font-semibold text-zinc-700">정북일조 개략 검토</p>
              <label className="flex items-center gap-2">
                <span className="text-zinc-500">검토 높이</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={Number(checkHeight.toFixed(1))}
                  onChange={(e) => setHeightOverride(Number(e.target.value) || 0)}
                  className="w-20 rounded border border-zinc-300 px-2 py-1"
                  data-testid="sunlight-height"
                />
                <span className="text-zinc-500">m</span>
                <span className="text-[10px] text-zinc-400">
                  {heightOverride === null ? "(개략 높이 기본값)" : "(사용자 입력)"}
                </span>
              </label>
              {sunlight.applies ? (
                <>
                  <p>
                    정북 인접대지경계선 필요 이격{" "}
                    <strong data-testid="sunlight-setback">{fmt(sunlight.requiredSetback)}m</strong>
                  </p>
                  {sunlight.siteDepthNS !== null && (
                    <p className="text-[10px] text-zinc-500">
                      대지 남북 깊이 약 {fmt(sunlight.siteDepthNS, 0)}m → 이격 후 가용 깊이 약{" "}
                      {fmt(sunlight.usableDepthNS ?? 0, 0)}m (bbox 기준 개략)
                    </p>
                  )}
                </>
              ) : (
                <p className="text-zinc-500">이 용도지역에는 정북일조 높이제한이 적용되지 않습니다</p>
              )}
              <p className="text-[10px] text-zinc-400">근거: {sunlight.basis}</p>
              <p className="text-[10px] text-zinc-400">
                {sunlight.abolished.map((a) => `${a.name} 미적용 — ${a.basis}`).join(" · ")}
              </p>
              <p className="text-[10px] text-amber-700">
                정북 방향 판정·인접대지 현황·조례 완화는 미반영. 가로구역별 높이제한은 데이터 미연동.
              </p>
            </div>
          )}

          {regulation.fetchedAt && (
            <p className="text-[10px] text-zinc-400">
              조회 시각 {new Date(regulation.fetchedAt).toLocaleString("ko-KR")}
            </p>
          )}
        </>
      )}

      <p className="border-t border-zinc-200 pt-2 text-[10px] font-medium text-amber-700">
        참고용 검토이며 최종 확인은 담당 건축사 책임
      </p>
    </section>
  );
}
