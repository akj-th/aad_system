"use client";

// 평면 초안 (M6): 활성 매스의 바닥 폴리곤 + 층별 용도에서 파생한 다이어그램. AI 없음.

import { useState } from "react";
import { useProjectStore } from "@/store/project";
import { buildPlanDiagram, PLAN_BASIS } from "@/lib/plan/diagram";
import { labelForUse } from "@/lib/massing/zoning";

export default function PlanPanel() {
  const scenarios = useProjectStore((s) => s.massing.scenarios);
  const activeId = useProjectStore((s) => s.meta.activeScenarioId);
  const floorTable = useProjectStore((s) => s.massing.floorTable);
  const active = scenarios.find((s) => s.id === activeId);
  const floors = floorTable.filter((r) => r.floor > 0);
  const [floorNo, setFloorNo] = useState<number>(1);
  const row = floors.find((r) => r.floor === floorNo) ?? floors[0];

  // 순수 계산 — React Compiler가 메모이즈한다 (수동 useMemo는 lint가 막음)
  const diagram =
    active?.footprint && row
      ? buildPlanDiagram(active.footprint, row, `${row.floor}F · ${labelForUse(row.use)}`)
      : null;

  function download() {
    if (!diagram) return;
    const blob = new Blob([diagram.svg], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `plan-${row?.floor}F.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-bold text-zinc-900">평면 초안 다이어그램</h1>
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
          정합 보장 (지오메트리 파생)
        </span>
      </div>

      {!active ? (
        <p className="text-xs text-zinc-400">매스 대안을 먼저 활성화하세요</p>
      ) : floors.length === 0 ? (
        <p className="text-xs text-zinc-400">조닝에서 층별 용도를 먼저 배분하세요</p>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500">층</span>
            <select
              className="rounded border border-zinc-300 px-2 py-1"
              value={row?.floor ?? 1}
              onChange={(e) => setFloorNo(Number(e.target.value))}
              data-testid="plan-floor"
            >
              {floors.map((f) => (
                <option key={f.floor} value={f.floor}>
                  {f.floor}F · {labelForUse(f.use)} · {Math.round(f.area)}㎡
                </option>
              ))}
            </select>
            <button className="ml-auto rounded bg-zinc-100 px-2 py-1 hover:bg-zinc-200" onClick={download}>
              SVG 다운로드
            </button>
          </div>
          {diagram && (
            <div
              className="overflow-hidden rounded border border-zinc-200"
              dangerouslySetInnerHTML={{
                // viewBox만 남기면 컨테이너 폭에 맞춰 비율대로 늘어난다 (height="auto"는 SVG 속성으로 무효)
                __html: diagram.svg.replace(/ width="\d+" height="\d+"/, ' style="width:100%;height:auto;display:block"'),
              }}
              data-testid="plan-diagram"
            />
          )}
          {diagram && (
            <table className="w-full text-xs">
              <tbody>
                <tr><td className="text-zinc-500">바닥 외곽</td><td className="text-right">{diagram.width.toFixed(1)}m × {diagram.depth.toFixed(1)}m</td></tr>
                <tr><td className="text-zinc-500">바닥면적</td><td className="text-right">{diagram.floorArea.toFixed(1)}㎡</td></tr>
                <tr><td className="text-zinc-500">코어</td><td className="text-right">{diagram.coreArea.toFixed(1)}㎡ <span className="text-[10px] text-zinc-400">({PLAN_BASIS.core})</span></td></tr>
                <tr><td className="text-zinc-500">전용 가능</td><td className="text-right font-medium">{diagram.netArea.toFixed(1)}㎡</td></tr>
              </tbody>
            </table>
          )}
          <p className="text-[10px] text-zinc-400">{PLAN_BASIS.grid}</p>
        </>
      )}

      <p className="border-t border-zinc-200 pt-2 text-[10px] font-medium text-amber-700">
        초안 다이어그램 — 실·동선·구조는 설계로 확정. 허가도서 대체 불가
      </p>
    </section>
  );
}
