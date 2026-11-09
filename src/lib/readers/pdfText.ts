// Design Ref: DESIGN.md §4.1 — 글자 PDF(인터넷등기소에서 받은 등기부, 2026-11-09 사용자 결정)는 글자를 바로 읽는다.
// pdf.js가 꺼낸 글자 조각(위치 포함)을 줄로 묶어, 스캔본 표 읽기(registryTable.ts)가 만드는 줄 모양과 같게 만든다:
//   - 같은 높이의 조각은 한 줄, 왼쪽부터 차례로
//   - 칸 사이처럼 넓게 떨어진 조각 사이는 두 칸 띄움 (registryParse.ts가 칸을 나누는 기준)
// 글자를 그대로 읽으므로 확신도는 100이다. 읽은 글자는 메모리에서만 쓰고 저장·로그에 남기지 않는다.
// pdf.js에 기대지 않는 순수 함수라 시험할 수 있다 (pdf.js 부르기는 src/lib/upload/pdfTextLayer.ts).
import type { ParseLine } from "./registryParse";

/** pdf.js 글자 조각에서 쓰는 것만 */
export interface TextPiece {
  str: string;
  /** 왼쪽 아래 x, y (PDF 좌표: 위로 갈수록 y가 크다) */
  x: number;
  y: number;
  width: number;
  /** 글자 크기 (높이) */
  height: number;
}

/** 같은 줄로 볼 높이 차이 (글자 크기에 대한 비율) */
const SAME_LINE = 0.45;
/** 이만큼(글자 크기 배) 넘게 떨어지면 다른 칸으로 보고 두 칸 띄운다 */
const CELL_GAP = 1.2;
/** 이만큼 넘게 떨어지면 낱말 사이로 보고 한 칸 띄운다 */
const WORD_GAP = 0.15;

/** 한 페이지의 글자 조각들 → 줄들 (위에서 아래로) */
export function linesFromPieces(pieces: TextPiece[]): ParseLine[] {
  const items = pieces.filter((p) => p.str.trim() !== "").sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: TextPiece[][] = [];
  for (const p of items) {
    const row = rows[rows.length - 1];
    const size = Math.max(p.height, 1);
    if (row && Math.abs(row[0].y - p.y) <= size * SAME_LINE) row.push(p);
    else rows.push([p]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    let text = "";
    let end = -Infinity;
    for (const p of row) {
      const size = Math.max(p.height, 1);
      const gap = p.x - end;
      if (text) text += gap > size * CELL_GAP ? "  " : gap > size * WORD_GAP && !/\s$/.test(text) ? " " : "";
      text += p.str;
      end = Math.max(end, p.x + p.width);
    }
    text = text.replace(/\s+$/, "").replace(/^\s+/, "");
    return { text, words: text.split(/\s+/).filter(Boolean).map((w) => ({ text: w, confidence: 100 })) };
  });
}

/** 글자 PDF로 볼 만큼 글자가 있는지 (스캔본에 따라 붙는 짧은 글자·쪽 번호만 있는 경우는 아니다) */
export const looksLikeTextRegistry = (lines: ParseLine[]) => {
  const all = lines.map((l) => l.text).join("");
  return all.replace(/\s/g, "").length > 200 && /(표\s*제\s*부|갑\s*구|을\s*구)/.test(all);
};

const letters = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "");

/**
 * 페이지마다 줄로 묶고 이어 붙인다. 「주요 등기사항 요약(참고용)」 페이지는 증명서가 아니므로 뺀다
 * (스캔본 읽기와 같은 규칙, registryTable.ts).
 */
export function linesFromPages(pages: TextPiece[][]): ParseLine[] {
  return pages.flatMap((pieces) => {
    const lines = linesFromPieces(pieces);
    const head = letters(lines.slice(0, 4).map((l) => l.text).join(""));
    return head.includes("주요등기사항요약") ? [] : lines;
  });
}

/** pdf.js에서 쓰는 것만 (브라우저는 pdfjs-dist, 시험은 pdfjs-dist/legacy를 넘긴다) */
export interface PdfJsLike {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
    }>;
    destroy(): Promise<void>;
  };
}

/** PDF의 글자 조각을 페이지별로 꺼낸다 (글자가 없는 스캔본이면 조각이 거의 없다) */
export async function readTextPieces(pdfjs: PdfJsLike, data: Uint8Array): Promise<TextPiece[][]> {
  // pdf.js가 자료를 넘겨받아 비우므로 복사본을 준다
  const task = pdfjs.getDocument({ data: data.slice(), isEvalSupported: false });
  try {
    const doc = await task.promise;
    const pages: TextPiece[][] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const { items } = await (await doc.getPage(n)).getTextContent();
      pages.push(
        items.flatMap((it) => {
          const t = it as { str?: unknown; transform?: number[]; width?: number; height?: number };
          if (typeof t.str !== "string" || !t.transform) return [];
          return [{ str: t.str, x: t.transform[4], y: t.transform[5], width: t.width ?? 0, height: t.height || Math.abs(t.transform[3]) }];
        }),
      );
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
