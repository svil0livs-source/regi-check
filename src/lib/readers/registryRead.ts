// Design Ref: DESIGN.md §4.4 — 등기부 글자 읽기 진입점. 글자 읽기 방식을 고른다.
//   OCR_ENGINE=tesseract (기본, 2026-11-05 결정): 서버 안에서 Tesseract로 읽는다. 무료, 서류가 밖으로 나가지 않음.
//   OCR_ENGINE=openai: OpenAI로 읽는다 (registryOcr.ts). 크레딧 필요, 서류가 OpenAI로 전송됨.
// Tesseract는 같은 사진이면 늘 같은 결과를 내므로, 확대 배율을 바꿔 5번 읽고 값마다 다수결로 정한다.
import "server-only";

import { voteRegistryReads } from "./ocrVote";
import { extractJpegPages, readRegistryPdf, RegistryReadError, type RegistryRead } from "./registryOcr";
import { DEFAULT_CONF_MIN, parseRegistryLines } from "./registryParse";
import { recognizePage, type RecognizeOptions } from "./tesseractOcr";

/**
 * 읽기 설정 5개 (200dpi 스캔 기준, 가짜 서류 시험으로 고름).
 * - 페이지 해석 6(한 덩어리 글)이 기본 자동 배치(3)보다 훨씬 정확했다 (틀린 항목 37개 → 11개).
 * - 배율 1.5~2.25배가 좋고 2.5배 이상은 나빴다. 완전 흑백(이진화)은 밝기 기준 210에서만 쓸 만했다.
 * - 설정마다 실수가 달라서 값마다 다수결로 정한다.
 */
const READS: RecognizeOptions[] = [
  { scale: 1.5, psm: "6" },
  { scale: 1.75, psm: "6" },
  { scale: 2, psm: "6" },
  { scale: 2.25, psm: "6" },
  { scale: 2, psm: "6", prep: "bin", threshold: 210 },
];

export async function readRegistry(pdf: Buffer | Uint8Array, signal?: AbortSignal): Promise<RegistryRead> {
  if ((process.env.OCR_ENGINE ?? "tesseract") === "openai") return readRegistryPdf(pdf, signal);

  const pages = extractJpegPages(pdf);
  if (pages.length === 0) {
    throw new RegistryReadError("스캔 사진이 들어 있는 PDF가 아니어서 읽을 수 없습니다. 스캐너로 만든 PDF를 넣어 주세요.");
  }
  const confMin = Number(process.env.OCR_CONF_MIN) || DEFAULT_CONF_MIN;
  const reads: RegistryRead[] = [];
  for (const opts of READS) {
    if (signal?.aborted) throw new RegistryReadError("처리가 취소됐습니다.");
    const lines = [];
    for (const page of pages) lines.push(...(await recognizePage(page, opts)));
    reads.push(parseRegistryLines(lines, confMin));
  }
  return voteRegistryReads(reads);
}
