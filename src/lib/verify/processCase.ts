// Design Ref: DESIGN.md §4.1 — 건 하나를 처리한다: 등기부 읽기 → 근저당권 찾기 → 대조 → 요약. (PLAN 10번)
// 2026-11-06: 한글 파일은 브라우저가 읽어 대조 항목 값만 보낸다(요청 한도 때문에). 여기서는 등기부만 읽는다.
// 서버에서만 쓴다. 읽은 원문은 결과에 넣지 않고 로그에도 남기지 않는다.
import "server-only";

import { summarizeCase } from "@/lib/compare/summarize";
import type { PageImageObject } from "@/lib/readers/pdfPages";
import { RegistryReadError, type RegistryRead } from "@/lib/readers/registryOcr";
import { combineReads, readRegistryObjects, readRegistryPass } from "@/lib/readers/registryRead";
import type { CaseSummary, DocumentFields, FieldResult } from "@/types/verification";
import { CarryKeyMissing, openCarry, sealCarry } from "./readCarry";
import { notInDocument, verifyCase } from "./verifyCase";

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
    return { folder, summary: summarizeCase(results, notInDocument(hwp)), results };
  } catch (err) {
    if (err instanceof RegistryReadError) return fail(err.message);
    if ((err as Error)?.name === "AbortError") return fail("처리가 취소됐습니다.");
    // 예상하지 못한 오류: 서류 내용·폴더 이름(사람 이름일 수 있음)이 섞이지 않도록 오류 종류만 남긴다
    console.error(`[verify] 처리 실패: ${(err as Error)?.name ?? "Error"}`);
    return fail("처리 중 알 수 없는 오류가 났습니다.");
  }
}

/**
 * 읽기 한 조각의 결과 (브라우저가 모았다가 대조 요청에 함께 보낸다).
 * 큰 등기부를 나눠 보낼 때 마지막 조각이 아니면 read 대신 암호화된 이어 읽기 꾸러미(carry)를 돌려준다.
 */
export type PassOutcome =
  | { ok: true; read: RegistryRead; total: number }
  | { ok: true; carry: string; nextPage?: number }
  | { ok: false; outcome: CaseOutcome };

/** 이번 요청이 몇 번째 읽기의 몇 번째 조각인지 */
export interface PassPosition {
  pass: number;
  chunk: number;
  last: boolean;
  /** 앞 조각이 돌려준 꾸러미 (첫 조각이면 없음) */
  carry?: string;
}

/** 등기부를 pass번째 설정으로 한 번 읽는다 (2026-11-06: 큰 파일은 조각으로 나누고, 시간이 다 되면 중간에 멈춰 다음 요청으로 넘김) */
export async function readCasePass(folder: string, images: PageImageObject[], at: PassPosition, signal?: AbortSignal): Promise<PassOutcome> {
  const fail = (error: string): PassOutcome => ({ ok: false, outcome: { folder, summary: "processing_failed", results: [], error } });
  try {
    let carry = null;
    if (at.chunk > 0) {
      carry = at.carry ? openCarry(at.carry, { folder, pass: at.pass, chunk: at.chunk }) : null;
      if (!carry) return fail("나눠 읽던 등기부의 앞부분 정보가 맞지 않거나 시간이 지났습니다. 같은 폴더를 다시 골라 처리해 주세요.");
    }
    const r = await readRegistryPass(images, at.pass, signal, { carry, last: at.last });
    if (r.done) return { ok: true, read: r.read, total: r.total };
    const sealed = sealCarry(r.carry, { folder, pass: at.pass, chunk: at.chunk + 1 });
    return r.nextPage === undefined ? { ok: true, carry: sealed } : { ok: true, carry: sealed, nextPage: r.nextPage };
  } catch (err) {
    if (err instanceof RegistryReadError) return fail(err.message);
    if (err instanceof CarryKeyMissing) return fail("서버 설정(READ_CARRY_KEY)이 없어 큰 등기부를 나눠 읽을 수 없습니다. 관리자에게 알려 주세요.");
    if ((err as Error)?.name === "AbortError") return fail("처리가 취소됐습니다.");
    console.error(`[verify] 읽기 실패: ${(err as Error)?.name ?? "Error"}`);
    return fail("처리 중 알 수 없는 오류가 났습니다.");
  }
}

/** 모은 읽기 결과를 다수결로 합쳐 한글 서류 값과 대조한다 */
/**
 * 대조: 읽기 묶음마다 다수결한 뒤 합친다 (2026-11-09: 스캔본 + 글자 PDF가 한 건에 함께 있을 수 있음).
 * 부동산·소유자·근저당권을 이어 붙이고, 같은 근저당권이 여러 등기부에 나오면 대조에서 한 건으로 본다 (verifyCase.ts).
 */
export function compareCase(folder: string, hwp: DocumentFields, groups: RegistryRead[][]): CaseOutcome {
  const voted = groups.map((g) => combineReads(g));
  const merged: RegistryRead = { properties: voted.flatMap((r) => r.properties), owners: voted.flatMap((r) => r.owners), mortgages: voted.flatMap((r) => r.mortgages) };
  const results = verifyCase(hwp, merged);
  return { folder, summary: summarizeCase(results, notInDocument(hwp)), results };
}
