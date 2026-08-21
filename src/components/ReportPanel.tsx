"use client";

import { useMemo, useRef } from "react";
import { useProjectStore } from "@/store/project";
import { buildReportHtml } from "@/lib/report/html";

export default function ReportPanel() {
  const exportProject = useProjectStore((s) => s.exportProject);
  // 상태가 바뀌면 다시 생성 — 캡처/렌더 변경도 포함되도록 전체 스냅샷을 구독한다
  const snapshotKey = useProjectStore(
    (s) =>
      `${s.meta.name}|${s.site.parcels.length}|${s.regulation.fetchedAt}|${s.program.grossArea}|${s.program.uses.length}|${s.program.parking.legal}|${s.feasibility.results.totalCost}|${s.captures.length}|${s.captures[0]?.renders.length ?? 0}`,
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshotKey가 재생성 트리거
  const html = useMemo(() => buildReportHtml(exportProject()), [snapshotKey, exportProject]);
  const frameRef = useRef<HTMLIFrameElement>(null);

  function print() {
    frameRef.current?.contentWindow?.print();
  }

  function openInTab() {
    const blob = new Blob([html], { type: "text/html" });
    window.open(URL.createObjectURL(blob), "_blank");
  }

  return (
    <section className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-bold text-zinc-900">기획 검토 리포트</h1>
        <div className="flex gap-1 text-xs">
          <button
            className="rounded bg-zinc-100 px-2 py-1 hover:bg-zinc-200"
            onClick={openInTab}
          >
            새 탭
          </button>
          <button
            className="rounded bg-blue-600 px-2 py-1 text-white hover:bg-blue-700"
            onClick={print}
            data-testid="report-print"
          >
            인쇄 / PDF
          </button>
        </div>
      </div>
      <p className="text-[10px] text-zinc-400">
        현재 상태로 매번 새로 생성됩니다 (AI 문장 없음 · 수치는 각 모듈 계산값).
      </p>
      <iframe
        ref={frameRef}
        srcDoc={html}
        title="리포트 미리보기"
        className="min-h-0 flex-1 rounded border border-zinc-200 bg-white"
        style={{ minHeight: 600 }}
        data-testid="report-frame"
      />
    </section>
  );
}
