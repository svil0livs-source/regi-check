// Design Ref: DESIGN.md §4.1 — 건 하나를 처리한다: 등기부 읽기 → 근저당권 찾기 → 대조 → 요약. (PLAN 10번)
// 2026-11-06: 한글 파일은 브라우저가 읽어 대조 항목 값만 보낸다(파일당 6000KB까지 받기 위해). 여기서는 등기부만 읽는다.
// 서버에서만 쓴다. 읽은 원문은 결과에 넣지 않고 로그에도 남기지 않는다.
import "server-only";

import { summarizeCase } from "@/lib/compare/summarize";
import type { PageImageObject } from "@/lib/readers/pdfPages";
import { RegistryReadError, type RegistryRead } from "@/lib/readers/registryOcr";
import { combineReads, readRegistryObjects, readRegistryPass } from "@/lib/readers/registryRead";
import type { CaseSummary, DocumentFields, FieldResult } from "@/types/verification";
import { verifyCase } from "./verifyCase";

export interface CaseOutcome {
  folder: string;
  summary: CaseSummary;
  results: FieldResult[];
  /** 처리 실패일 때 화면에 보일 이유 */
  error?: string;
}

export async function processCase(
  folder: string,
  hwp: DocumentFields,
  registryImages: PageImageObject[],
  signal?: AbortSignal,
): Promise<CaseOutcome> {
  const fail = (error: string): CaseOutcome => ({ folder, summary: "processing_failed", results: [], error });
  try {
    const registry = await readRegistryObjects(registryImages, signal);
    const results = verifyCase(hwp, registry);
    return { folder, summary: summarizeCase(results), results };
  } catch (err) {
    if (err instanceof RegistryReadError) return fail(err.message);
    if ((err as Error)?.name === "AbortError") return fail("처리가 취소됐습니다.");
    // 예상하지 못한 오류: 서류 내용·폴더 이름(사람 이름일 수 있음)이 섞이지 않도록 오류 종류만 남긴다
    console.error(`[verify] 처리 실패: ${(err as Error)?.name ?? "Error"}`);
    return fail("처리 중 알 수 없는 오류가 났습니다.");
  }
}

/** 읽기 한 번의 결과 (브라우저가 모았다가 대조 요청에 함께 보낸다) */
export type PassOutcome = { ok: true; read: RegistryRead; total: number } | { ok: false; outcome: CaseOutcome };

/** 등기부를 index번째 설정으로 한 번만 읽는다 (2026-11-06: 요청마다 300초 한도 안에 끝나도록 나눔) */
export async function readCasePass(folder: string, images: PageImageObject[], index: number, signal?: AbortSignal): Promise<PassOutcome> {
  const fail = (error: string): PassOutcome => ({ ok: false, outcome: { folder, summary: "processing_failed", results: [], error } });
  try {
    return { ok: true, ...(await readRegistryPass(images, index, signal)) };
  } catch (err) {
    if (err instanceof RegistryReadError) return fail(err.message);
    if ((err as Error)?.name === "AbortError") return fail("처리가 취소됐습니다.");
    console.error(`[verify] 읽기 실패: ${(err as Error)?.name ?? "Error"}`);
    return fail("처리 중 알 수 없는 오류가 났습니다.");
  }
}

/** 모은 읽기 결과를 다수결로 합쳐 한글 서류 값과 대조한다 */
export function compareCase(folder: string, hwp: DocumentFields, reads: RegistryRead[]): CaseOutcome {
  const results = verifyCase(hwp, combineReads(reads));
  return { folder, summary: summarizeCase(results), results };
}
