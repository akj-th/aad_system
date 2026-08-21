"use client";

import { useState } from "react";
import { useProjectStore } from "@/store/project";
import { calcAreas } from "@/lib/regulation/calc";
import { officialSiteArea, refreshRegulation } from "@/lib/regulation/landinfo";

function fmt(n: number, digits = 1): string {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

export default function RegulationPanel() {
  const site = useProjectStore((s) => s.site);
  const regulation = useProjectStore((s) => s.regulation);
  const [floorHeight, setFloorHeight] = useState(3.0);
  const [refreshing, setRefreshing] = useState(false);

  const hasParcels = site.parcels.length > 0;
  const { area: baseArea, allOfficial } = officialSiteArea(site.parcels);
  const ready = hasParcels && regulation.useZone && regulation.bcr.applied > 0;
  const result = ready
    ? calcAreas(baseArea, regulation.bcr.applied, regulation.far.applied, floorHeight)
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
