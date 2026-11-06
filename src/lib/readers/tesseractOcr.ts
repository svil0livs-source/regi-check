// Design Ref: DESIGN.md §4.4 — Tesseract(오픈소스 글자 읽기)로 스캔 페이지를 읽어 줄·단어·확신도를 돌려준다.
// 2026-11-05 사용자 결정: 글자 읽기를 Tesseract로 바꿈 (무료, 서버 안에서 실행 → 서류가 밖으로 나가지 않음).
// 표 구조 해석은 registryParse.ts(순수 함수)가 한다.
import "server-only";
import path from "node:path";
import sharp from "sharp";
import { createWorker, type Worker } from "tesseract.js";

export interface OcrWord {
  text: string;
  /** 0~100 */
  confidence: number;
}
export interface OcrLine {
  /** 줄 글자 (칸 사이 띄어쓰기 유지) */
  text: string;
  words: OcrWord[];
}

let workerPromise: Promise<Worker> | null = null;

/** Tesseract 작업자는 한 번 만들어 계속 쓴다 (한국어 데이터를 매번 읽지 않게) */
function getWorker(): Promise<Worker> {
  workerPromise ??= (async () => {
    const worker = await createWorker("kor", 1, {
      // 정밀 데이터(best_int): 가짜 서류 시험에서 기본 데이터보다 정확했다
      langPath: path.join(process.cwd(), "node_modules", "@tesseract.js-data", "kor", "4.0.0_best_int"),
      gzip: true,
      cacheMethod: "none", // 서버 폴더에 캐시 파일을 쓰지 않는다
    });
    await worker.setParameters({ preserve_interword_spaces: "1" });
    return worker;
  })().catch((err) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

/**
 * 작업자 하나를 여러 요청이 함께 쓰면 페이지 해석 설정(psm)이 서로 섞이므로, 한 번에 한 페이지씩 차례로 읽는다.
 * (CHECK 10번: 서버가 동시에 여러 건을 받을 때)
 */
let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/** 작업자가 도중에 죽었으면 버리고, 다음 읽기에서 새로 만든다 (CHECK 10번) */
async function discardWorker() {
  const old = workerPromise;
  workerPromise = null;
  try {
    await (await old)?.terminate();
  } catch {
    // 이미 죽은 작업자는 정리할 것이 없다
  }
}

/**
 * 스캔 페이지 사진을 배율만큼 키워(흑백) 읽는다.
 * 글자가 작으면 잘못 읽기 쉬워서, 200dpi 스캔 기준 약 2배가 가장 정확했다.
 */
/**
 * 사진 손질 방식
 * - grey: 흑백 + 확대
 * - norm: 흑백 + 대비 늘리기 + 선명하게
 * - bin: 흑백 + 확대 후 완전 흑백(이진화, 밝기 기준 threshold)
 */
export type Prep = "grey" | "norm" | "bin";
/** Tesseract 페이지 해석: "3" 자동 배치, "4" 한 열의 글, "6" 한 덩어리 글 */
export type Psm = "3" | "4" | "6";

export interface RecognizeOptions {
  scale: number;
  prep?: Prep;
  psm?: Psm;
  /** prep=bin일 때 밝기 기준 (0~255) */
  threshold?: number;
}

export async function recognizePage(image: Buffer, opts: RecognizeOptions | number, signal?: AbortSignal): Promise<OcrLine[]> {
  const { scale, prep = "grey", psm = "3", threshold = 170 } = typeof opts === "number" ? { scale: opts } : opts;
  const meta = await sharp(image).metadata();
  const width = Math.round((meta.width ?? 1654) * scale);
  let pipeline = sharp(image).greyscale().resize({ width, kernel: "lanczos3" });
  if (prep === "norm") pipeline = pipeline.normalise().sharpen();
  if (prep === "bin") pipeline = pipeline.threshold(threshold);
  const prepared = await pipeline.png().toBuffer();
  const data = await oneAtATime(async () => {
    // 차례를 기다리는 동안 취소됐으면 읽지 않는다 (CHECK 11번)
    if (signal?.aborted) throw new DOMException("처리가 취소됐습니다.", "AbortError");
    const worker = await getWorker();
    try {
      await worker.setParameters({ tessedit_pageseg_mode: psm as never });
      return (await worker.recognize(prepared, {}, { blocks: true, text: false })).data;
    } catch (err) {
      await discardWorker();
      throw err;
    }
  });
  const lines: OcrLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        lines.push({
          text: line.text.replace(/\n/g, ""),
          words: line.words.map((w) => ({ text: w.text, confidence: w.confidence })),
        });
      }
    }
  }
  return lines;
}

/** 칸 하나를 읽은 줄 (상자는 넘겨준 사진 기준 좌표) */
export interface OcrBoxLine extends OcrLine {
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** 단어마다 상자 (words와 같은 순서) */
  wordBoxes: { x0: number; y0: number; x1: number; y1: number }[];
}

/**
 * 이미 손질한 사진(PNG) 하나를 읽어 줄마다 글자·단어 확신도·상자를 돌려준다. (2026-11-06 표 칸 단위 읽기)
 */
export async function recognizeImage(png: Buffer, psm: Psm | "7", signal?: AbortSignal, whitelist = ""): Promise<OcrBoxLine[]> {
  const data = await oneAtATime(async () => {
    if (signal?.aborted) throw new DOMException("처리가 취소됐습니다.", "AbortError");
    const worker = await getWorker();
    try {
      // whitelist: 순위번호 칸처럼 숫자만 있는 칸은 읽을 글자를 숫자로 좁힌다 (빈 값이면 제한 없음)
      await worker.setParameters({ tessedit_pageseg_mode: psm as never, tessedit_char_whitelist: whitelist });
      return (await worker.recognize(png, {}, { blocks: true, text: false })).data;
    } catch (err) {
      await discardWorker();
      throw err;
    }
  });
  const lines: OcrBoxLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        lines.push({
          text: line.text.replace(/\n/g, ""),
          words: line.words.map((w) => ({ text: w.text, confidence: w.confidence })),
          bbox: line.bbox,
          wordBoxes: line.words.map((w) => w.bbox),
        });
      }
    }
  }
  return lines;
}
