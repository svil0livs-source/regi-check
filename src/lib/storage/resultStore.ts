// Design Ref: DESIGN.md §4.6 — 끝난 건의 결과를 브라우저(IndexedDB)에 임시 보관해 이어서 처리한다. (PLAN 15번)
// - 결과만 보관한다(서류 파일은 보관하지 않음).
// - 2026-11-05 사용자 결정: 「이전 결과」 메뉴에서 다시 볼 수 있게 계속 보관한다. 「기록 지우기」를 눌러야 지운다. 서버에는 보내지 않는다.
// - 브라우저가 저장을 막으면(시크릿 창 등) 메모리에만 두고, 저장·삭제에 실패했는지 돌려줘 화면이 알릴 수 있게 한다 (CHECK 12번).
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

/** 한 번 읽기·쓰기. 실패하면 ok:false (저장소가 막혔거나 오류) */
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  const db = await open();
  if (!db) return { ok: false };
  return new Promise((resolve) => {
    try {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve({ ok: true, value: req.result });
      req.onerror = () => resolve({ ok: false });
    } catch {
      resolve({ ok: false });
    }
  });
}

export async function loadAll(): Promise<Map<string, StoredOutcome>> {
  const keys = await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
  const values = await tx<StoredOutcome[]>("readonly", (s) => s.getAll());
  if (!keys.ok || !values.ok) return new Map(memory);
  return new Map(keys.value.map((k, i) => [String(k), values.value[i]]));
}

/** 결과 하나 보관. 브라우저에 저장하지 못했으면(메모리에만 남음) false */
export async function save(folder: string, item: StoredOutcome): Promise<boolean> {
  memory.set(folder, item);
  return (await tx("readwrite", (s) => s.put(item, folder))).ok;
}

/** 보관한 결과 모두 지우기. 브라우저 저장소를 지우지 못했으면 false */
export async function clearAll(): Promise<boolean> {
  memory.clear();
  return (await tx("readwrite", (s) => s.clear())).ok;
}
