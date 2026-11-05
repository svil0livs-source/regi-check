// Design Ref: DESIGN.md §4.1 — 건 하나를 처리한다: 두 파일 읽기 → 근저당권 찾기 → 대조 → 요약. (PLAN 10번)
// 서버에서만 쓴다. 읽은 원문은 결과에 넣지 않고 로그에도 남기지 않는다.
import "server-only";

import { summarizeCase } from "@/lib/compare/summarize";
import { extractHwpFields } from "@/lib/readers/hwpFields";
import { isHangulFile, readHangulParagraphs } from "@/lib/readers/hangulFile";
import { HwpReadError } from "@/lib/readers/hwpText";
import { RegistryReadError } from "@/lib/readers/registryOcr";
import { readRegistry } from "@/lib/readers/registryRead";
import type { CaseSummary, FieldResult } from "@/types/verification";
import { verifyCase } from "./verifyCase";

export interface CaseOutcome {
  folder: string;
  summary: CaseSummary;
  results: FieldResult[];
  /** 처리 실패일 때 화면에 보일 이유 */
  error?: string;
}

const isPdf = (b: Buffer) => b.subarray(0, 5).toString("latin1") === "%PDF-";

export async function processCase(folder: string, hwpFile: Buffer, pdfFile: Buffer, signal?: AbortSignal): Promise<CaseOutcome> {
  const fail = (error: string): CaseOutcome => ({ folder, summary: "processing_failed", results: [], error });

  // 구버전·신버전 한글 파일을 모두 받는다 (2026-11-05). 확장자가 아니라 파일 내용으로 구분한다.
  if (!isHangulFile(hwpFile)) return fail("한글 파일 형식이 아닙니다. (.hwp·.hwpx·.hml을 받습니다)");
  if (!isPdf(pdfFile)) return fail("등기부등본 파일이 PDF 형식이 아닙니다.");

  try {
    const hwp = extractHwpFields(readHangulParagraphs(hwpFile));
    const registry = await readRegistry(pdfFile, signal);
    const results = verifyCase(hwp, registry);
    return { folder, summary: summarizeCase(results), results };
  } catch (err) {
    if (err instanceof HwpReadError || err instanceof RegistryReadError) return fail(err.message);
    if ((err as Error)?.name === "AbortError") return fail("처리가 취소됐습니다.");
    // 예상하지 못한 오류: 서류 내용·폴더 이름(사람 이름일 수 있음)이 섞이지 않도록 오류 종류만 남긴다
    console.error(`[verify] 처리 실패: ${(err as Error)?.name ?? "Error"}`);
    return fail("처리 중 알 수 없는 오류가 났습니다.");
  }
}
