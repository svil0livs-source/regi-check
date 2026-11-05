// Design Ref: DESIGN.md §4.4 — 등기부 글자 읽기 진입점. 글자 읽기 방식을 고른다.
//   OCR_ENGINE=tesseract (기본, 2026-11-05 결정): 서버 안에서 Tesseract로 읽는다. 무료, 서류가 밖으로 나가지 않음.
//   OCR_ENGINE=openai: OpenAI로 읽는다 (registryOcr.ts). 크레딧 필요, 서류가 OpenAI로 전송됨.
// Tesseract는 같은 사진이면 늘 같은 결과를 내므로, 확대 배율을 바꿔 5번 읽고 값마다 다수결로 정한다.
import "server-only";

import { voteRegistryReads } from "./ocrVote";
import { extractJpegPages, readRegistryPdf, RegistryReadError, type RegistryRead } from "./registryOcr";
import { DEFAULT_CONF_MIN, parseRegistryLines } from "./registryParse";
import { recognizePage } from "./tesseractOcr";

/** 배율 5개: 배율마다 실수가 달라 다수결이 안정적이다 (200dpi 스캔 기준, 가짜 서류 시험) */
const SCALES = [1.5, 1.75, 2, 2.25, 2.5];

export async function readRegistry(pdf: Buffer | Uint8Array, signal?: AbortSignal): Promise<RegistryRead> {
  if ((process.env.OCR_ENGINE ?? "tesseract") === "openai") return readRegistryPdf(pdf, signal);

  const pages = extractJpegPages(pdf);
  if (pages.length === 0) {
    throw new RegistryReadError("스캔 사진이 들어 있는 PDF가 아니어서 읽을 수 없습니다. 스캐너로 만든 PDF를 넣어 주세요.");
  }
  const confMin = Number(process.env.OCR_CONF_MIN) || DEFAULT_CONF_MIN;
  const reads: RegistryRead[] = [];
  for (const scale of SCALES) {
    if (signal?.aborted) throw new RegistryReadError("처리가 취소됐습니다.");
    const lines = [];
    for (const page of pages) lines.push(...(await recognizePage(page, scale)));
    reads.push(parseRegistryLines(lines, confMin));
  }
  return voteRegistryReads(reads);
}
