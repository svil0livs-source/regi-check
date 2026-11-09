// 글자 PDF 줄 묶기 시험 (2026-11-09). pdf.js 없이 글자 조각 위치만으로 시험한다.
import { describe, expect, it } from "vitest";
import { linesFromPages, linesFromPieces, looksLikeTextRegistry, type TextPiece } from "./pdfText";

const P = (str: string, x: number, y: number, size = 10): TextPiece => ({ str, x, y, width: str.length * size, height: size });

describe("linesFromPieces", () => {
  it("같은 높이는 한 줄로 왼쪽부터, 칸 사이는 두 칸 띄움, 위에서 아래로", () => {
    const lines = linesFromPieces([P("채권최고액", 300, 700), P("1", 20, 700), P("근저당권설정", 60, 701), P("제14475호", 60, 688)]);
    expect(lines.map((l) => l.text)).toEqual(["1  근저당권설정  채권최고액", "제14475호"]);
    expect(lines[0].words.every((w) => w.confidence === 100)).toBe(true);
  });

  it("붙어 있는 조각은 그대로, 조금 떨어진 조각은 한 칸 띄움", () => {
    expect(linesFromPieces([P("금", 0, 10), P("300,000,000원", 10, 10), P("채무자", 200, 10), P("김가명", 232, 10)]).map((l) => l.text)).toEqual(["금300,000,000원  채무자 김가명"]);
  });
});

describe("linesFromPieces: 같은 자리에 두 번 그린 글자", () => {
  it("한 번만 쓴다", () => {
    expect(linesFromPieces([P("근저당권설정", 60, 700), P("근저당권설정", 60.2, 700.1), P("1", 20, 700)]).map((l) => l.text)).toEqual(["1  근저당권설정"]);
  });
});

describe("linesFromPages", () => {
  it("「주요 등기사항 요약」 페이지는 뺀다", () => {
    const lines = linesFromPages([[P("【 을 구 】", 0, 100)], [P("주요 등기사항 요약 (참고용)", 0, 800), P("2  근저당권설정", 0, 700)]]);
    expect(lines.map((l) => l.text)).toEqual(["【 을 구 】"]);
  });
});

describe("looksLikeTextRegistry", () => {
  it("표제부·갑구·을구 글자가 충분하면 글자 PDF", () => {
    expect(looksLikeTextRegistry([{ text: "【 표 제 부 】 " + "가".repeat(300), words: [] }])).toBe(true);
    expect(looksLikeTextRegistry([{ text: "1/3", words: [] }])).toBe(false);
  });
});
