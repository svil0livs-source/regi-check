// Design Ref: DESIGN.md §4.6 — 끝난 건의 결과를 브라우저(IndexedDB)에 임시 보관해 이어서 처리한다. (PLAN 15번)
// - 결과만 보관한다(서류 파일은 보관하지 않음).
// - 2026-11-05 사용자 결정: 「이전 결과」 메뉴에서 다시 볼 수 있게 계속 보관한다. 「기록 지우기」를 눌러야 지운다. 서버에는 보내지 않는다.
// - 브라우저가 저장을 막으면(시크릿 창 등) 조용히 메모리에만 둔다.
import type { CaseOutcome } from "@/lib/verify/processCase";

export interface StoredOutcome {
  /** 같은 폴더인지 확인용: 파일 크기·수정 시각 */
  signature: string;
  outcome: CaseOutcome;
  savedAt: number;
}

const DB = "geunijeon-verifier";
const STORE = "results";
const memory = new Map<string, StoredOutcome>();

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadAll(): Promise<Map<string, StoredOutcome>> {
  const keys = await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
  const values = await tx<StoredOutcome[]>("readonly", (s) => s.getAll());
  if (!keys || !values) return new Map(memory);
  return new Map(keys.map((k, i) => [String(k), values[i]]));
}

export async function save(folder: string, item: StoredOutcome): Promise<void> {
  memory.set(folder, item);
  await tx("readwrite", (s) => s.put(item, folder));
}

export async function clearAll(): Promise<void> {
  memory.clear();
  await tx("readwrite", (s) => s.clear());
}
