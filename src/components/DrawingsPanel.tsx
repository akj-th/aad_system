"use client";

// 도면·BIM (M8): ① 필요 도서 목록 ② 표 기반 도면(표제부·면적표·주차) ③ IFC 핸드오프.
// A-7: 허가도서 자동생성물은 초안 — 건축사 검토 확인 전에는 인쇄·내보내기를 막는다.

import { useRef, useState } from "react";
import { useProjectStore } from "@/store/project";
import { officialSiteArea } from "@/lib/regulation/landinfo";
import { DRAWINGS_NOTE, resolveDrawings } from "@/lib/drawings/list";
import { buildTablesHtml } from "@/lib/drawings/tables";
import { buildIfc } from "@/lib/drawings/ifc";

export default function DrawingsPanel() {
  const exportProject = useProjectStore((s) => s.exportProject);
  const site = useProjectStore((s) => s.site);
  const program = useProjectStore((s) => s.program);
  const massing = useProjectStore((s) => s.massing);
  const activeId = useProjectStore((s) => s.meta.activeScenarioId);
  const sc = massing.scenarios.find((s) => s.id === activeId);
  const [reviewed, setReviewed] = useState(false);
  const [tab, setTab] = useState<"list" | "tables">("list");
  const frameRef = useRef<HTMLIFrameElement>(null);

  const basementFloors = massing.floorTable.filter((r) => r.floor < 0).length;
  const facts = {
    floors: sc?.floors ?? 0,
    basementFloors,
    grossArea: program.grossArea,
    siteArea: officialSiteArea(site.parcels).area,
    excavationDepth: basementFloors * (sc?.floorHeight ?? 3),
  };
  const items = resolveDrawings(facts);
  const required = items.filter((i) => i.required);
  const snapshot = exportProject();
  const tablesHtml = buildTablesHtml(snapshot);

  function downloadIfc() {
    const ifc = buildIfc(snapshot);
    if (!ifc) return;
    const blob = new Blob([ifc], { type: "application/x-step" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${snapshot.meta.name}-mass-DRAFT.ifc`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section className="flex h-full flex-col gap-3">
      <h1 className="text-base font-bold text-zinc-900">도면·BIM (허가도서 준비)</h1>

      <label className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
        <input
          type="checkbox"
          checked={reviewed}
          onChange={(e) => setReviewed(e.target.checked)}
          className="mt-0.5"
          data-testid="drawings-reviewed"
        />
        <span>
          자동 산출물은 <b>초안(DRAFT)</b>이며 담당 건축사 검토 전 외부 반출을 금지합니다. 확인했습니다.
          <span className="block text-[10px] font-normal">체크해야 인쇄·IFC 내보내기가 활성화됩니다.</span>
        </span>
      </label>

      <div className="flex gap-1 text-xs">
        {(
          [
            ["list", `필요 도서 ${required.length}건`],
            ["tables", "표제부·면적표·주차"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            className={`rounded px-2 py-1 ${tab === k ? "bg-zinc-900 text-white" : "bg-zinc-100 hover:bg-zinc-200"}`}
            onClick={() => setTab(k)}
            data-testid={`drawings-tab-${k}`}
          >
            {label}
          </button>
        ))}
        <button
          className="ml-auto rounded bg-slate-700 px-2 py-1 text-white hover:bg-slate-800 disabled:opacity-40"
          onClick={downloadIfc}
          disabled={!reviewed || !sc?.footprint}
          title={!sc?.footprint ? "활성 매스 대안이 필요합니다" : ""}
          data-testid="drawings-ifc"
        >
          IFC 내보내기
        </button>
      </div>

      {tab === "list" ? (
        <div className="space-y-1 text-xs" data-testid="drawings-list">
          <p className="text-[10px] text-zinc-400">{DRAWINGS_NOTE}</p>
          <table className="w-full">
            <tbody>
              {items.map((it) => (
                <tr key={it.code} className={`border-t border-zinc-100 ${it.required ? "" : "text-zinc-400"}`}>
                  <td className="py-1 pr-2">
                    <span className={`mr-1 inline-block h-2 w-2 rounded-full ${it.required ? "bg-emerald-500" : "bg-zinc-300"}`} />
                    {it.name}
                    {it.auto && <span className="ml-1 rounded bg-blue-100 px-1 text-[9px] text-blue-700">자동</span>}
                  </td>
                  <td className="py-1 text-right text-[10px] text-zinc-400">
                    {it.basis}
                    {it.reason && <span className="block">{it.reason}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="flex justify-end">
            <button
              className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-40"
              onClick={() => frameRef.current?.contentWindow?.print()}
              disabled={!reviewed}
              data-testid="drawings-print"
            >
              인쇄 / PDF
            </button>
          </div>
          <iframe
            ref={frameRef}
            srcDoc={tablesHtml}
            title="표제부·면적표·주차계획표"
            className="min-h-0 flex-1 rounded border border-zinc-200 bg-white"
            style={{ minHeight: 560 }}
            data-testid="drawings-frame"
          />
        </>
      )}

      <p className="border-t border-zinc-200 pt-2 text-[10px] font-medium text-amber-700">
        평면·입면·단면 등 본 도면은 자동 생성하지 않습니다 — IFC 매스를 BIM 툴로 넘겨 사람이 완성합니다 (A-7)
      </p>
    </section>
  );
}
