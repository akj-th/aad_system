"use client";

// 자동 저장·복원 컨트롤러. 상태가 바뀌면 디바운스 후 IndexedDB에 저장하고,
// 첫 진입 시 저장본이 있으면 복원한다. 표시는 CanvasToolbar가 한다.

import { useEffect } from "react";
import { useProjectStore } from "@/store/project";
import { useUiStore } from "@/store/ui";
import { loadLocal, saveLocal } from "@/lib/persist";

const DEBOUNCE_MS = 1200;

export default function AutoSave() {
  const setSaveState = useUiStore((s) => s.setSaveState);

  useEffect(() => {
    let restored = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    // 1) 복원 — 빈 프로젝트일 때만 (사용자가 이미 뭔가 했으면 덮지 않는다)
    void (async () => {
      const saved = await loadLocal();
      if (disposed) return;
      const s = useProjectStore.getState();
      if (saved && s.site.parcels.length === 0 && s.captures.length === 0) {
        if (s.importProject(saved.data)) {
          setSaveState({ status: "saved", at: saved.savedAt, restored: true });
        }
      }
      restored = true;
    })();

    // 2) 변경 감지 → 디바운스 저장
    const unsub = useProjectStore.subscribe(() => {
      if (!restored || disposed) return;
      setSaveState({ status: "saving" });
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          await saveLocal(useProjectStore.getState().exportProject());
          if (!disposed) setSaveState({ status: "saved", at: new Date().toISOString() });
        } catch {
          if (!disposed) setSaveState({ status: "error" });
        }
      }, DEBOUNCE_MS);
    });

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [setSaveState]);

  return null;
}
