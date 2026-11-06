// Design Ref: DESIGN.md §4.4 — 등기부 글자 읽기 진입점. 글자 읽기 방식을 고른다.
//   OCR_ENGINE=tesseract (기본, 2026-11-05 결정): 서버 안에서 Tesseract로 읽는다. 무료, 서류가 밖으로 나가지 않음.
//   OCR_ENGINE=openai: OpenAI로 읽는다 (registryOcr.ts). 크레딧 필요, 서류가 OpenAI로 전송됨.
// Tesseract는 같은 사진이면 늘 같은 결과를 내므로, 확대 배율을 바꿔 5번 읽고 값마다 다수결로 정한다.
import "server-only";

import { voteRegistryReads } from "./ocrVote";
import { decodePageImages, PdfImageError } from "./pdfImages";
import { selectPageImages, type PageImageObject } from "./pdfPages";
import { readRegistryImages, RegistryReadError, type RegistryRead } from "./registryOcr";
import { DEFAULT_CONF_MIN, parseRegistryLines, type ParseLine } from "./registryParse";
import { readTablePage } from "./registryTable";
import type { RecognizeOptions } from "./tesseractOcr";

/**
 * 읽기 설정 5개 (200dpi 스캔 기준, 가짜 서류 시험으로 고름).
 * - 페이지 해석 6(한 덩어리 글)이 기본 자동 배치(3)보다 훨씬 정확했다 (틀린 항목 37개 → 11개).
 * - 배율 1.5~2.25배가 좋고 2.5배 이상은 나빴다. 완전 흑백(이진화)은 밝기 기준 210에서만 쓸 만했다.
 * - 설정마다 실수가 달라서 값마다 다수결로 정한다.
 */
// 2026-11-06: 실제 등기부(300dpi)를 칸 단위로 읽어 보니 원본 크기 근처(200dpi 기준 배율 1.35~1.8 = 300dpi의 0.9~1.2배)가
// 가장 정확했고, 더 키우면 호수·면적을 놓쳤다. 배율은 200dpi 기준으로 적는다(registryTable.ts가 300dpi에 맞춰 나눈다).
const READS: RecognizeOptions[] = [
  { scale: 1.5, psm: "6" },
  { scale: 1.65, psm: "6" },
  { scale: 1.35, psm: "6" },
  { scale: 1.8, psm: "6" },
  { scale: 1.5, psm: "6", prep: "bin", threshold: 180 },
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
    const state = { skip: "none" as "none" | "skip" };
    for (const page of pages) {
      if (signal?.aborted) throw new RegistryReadError("처리가 취소됐습니다.");
      if (Date.now() - started > budgetMs) {
        if (reads.length >= MIN_READS) break;
        throw tooSlow();
      }
      lines.push(...(await readTablePage(page, opts, state, signal)));
    }
    if (Date.now() - started > budgetMs && reads.length >= MIN_READS) break; // 이번 읽기는 중간에 끊겼으므로 쓰지 않음
    reads.push(parseRegistryLines(lines, confMin));
    lastReadMs = Date.now() - t0;
  }
  if (reads.length < MIN_READS) throw tooSlow();
  return voteRegistryReads(reads);
}

/** 조각 사이에 이어지는 읽기 상태 (읽은 줄과 갑구 건너뛰기 상태) */
export interface PassCarry {
  lines: ParseLine[];
  skip: "none" | "skip";
}

/**
 * 읽기 한 조각의 결과: 마지막 조각을 끝까지 읽었으면 대조 항목 값, 아니면 다음 조각으로 넘길 상태.
 * nextPage: 시간 예산이 다 돼 중간에 멈췄으면 아직 읽지 않은 첫 페이지 번호 (브라우저가 그 페이지부터 다시 보낸다)
 */
export type PassResult =
  | { done: true; read: RegistryRead; total: number }
  | { done: false; carry: PassCarry; nextPage?: number };

/**
 * 2026-11-06: 오래 걸려도 끝까지 처리하도록, 브라우저가 읽기 설정 하나씩 따로 요청한다.
 * 2026-11-06: 파일 크기 한도를 없애 큰 등기부는 몇 쪽씩 나눠 보낸다. 앞 조각의 상태(carry)를 이어받아 읽고,
 * 마지막 조각(last)에서 모은 줄을 한꺼번에 해석해 대조 항목 값만 돌려준다(읽은 원문은 돌려주지 않음).
 * 2026-11-06 사용자 결정(검증 시간 제한 없앰): 요청 하나는 서버 한도(300초)를 넘을 수 없으므로,
 * 시간 예산이 다 되면 실패하지 않고 그때까지 읽은 상태와 다음 페이지 번호를 돌려준다. 페이지가 아무리 많아도 끝까지 읽는다.
 * total은 전체 읽기 횟수.
 */
export async function readRegistryPass(
  objects: PageImageObject[],
  index: number,
  signal?: AbortSignal,
  options: { carry?: PassCarry | null; last?: boolean; budgetMs?: number } = {},
): Promise<PassResult> {
  const { carry = null, last = true, budgetMs = Number(process.env.OCR_PASS_BUDGET_MS) || PASS_BUDGET_MS } = options;
  // OpenAI는 한 요청 안에서 여러 번 읽어 다수결까지 한다 (나눠 읽기는 하지 않는다)
  if ((process.env.OCR_ENGINE ?? "tesseract") === "openai") {
    if (carry || !last) throw new RegistryReadError("등기부등본이 커서 나눠 읽어야 하는데, OpenAI 읽기 방식은 나눠 읽기를 하지 않습니다.");
    let pages: Buffer[];
    try {
      pages = await decodePageImages(objects);
    } catch (err) {
      if (err instanceof PdfImageError) throw new RegistryReadError(err.message);
      throw err;
    }
    if (pages.length === 0) throw new RegistryReadError("스캔 사진이 들어 있는 PDF가 아니어서 읽을 수 없습니다. 스캐너로 만든 PDF를 넣어 주세요.");
    return { done: true, read: await readRegistryImages(pages, signal), total: 1 };
  }
  const opts = READS[index];
  if (!opts) throw new RegistryReadError("읽기 순서가 올바르지 않습니다.");
  const confMin = Number(process.env.OCR_CONF_MIN) || DEFAULT_CONF_MIN;
  const started = Date.now();
  const lines: ParseLine[] = [...(carry?.lines ?? [])];
  // 2026-11-06: 실제 스캔본은 표 칸 단위로 읽는다 (registryTable.ts)
  const state = { skip: carry?.skip ?? ("none" as "none" | "skip") };
  // 페이지마다 사진을 그때그때 풀어 읽는다 (중간에 멈출 때 어느 페이지까지 읽었는지 알 수 있도록)
  const byPage = new Map<number, PageImageObject[]>();
  for (const o of objects) byPage.set(o.page, [...(byPage.get(o.page) ?? []), o]);
  const order = [...byPage.keys()].sort((a, b) => a - b);
  let decoded = 0;
  let firstError: PdfImageError | null = null;
  for (const [k, pageNo] of order.entries()) {
    if (signal?.aborted) throw new RegistryReadError("처리가 취소됐습니다.");
    // 시간 예산이 다 됐으면 여기까지 읽은 것을 넘기고 멈춘다 (한 페이지는 반드시 읽는다)
    if (k > 0 && Date.now() - started > budgetMs) return { done: false, carry: { lines, skip: state.skip }, nextPage: pageNo };
    let images: Buffer[];
    try {
      images = await decodePageImages(byPage.get(pageNo)!);
    } catch (err) {
      if (!(err instanceof PdfImageError)) throw err;
      firstError ??= err;
      continue;
    }
    for (const page of images) {
      decoded++;
      lines.push(...(await readTablePage(page, opts, state, signal)));
    }
  }
  if (decoded === 0 && !carry) {
    throw new RegistryReadError(firstError?.message ?? "스캔 사진이 들어 있는 PDF가 아니어서 읽을 수 없습니다. 스캐너로 만든 PDF를 넣어 주세요.");
  }
  if (!last) return { done: false, carry: { lines, skip: state.skip } };
  return { done: true, read: parseRegistryLines(lines, confMin), total: READS.length };
}

/** 따로 읽은 결과들을 값마다 다수결로 합친다 */
export const combineReads = (reads: RegistryRead[]): RegistryRead => voteRegistryReads(reads);

/**
 * 요청 하나의 읽기 시간 예산: 이 시간이 지나면 다음 페이지를 읽지 않고 멈춰 다음 요청으로 넘긴다.
 * 서버 한도 300초 안에 페이지 하나(느리면 수십 초)와 응답까지 끝나도록 넉넉히 남긴다.
 */
const PASS_BUDGET_MS = 180_000;

/** 읽기 시간 예산 (서버 한도 300초 중 한글 파일 읽기·대조·응답 몫을 남김) */
const TIME_BUDGET_MS = 230_000;
/** 다수결에 쓸 최소 읽기 횟수 */
export const MIN_READS = 3;
