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

export async function recognizePage(image: Buffer, opts: RecognizeOptions | number): Promise<OcrLine[]> {
  const { scale, prep = "grey", psm = "3", threshold = 170 } = typeof opts === "number" ? { scale: opts } : opts;
  const meta = await sharp(image).metadata();
  const width = Math.round((meta.width ?? 1654) * scale);
  let pipeline = sharp(image).greyscale().resize({ width, kernel: "lanczos3" });
  if (prep === "norm") pipeline = pipeline.normalise().sharpen();
  if (prep === "bin") pipeline = pipeline.threshold(threshold);
  const prepared = await pipeline.png().toBuffer();
  const worker = await getWorker();
  await worker.setParameters({ tessedit_pageseg_mode: psm as never });
  const { data } = await worker.recognize(prepared, {}, { blocks: true, text: false });
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
