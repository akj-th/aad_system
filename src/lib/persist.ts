// 로컬 자동 저장 (IndexedDB). 캡처·렌더가 dataURL이라 localStorage 5MB로는 부족하다.
// 서버 저장이 없는 단계에서 새로고침·브라우저 종료에도 작업이 남게 하는 안전망.

import type { ExportedProject } from "@/store/project";

const DB_NAME = "aad-system";
const STORE = "project";
const KEY = "current";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocal(data: ExportedProject): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ savedAt: new Date().toISOString(), data }, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadLocal(): Promise<{ savedAt: string; data: ExportedProject } | null> {
  try {
    const db = await openDb();
    const result = await new Promise<{ savedAt: string; data: ExportedProject } | null>(
      (resolve, reject) => {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      },
    );
    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function clearLocal(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // 저장소 접근 불가는 치명적이지 않다
  }
}
