// 비용 청구 검증: 스캔 페이지 사진 한 장을 서버 안 Tesseract로 여러 번 읽어 항목·금액만 돌려준다 (2026-11-20).
// 근이전 검증과 같은 글자 읽기 도구(tesseractOcr.ts)를 쓰지만 읽기 설정·해석은 따로 둔다. 읽은 원문은 돌려주지 않는다.
import "server-only";
import sharp from "sharp";
import { recognizePage, type RecognizeOptions } from "@/lib/readers/tesseractOcr";
import { eraseRules } from "./eraseRules";
import { parseClaimLines, parseReceiptPage } from "./parse";
import type { ClaimRead, Receipt } from "./types";
import { voteClaim, voteReceipts } from "./vote";

/** 배율·배치를 바꾼 읽기 세 번 (브라우저가 200dpi로 그린 페이지 기준) */
// 자동 배치(psm 3)는 표의 항목 칸과 금액 칸을 다른 덩어리로 나눠 줄이 끊어진다 → 줄을 지키는 4·6만 쓴다.
// 가짜 서류 시험에서 대비 늘리기(norm)·이진화(bin)는 표 선을 지운 페이지에서 오히려 잘못 읽어 흑백(grey)만 쓰고,
// 1.5배는 금액 숫자를 잘못 읽는 일이 있어 2배 이상만 쓴다 (2026-11-20)
export const COST_PASSES: RecognizeOptions[] = [
  { scale: 2, prep: "grey", psm: "6" },
  { scale: 2, prep: "grey", psm: "4" },
  { scale: 2.5, prep: "grey", psm: "4" },
];

/** 표 선을 지운 페이지 사진 (PNG) */
export async function withoutRules(image: Buffer): Promise<Buffer> {
  // 읽기 배율은 200dpi(A4 폭 약 1654점) 기준으로 맞췄다. 300dpi 원본 등 더 큰 사진은 그 폭으로 줄여 쓴다
  const meta = await sharp(image).metadata();
  const base = (meta.width ?? 0) > 1900 ? await sharp(image).resize({ width: 1654, kernel: "lanczos3" }).toBuffer() : image;
  const { data, info } = await sharp(base).greyscale().raw().toBuffer({ resolveWithObject: true });
  // 페이지 폭에 맞춰 선 길이 기준을 정한다 (A4 200dpi 폭 1654점 → 80점)
  const minRun = Math.max(40, Math.round(info.width * 0.048));
  const clean = eraseRules({ width: info.width, height: info.height, data: new Uint8Array(data) }, minRun);
  return sharp(Buffer.from(clean), { raw: { width: info.width, height: info.height, channels: 1 } }).png().toBuffer();
}

export async function readClaimImage(image: Buffer, page: number, signal?: AbortSignal): Promise<ClaimRead> {
  const clean = await withoutRules(image);
  const reads: ClaimRead[] = [];
  for (const opts of COST_PASSES) reads.push(parseClaimLines(await recognizePage(clean, opts, signal), page));
  return voteClaim(reads);
}

export async function readReceiptImage(image: Buffer, page: number, signal?: AbortSignal): Promise<Receipt[]> {
  const clean = await withoutRules(image);
  const reads: Receipt[][] = [];
  for (const opts of COST_PASSES) reads.push(parseReceiptPage(await recognizePage(clean, opts, signal), page));
  return voteReceipts(reads);
}
