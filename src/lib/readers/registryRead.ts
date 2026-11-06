// Design Ref: DESIGN.md §4.4 — 등기부 글자 읽기 진입점. 글자 읽기 방식을 고른다.
//   OCR_ENGINE=tesseract (기본, 2026-11-05 결정): 서버 안에서 Tesseract로 읽는다. 무료, 서류가 밖으로 나가지 않음.
//   OCR_ENGINE=openai: OpenAI로 읽는다 (registryOcr.ts). 크레딧 필요, 서류가 OpenAI로 전송됨.
// Tesseract는 같은 사진이면 늘 같은 결과를 내므로, 확대 배율을 바꿔 5번 읽고 값마다 다수결로 정한다.
import "server-only";

import { voteRegistryReads } from "./ocrVote";
import { decodePageImages, PdfImageError } from "./pdfImages";
import { selectPageImages, type PageImageObject } from "./pdfPages";
import { readRegistryImages, RegistryReadError, type RegistryRead } from "./registryOcr";
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

/** 등기부 PDF 파일을 읽는다 (글자 읽기 실제 시험용) */
export const readRegistry = (pdf: Buffer | Uint8Array, signal?: AbortSignal): Promise<RegistryRead> =>
  readRegistryObjects(selectPageImages(pdf), signal);

/**
 * 브라우저가 PDF에서 꺼내 보낸 페이지 사진 후보로 등기부를 읽는다. (2026-11-06)
 * 읽을 수 없으면 RegistryReadError.
 */
export async function readRegistryObjects(objects: PageImageObject[], signal?: AbortSignal): Promise<RegistryRead> {
  let pages: Buffer[];
  try {
    pages = await decodePageImages(objects);
  } catch (err) {
    if (err instanceof PdfImageError) throw new RegistryReadError(err.message);
    throw err;
  }
  if (pages.length > 0 && (process.env.OCR_ENGINE ?? "tesseract") === "openai") return readRegistryImages(pages, signal);
  if (pages.length === 0) {
    throw new RegistryReadError("스캔 사진이 들어 있는 PDF가 아니어서 읽을 수 없습니다. 스캐너로 만든 PDF를 넣어 주세요.");
  }
  const confMin = Number(process.env.OCR_CONF_MIN) || DEFAULT_CONF_MIN;
  // 서버 기능 한도(300초) 안에 「처리 실패」 이유를 돌려줄 수 있도록 읽기 시간 예산을 둔다.
  // 예산 안에 최소 횟수(3번)를 못 읽으면 실패로 알리고, 3번 이상 읽었으면 남은 읽기를 줄여 그 결과로 다수결한다.
  const budgetMs = Number(process.env.OCR_TIME_BUDGET_MS) || TIME_BUDGET_MS;
  const started = Date.now();
  const tooSlow = () =>
    new RegistryReadError(
      `등기부등본 페이지(${pages.length}쪽)가 많아 처리 시간 안에 다 읽지 못했습니다. 필요한 페이지만 담은 PDF로 다시 올려 주세요.`,
    );
  const reads: RegistryRead[] = [];
  let lastReadMs = 0;
  for (const opts of READS) {
    if (signal?.aborted) throw new RegistryReadError("처리가 취소됐습니다.");
    const elapsed = Date.now() - started;
    if (reads.length >= MIN_READS && elapsed + lastReadMs > budgetMs) break; // 다음 읽기가 예산을 넘길 것 같으면 멈춤
    const t0 = Date.now();
    const lines = [];
    for (const page of pages) {
      if (signal?.aborted) throw new RegistryReadError("처리가 취소됐습니다.");
      if (Date.now() - started > budgetMs) {
        if (reads.length >= MIN_READS) break;
        throw tooSlow();
      }
      lines.push(...(await recognizePage(page, opts, signal)));
    }
    if (Date.now() - started > budgetMs && reads.length >= MIN_READS) break; // 이번 읽기는 중간에 끊겼으므로 쓰지 않음
    reads.push(parseRegistryLines(lines, confMin));
    lastReadMs = Date.now() - t0;
  }
  if (reads.length < MIN_READS) throw tooSlow();
  return voteRegistryReads(reads);
}

/**
 * 2026-11-06: 오래 걸려도 끝까지 처리하도록, 브라우저가 읽기 설정 하나씩 따로 요청한다(요청마다 서버 한도 300초).
 * index번째 설정으로 한 번 읽어 대조 항목 값만 돌려준다(읽은 원문은 돌려주지 않음). total은 전체 읽기 횟수.
 */
export async function readRegistryPass(
  objects: PageImageObject[],
  index: number,
  signal?: AbortSignal,
): Promise<{ read: RegistryRead; total: number }> {
  let pages: Buffer[];
  try {
    pages = await decodePageImages(objects);
  } catch (err) {
    if (err instanceof PdfImageError) throw new RegistryReadError(err.message);
    throw err;
  }
  if (pages.length === 0) {
    throw new RegistryReadError("스캔 사진이 들어 있는 PDF가 아니어서 읽을 수 없습니다. 스캐너로 만든 PDF를 넣어 주세요.");
  }
  // OpenAI는 한 요청 안에서 여러 번 읽어 다수결까지 한다
  if ((process.env.OCR_ENGINE ?? "tesseract") === "openai") return { read: await readRegistryImages(pages, signal), total: 1 };
  const opts = READS[index];
  if (!opts) throw new RegistryReadError("읽기 순서가 올바르지 않습니다.");
  const confMin = Number(process.env.OCR_CONF_MIN) || DEFAULT_CONF_MIN;
  const started = Date.now();
  const lines = [];
  for (const page of pages) {
    if (signal?.aborted) throw new RegistryReadError("처리가 취소됐습니다.");
    if (Date.now() - started > PASS_BUDGET_MS) {
      throw new RegistryReadError(
        `등기부등본 페이지(${pages.length}쪽)가 많아 한 번 읽기에 서버 한도(300초)를 넘었습니다. 필요한 페이지만 담은 PDF로 다시 올려 주세요.`,
      );
    }
    lines.push(...(await recognizePage(page, opts, signal)));
  }
  return { read: parseRegistryLines(lines, confMin), total: READS.length };
}

/** 따로 읽은 결과들을 값마다 다수결로 합친다 */
export const combineReads = (reads: RegistryRead[]): RegistryRead => voteRegistryReads(reads);

/** 한 번 읽기 시간 예산 (서버 한도 300초 중 응답 몫을 남김) */
const PASS_BUDGET_MS = 280_000;

/** 읽기 시간 예산 (서버 한도 300초 중 한글 파일 읽기·대조·응답 몫을 남김) */
const TIME_BUDGET_MS = 230_000;
/** 다수결에 쓸 최소 읽기 횟수 */
export const MIN_READS = 3;
