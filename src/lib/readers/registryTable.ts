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
import { findGrid, hasInk, isStruck, unitGlyphStart, withoutHandwriting, type Box, type GrayImage } from "./tableGrid";
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
  /** 사진 → 페이지 좌표 바꾸기 */
  toPage: (b: Box) => Box;
}

/** 칸(또는 페이지 일부)을 잘라 손질해 읽고, 취소선 줄은 뺀다 */
async function readBox(page: Buffer, gray: GrayImage, box: Box, opts: RecognizeOptions, signal?: AbortSignal, digits = false, clean = false, zoom = 1): Promise<BoxRead> {
  // 실제 등기부는 300dpi다. 읽기 설정의 배율(200dpi 기준)을 300dpi에 맞춰 줄인다.
  const scale = (opts.scale / 1.5) * zoom;
  const w = box.x1 - box.x0, h = box.y1 - box.y0;
  // 표 칸은 볼펜 동그라미·체크 같은 손글씨를 지우고 읽는다 (취소선 찾기는 원래 사진으로 한다).
  // 페이지 머리·표 제목은 큰 글씨가 있어 지우지 않는다.
  const cleaned = clean ? withoutHandwriting(gray, box, digits) : null;
  let pipe = cleaned
    ? sharp(Buffer.from(cleaned), { raw: { width: w, height: h, channels: 1 } })
    : sharp(page).extract({ left: box.x0, top: box.y0, width: w, height: h }).greyscale();
  if (scale !== 1) pipe = pipe.resize({ width: Math.round(w * scale), kernel: "lanczos3" });
  // 칸 가장자리에 여백을 줘야 글자 읽기가 안정적이다
  pipe = pipe.extend({ top: 20, bottom: 20, left: 20, right: 20, background: { r: 255, g: 255, b: 255 } });
  if (opts.prep === "bin") pipe = pipe.threshold(opts.threshold ?? 170);
  const png = await pipe.png().toBuffer();
  const all = (await recognizeImage(png, opts.psm ?? "6", signal, digits ? "0123456789-()전 " : "")).filter((l) => l.text.trim());
  const toPage = (b: Box): Box => ({
    x0: Math.max(box.x0, box.x0 + Math.round((b.x0 - 20) / scale)),
    y0: Math.max(box.y0, box.y0 + Math.round((b.y0 - 20) / scale)),
    x1: Math.min(box.x1, box.x0 + Math.round((b.x1 - 20) / scale)),
    y1: Math.min(box.y1, box.y0 + Math.round((b.y1 - 20) / scale)),
  });
  // 취소선 찾기도 손글씨를 지운 사진으로 한다 (볼펜 동그라미가 글자를 가로지르면 취소선으로 오해한다)
  const cellImg: GrayImage | null = cleaned ? { width: w, height: h, data: cleaned } : null;
  const struck = (b: Box) => {
    const pb = toPage(b);
    return cellImg ? isStruck(cellImg, { x0: pb.x0 - box.x0, y0: pb.y0 - box.y0, x1: pb.x1 - box.x0, y1: pb.y1 - box.y0 }) : isStruck(gray, pb);
  };
  const kept = all.filter((l) => !looksStruck(l.text) && !struck(l.bbox));
  return { lines: kept, allStruck: all.length > 0 && kept.length === 0, toPage };
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
    const none: BoxRead = { lines: [], allStruck: false, toPage: (b) => b };
    for (const [k, c] of row.cells.entries()) {
      if (!hasInk(gray, c)) read.push(none);
      else if (rankCol && k === 0) read.push(await readRank(page, gray, c, signal));
      else read.push(await readBox(page, gray, c, opts, signal, false, true));
    }
    // 등기목적·접수 칸 글자가 둘 다 모두 취소선이면 말소된 등기라 줄 전체를 버린다.
    // (순위번호 칸은 보지 않는다: 손으로 그린 동그라미·체크가 취소선처럼 보일 수 있다)
    if (read[1]?.allStruck && read[2]?.allStruck) continue;
    for (const r of read) await fixAreas(page, gray, r, opts, signal);
    out.push(...joinCells(read.map((r) => r.lines)));
  }
  return out;
}

/**
 * 순위번호 칸: 원래 크기와 2배 크기로 두 번 읽어, 확신 있는 읽기의 숫자를 쓴다 (2026-11-06).
 * 손글씨를 지운 뒤에도 한 크기에서는 8을 6으로(확신도 0), 13을 135로 읽는 일이 있었다. 확신 있는 두 읽기가 다르면 비운다(→ 「읽지 못함」).
 */
async function readRank(page: Buffer, gray: GrayImage, box: Box, signal?: AbortSignal): Promise<BoxRead> {
  // 순위번호는 읽기 설정(배율·흑백)과 상관없이 늘 같은 방법으로 읽는다: 설정마다 결과가 달라 다수결이 갈렸다
  const fixed: RecognizeOptions = { scale: 1.5, psm: "6" };
  const a = await readBox(page, gray, box, fixed, signal, true, true, 1);
  const b = await readBox(page, gray, box, fixed, signal, true, true, 2);
  const num = (r: BoxRead) => r.lines.map((l) => l.text).join(" ").replace(/\s+/g, "");
  const conf = (r: BoxRead) => Math.min(100, ...r.lines.flatMap((l) => l.words.map((w) => w.confidence)));
  // 순위번호 모양("13", "6-1")이고 확신도 80 이상이면 원래 크기 읽기를 먼저 믿고, 아니면 2배 크기 읽기를 본다
  // (2배 크기는 손글씨 옆 숫자에 강하지만, 멀쩡한 13을 135로 읽기도 했다)
  const ok = (r: BoxRead) => /^\d+(-\d+)?$/.test(num(r)) && conf(r) >= 80;
  if (ok(a)) return a;
  if (ok(b)) return b;
  return { lines: [], allStruck: a.allStruck && b.allStruck, toPage: b.toPage };
}

/**
 * 전유부분 「건물내역」 칸의 면적 숫자를 다시 읽는다 (2026-11-06).
 * ㎡(m 뒤 위첨자 ²)를 숫자 "1" 등으로 읽어 114.62㎡가 "114.621"이 되는 일이 잦아,
 * 숫자 상자에서 단위 기호 모양을 찾아 잘라 내고 숫자만 다시 읽어 "114.62㎡"로 바꾼다.
 * 단위 기호를 찾지 못하면 그대로 둔다(그러면 해석 단계가 확신하지 않음으로 둔다).
 * 1동 건물 표의 층별 면적처럼 줄이 많은 칸은 대조에 쓰지 않으므로 하지 않는다.
 */
async function fixAreas(page: Buffer, gray: GrayImage, r: BoxRead, opts: RecognizeOptions, signal?: AbortSignal) {
  // 구조 이름은 「…구조」 말고도 「철근콘크리트라멘조」「벽돌조」처럼 「조」로 끝난다
  if (r.lines.length > 5 || !/조/.test(r.lines.map((l) => l.text).join(" "))) return;
  for (const line of r.lines) {
    // "114 .621'"처럼 숫자가 여러 단어로 쪼개질 수 있다: 숫자로 시작하는 첫 단어부터 줄 끝까지를 면적 자리로 본다
    if (!/\d\s*\.\s*\d/.test(line.text)) continue;
    const i = line.words.findIndex((w) => /^\d/.test(w.text));
    if (i < 0 || !line.wordBoxes[i]) continue;
    const tail = line.wordBoxes.slice(i);
    const box = r.toPage({ x0: tail[0].x0, y0: Math.min(...tail.map((b) => b.y0)), x1: Math.max(...tail.map((b) => b.x1)), y1: Math.max(...tail.map((b) => b.y1)) });
    const pad = { x0: box.x0 - 4, y0: box.y0 - 6, x1: Math.min(gray.width, box.x1 + 30), y1: box.y1 + 6 };
    const cut = unitGlyphStart(gray, pad);
    if (cut === null || cut - pad.x0 < 20) continue;
    const scale = opts.scale / 1.5;
    const w = cut - 2 - pad.x0, h = pad.y1 - pad.y0;
    let pipe = sharp(page).extract({ left: pad.x0, top: pad.y0, width: w, height: h }).greyscale();
    if (scale !== 1) pipe = pipe.resize({ width: Math.round(w * scale), kernel: "lanczos3" });
    pipe = pipe.extend({ top: 20, bottom: 20, left: 20, right: 20, background: { r: 255, g: 255, b: 255 } });
    const digits = await recognizeImage(await pipe.png().toBuffer(), "7", signal, "0123456789.,");
    const num = digits.map((d) => d.text).join("").replace(/\s+/g, "");
    if (!/^\d[\d,]*\.\d+$/.test(num)) continue;
    const conf = Math.min(...digits.flatMap((d) => d.words.map((x) => x.confidence)));
    line.words.splice(i, line.words.length - i, { text: `${num}㎡`, confidence: conf });
    line.wordBoxes.splice(i);
    line.text = line.words.map((x) => x.text).join(" ");
  }
}
