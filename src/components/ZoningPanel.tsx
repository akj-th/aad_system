"use client";

// 조닝 (M5): 활성 매스 대안의 층별 용도 배분 + 적층 다이어그램. 결정론, AI 없음.

import { useProjectStore } from "@/store/project";
import {
  basementBasis,
  generateFloorTable,
  PARKING_USE_CODE,
  summarizeByUse,
  labelForUse,
} from "@/lib/massing/zoning";
import { PARKING_CATEGORIES } from "@/lib/regulation/parking";

const COLORS: Record<string, string> = {
  neighborhood_lodging: "#f59e0b",
  amusement: "#ef4444",
  assembly_business: "#3b82f6",
  other: "#64748b",
  training_factory: "#78716c",
  warehouse: "#a3a3a3",
  dormitory: "#8b5cf6",
  apartment: "#10b981",
  [PARKING_USE_CODE]: "#d4d4d8",
};

function fmt(n: number): string {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
}

export default function ZoningPanel() {
  const scenarios = useProjectStore((s) => s.massing.scenarios);
  const activeId = useProjectStore((s) => s.meta.activeScenarioId);
  const floorTable = useProjectStore((s) => s.massing.floorTable);
  const program = useProjectStore((s) => s.program);
  const setFloorTable = useProjectStore((s) => s.setFloorTable);
  const active = scenarios.find((s) => s.id === activeId);

  function autoAssign() {
    if (!active) return;
    setFloorTable(generateFloorTable(active, program.uses, program.parking.legal));
  }

  function setUse(floor: number, use: string) {
    setFloorTable(floorTable.map((r) => (r.floor === floor ? { ...r, use } : r)));
  }

  const summary = summarizeByUse(floorTable);
  const maxArea = Math.max(1, ...floorTable.map((r) => r.area));
  const above = floorTable.filter((r) => r.floor > 0);
  const below = floorTable.filter((r) => r.floor < 0);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-bold text-zinc-900">조닝 · 층별 용도</h1>
        <button
          className="rounded bg-violet-600 px-2 py-1 text-xs text-white hover:bg-violet-700 disabled:opacity-50"
          onClick={autoAssign}
          disabled={!active || program.uses.length === 0}
          data-testid="zoning-auto"
        >
          {floorTable.length ? "다시 배분" : "자동 배분"}
        </button>
      </div>

      {!active ? (
        <p className="text-xs text-zinc-400">매스 대안을 먼저 활성화하세요</p>
      ) : program.uses.length === 0 ? (
        <p className="text-xs text-zinc-400">규모 노드에서 용도 구성을 먼저 입력하세요</p>
      ) : floorTable.length === 0 ? (
        <p className="text-xs text-zinc-400">
          {active.name} ({active.floors}층)에 용도 비율대로 저층부터 적층합니다. 지하는 법정 주차대수 기준으로 산정합니다.
        </p>
      ) : (
        <>
          {/* 적층 다이어그램 */}
          <svg
            viewBox={`0 0 240 ${floorTable.length * 14 + 4}`}
            className="w-full rounded border border-zinc-200 bg-white"
            data-testid="zoning-diagram"
          >
            {floorTable.map((r, i) => {
              const w = (r.area / maxArea) * 180;
              return (
                <g key={r.floor} transform={`translate(0, ${i * 14 + 2})`}>
                  <text x="2" y="10" fontSize="8" fill="#71717a">{r.floor > 0 ? `${r.floor}F` : `B${-r.floor}`}</text>
                  <rect x={24 + (180 - w) / 2} y="1" width={w} height="12" fill={COLORS[r.use] ?? "#999"} opacity={r.floor < 0 ? 0.6 : 0.9} />
                  <text x="208" y="10" fontSize="7" fill="#71717a">{fmt(r.area)}</text>
                </g>
              );
            })}
          </svg>

          {/* 용도별 요약 */}
          <table className="w-full text-xs">
            <tbody>
              {summary.map((s) => (
                <tr key={s.use} className="border-t border-zinc-100">
                  <td className="py-1">
                    <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: COLORS[s.use] }} />
                    {labelForUse(s.use)}
                  </td>
                  <td className="text-right text-zinc-500">{s.floors}개층</td>
                  <td className="text-right font-medium">{fmt(s.area)}㎡</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] text-zinc-400">
            지상 {above.length}층 · 지하 {below.length}층 (주차 {program.parking.legal}대 × {basementBasis()}, 지하 바닥 = 지상 바닥 가정)
          </p>

          {/* 층별 편집 */}
          <details className="text-xs">
            <summary className="cursor-pointer text-zinc-600">층별 용도 편집</summary>
            <div className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
              {floorTable.map((r) => (
                <div key={r.floor} className="flex items-center gap-2">
                  <span className="w-8 text-zinc-500">{r.floor > 0 ? `${r.floor}F` : `B${-r.floor}`}</span>
                  <select
                    className="flex-1 rounded border border-zinc-300 px-1 py-0.5"
                    value={r.use}
                    onChange={(e) => setUse(r.floor, e.target.value)}
                    data-testid={`zoning-use-${r.floor}`}
                  >
                    <option value={PARKING_USE_CODE}>주차장</option>
                    {PARKING_CATEGORIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.short}</option>
                    ))}
                  </select>
                  <span className="w-14 text-right text-zinc-500">{fmt(r.area)}㎡</span>
                </div>
              ))}
            </div>
          </details>
        </>
      )}

      <p className="border-t border-zinc-200 pt-2 text-[10px] font-medium text-amber-700">
        면적표 초안 — 코어·공용부 미분리, 설계 검토로 확정할 것
      </p>
    </section>
  );
}
