// Design Ref: DESIGN.md §4.4 — 실제 스캔 등기부를 표 칸 단위로 읽는다. (2026-11-06)
// 페이지마다 표 선을 찾아(tableGrid.ts) 칸을 하나씩 읽고, 취소선이 그어진(말소된) 글자 줄은 버린다.
// 한 표 줄의 칸들을 줄 순서대로 이어 붙여(칸 사이 두 칸 띄움) registryParse.ts가 읽던 줄 모양으로 돌려준다.
// 「주요 등기사항 요약(참고용)」 페이지는 증명서가 아니므로 읽지 않는다.
// 대조에 쓰지 않는 갑구(소유권)·대지권 표의 내용 칸은 읽지 않는다(시간 절약, 개인정보 최소화).
// 읽은 원문은 메모리에서만 쓰고 저장·로그에 남기지 않는다.
import "server-only";
import sharp from "sharp";
import type { ParseLine } from "./registryParse";
import { fuzzyIncludes } from "./registryParse";
import { findGrid, hasInk, isStruck, type Box, type GrayImage } from "./tableGrid";
import { recognizeImage, type OcrBoxLine, type RecognizeOptions } from "./tesseractOcr";

const letters = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "");

/**
 * 취소선이 그어진 글자는 읽기 결과에도 흔적이 남는다: 글자 사이에 '-'·'ㅡ'가 끼어든다 (예: "서울-성동구-행당동").
 * 선 찾기가 놓친 취소선 줄을 이것으로 한 번 더 거른다.
 */
const looksStruck = (text: string) => (text.match(/[가-힣]\s*[-~ㅡ—]\s*[가-힣0-9]/g) ?? []).length >= 2 || /ㅡ/.test(text);

/** 칸 읽기 결과: 남은 줄과, 글자가 있었는데 모두 취소선이었는지 */
interface BoxRead {
  lines: OcrBoxLine[];
  allStruck: boolean;
}

/** 칸(또는 페이지 일부)을 잘라 손질해 읽고, 취소선 줄은 뺀다 */
async function readBox(page: Buffer, gray: GrayImage, box: Box, opts: RecognizeOptions, signal?: AbortSignal, digits = false): Promise<BoxRead> {
  // 실제 등기부는 300dpi다. 읽기 설정의 배율(200dpi 기준)을 300dpi에 맞춰 줄인다.
  const scale = opts.scale / 1.5;
  const w = box.x1 - box.x0, h = box.y1 - box.y0;
  let pipe = sharp(page).extract({ left: box.x0, top: box.y0, width: w, height: h }).greyscale();
  if (scale !== 1) pipe = pipe.resize({ width: Math.round(w * scale), kernel: "lanczos3" });
  // 칸 가장자리에 여백을 줘야 글자 읽기가 안정적이다
  pipe = pipe.extend({ top: 20, bottom: 20, left: 20, right: 20, background: { r: 255, g: 255, b: 255 } });
  if (opts.prep === "bin") pipe = pipe.threshold(opts.threshold ?? 170);
  const png = await pipe.png().toBuffer();
  const all = (await recognizeImage(png, opts.psm ?? "6", signal, digits ? "0123456789-()전 " : "")).filter((l) => l.text.trim());
  const kept = all.filter((l) => {
    if (looksStruck(l.text)) return false;
    const b = {
      x0: box.x0 + Math.round((l.bbox.x0 - 20) / scale),
      y0: box.y0 + Math.round((l.bbox.y0 - 20) / scale),
      x1: box.x0 + Math.round((l.bbox.x1 - 20) / scale),
      y1: box.y0 + Math.round((l.bbox.y1 - 20) / scale),
    };
    const clamp = { x0: Math.max(box.x0, b.x0), y0: Math.max(box.y0, b.y0), x1: Math.min(box.x1, b.x1), y1: Math.min(box.y1, b.y1) };
    return !isStruck(gray, clamp);
  });
  return { lines: kept, allStruck: all.length > 0 && kept.length === 0 };
}

/**
 * 표 한 줄의 칸들 → 줄들.
 * 앞 칸들(순위번호·등기목적·접수·등기원인 등)은 칸 안의 줄을 한 줄로 이어 첫 줄에 두 칸 띄워 늘어놓고,
 * 마지막 칸(권리자 및 기타사항)은 「채무자 …」「근저당권자 …」처럼 줄마다 뜻이 있어 줄 그대로 둔다.
 * (예: "3번근저당권설정등" + "기말소", "철근콘크리트벽식구" + "조 84.97㎡"처럼 칸 안에서 줄이 바뀐 글자를 잇기 위해)
 */
function joinCells(cells: OcrBoxLine[][]): ParseLine[] {
  const front = cells.slice(0, -1).filter((c) => c.length);
  const last = cells[cells.length - 1] ?? [];
  const head: ParseLine[] = front.map((c) => ({ text: c.map((l) => l.text.trim()).join(" "), words: c.flatMap((l) => l.words) }));
  const first = last[0];
  const out: ParseLine[] = [];
  const firstParts = [...head, ...(first ? [{ text: first.text.trim(), words: first.words }] : [])];
  if (firstParts.length) out.push({ text: firstParts.map((p) => p.text).join("  "), words: firstParts.flatMap((p) => p.words) });
  for (const l of last.slice(1)) out.push({ text: l.text.trim(), words: l.words });
  return out;
}

type Skip = "none" | "skip";

/** 칸 하나짜리 제목 줄이 어느 표인지: 갑구·대지권 표는 내용을 읽지 않는다 */
function skipAfterTitle(text: string): Skip {
  const t = letters(text);
  if (fuzzyIncludes(t, "소유권에관한사항") || fuzzyIncludes(t, "대지권의표시") || fuzzyIncludes(t, "대지권의목적인토지")) return "skip";
  return "none";
}

/**
 * 스캔 페이지 하나 → 줄들. state는 페이지를 넘어 이어지는 표(갑구 등)를 기억한다.
 * 표를 하나도 못 찾은 페이지는 줄 단위로 통째로 읽는다(예전 방식과 같은 모양).
 */
export async function readTablePage(
  page: Buffer,
  opts: RecognizeOptions,
  state: { skip: Skip },
  signal?: AbortSignal,
): Promise<ParseLine[]> {
  const { data, info } = await sharp(page).greyscale().raw().toBuffer({ resolveWithObject: true });
  const gray: GrayImage = { width: info.width, height: info.height, data: new Uint8Array(data) };
  const grid = findGrid(gray);
  const top: Box = { x0: 0, y0: 0, x1: gray.width, y1: grid.length ? grid[0].y0 : gray.height };
  const head = (await readBox(page, gray, top, opts, signal)).lines;
  // 요약(참고용) 페이지는 말소되지 않은 사항만 간추린 것이라 증명서 대신 쓰지 않는다
  if (head.some((l) => fuzzyIncludes(letters(l.text), "주요등기사항요약"))) return [];
  const out: ParseLine[] = head.map(({ text, words }) => ({ text, words }));
  for (const row of grid) {
    const cells = row.cells.filter((c) => hasInk(gray, c));
    if (!cells.length) continue;
    if (row.cells.length === 1) {
      const { lines } = await readBox(page, gray, cells[0], opts, signal);
      const text = lines.map((l) => l.text).join(" ");
      // 칸 하나짜리 줄(표 제목)마다 다시 정한다: 제목 글자를 잘못 읽어도 을구를 건너뛰는 일이 없도록,
      // 갑구·대지권 제목을 확실히 읽은 경우에만 건너뛴다
      state.skip = skipAfterTitle(text);
      out.push(...lines.map(({ text, words }) => ({ text, words })));
      continue;
    }
    if (state.skip === "skip") continue;
    const read: BoxRead[] = [];
    // 갑구·을구 표(5칸)의 첫 칸은 순위번호: 숫자만 읽게 해 13을 18로 읽는 것 같은 실수를 줄인다
    const rankCol = row.cells.length === 5;
    for (const [k, c] of row.cells.entries()) read.push(hasInk(gray, c) ? await readBox(page, gray, c, opts, signal, rankCol && k === 0) : { lines: [], allStruck: false });
    // 등기목적·접수 칸 글자가 둘 다 모두 취소선이면 말소된 등기라 줄 전체를 버린다.
    // (순위번호 칸은 보지 않는다: 손으로 그린 동그라미·체크가 취소선처럼 보일 수 있다)
    if (read[1]?.allStruck && read[2]?.allStruck) continue;
    out.push(...joinCells(read.map((r) => r.lines)));
  }
  return out;
}
