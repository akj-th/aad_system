"use client";

import { useRef, useState } from "react";
import { useProjectStore } from "@/store/project";
import { useUiStore } from "@/store/ui";
import { clearLocal } from "@/lib/persist";

/** 캔버스 상단 툴바 — 프로젝트명, 상태 JSON 내보내기/불러오기 (B-4 Phase 5) */
export default function CanvasToolbar() {
  const name = useProjectStore((s) => s.meta.name);
  const setProjectName = useProjectStore((s) => s.setProjectName);
  const exportProject = useProjectStore((s) => s.exportProject);
  const importProject = useProjectStore((s) => s.importProject);
  const resetProject = useProjectStore((s) => s.resetProject);
  const save = useUiStore((s) => s.saveState);
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  function flash(msg: string) {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3000);
  }

  function download() {
    const data = exportProject();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name || "project"}-${new Date().toISOString().slice(0, 10)}.aad.json`;
    a.click();
    URL.revokeObjectURL(url);
    flash("내보내기 완료");
  }

  async function onFile(file: File) {
    try {
      const ok = importProject(JSON.parse(await file.text()));
      flash(
        ok
          ? "불러오기 완료 — glb는 다시 올려야 합니다"
          : "불러오기 실패: 형식 또는 스키마 버전이 맞지 않습니다",
      );
    } catch {
      flash("불러오기 실패: JSON을 읽을 수 없습니다");
    }
  }

  return (
    <div
      className="absolute left-3 top-3 z-20 flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs shadow"
      data-testid="canvas-toolbar"
    >
      <input
        className="w-40 rounded border border-zinc-200 px-2 py-1 font-medium text-zinc-800 outline-none focus:border-blue-500"
        value={name}
        onChange={(e) => setProjectName(e.target.value)}
        aria-label="프로젝트 이름"
        data-testid="project-name"
      />
      <button
        className="rounded bg-zinc-100 px-2 py-1 hover:bg-zinc-200"
        onClick={download}
        data-testid="export-button"
      >
        내보내기
      </button>
      <button
        className="rounded bg-zinc-100 px-2 py-1 hover:bg-zinc-200"
        onClick={() => fileRef.current?.click()}
        data-testid="import-button"
      >
        불러오기
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = "";
        }}
        data-testid="import-file-input"
      />
      <button
        className="rounded px-2 py-1 text-zinc-400 hover:bg-red-50 hover:text-red-600"
        onClick={() => {
          if (confirm("현재 프로젝트를 비우고 새로 시작할까요? (로컬 저장본도 삭제됩니다)")) {
            void clearLocal();
            resetProject();
          }
        }}
      >
        새 프로젝트
      </button>

      {/* 로컬 자동 저장 상태 */}
      <span className="flex items-center gap-1 text-[11px]" data-testid="save-badge">
        {save.status === "saving" && <span className="text-zinc-400">저장 중…</span>}
        {save.status === "saved" && (
          <span className="text-emerald-600" title={save.at ? new Date(save.at).toLocaleString("ko-KR") : ""}>
            ● {save.restored ? "이어서 작업 중" : "로컬 저장됨"}
          </span>
        )}
        {save.status === "error" && <span className="text-red-600">저장 실패</span>}
      </span>
      {message && (
        <span className="text-[11px] text-blue-600" data-testid="toolbar-message">
          {message}
        </span>
      )}
    </div>
  );
}
