// 표 칸 찾기·취소선 찾기 시험 (2026-11-06). 그림을 직접 그려 시험한다.
import { describe, expect, it } from "vitest";
import { findGrid, isStruck, unitGlyphCuts, unitGlyphStart, withoutHandwriting, type GrayImage } from "./tableGrid";

function blank(w: number, h: number): GrayImage {
  return { width: w, height: h, data: new Uint8Array(w * h).fill(255) };
}
const hline = (img: GrayImage, y: number, x0: number, x1: number) => {
  for (let x = x0; x <= x1; x++) img.data[y * img.width + x] = 0;
};
const vline = (img: GrayImage, x: number, y0: number, y1: number) => {
  for (let y = y0; y <= y1; y++) img.data[y * img.width + x] = 0;
};

describe("findGrid", () => {
  it("가로선 3개·세로선으로 줄 2개와 칸을 찾는다 (제목 줄은 칸 하나)", () => {
    const img = blank(1000, 400);
    hline(img, 50, 20, 980);
    hline(img, 150, 20, 980);
    hline(img, 300, 20, 980);
    vline(img, 20, 50, 300);
    vline(img, 980, 50, 300);
    for (const x of [200, 500]) vline(img, x, 150, 300); // 두 번째 줄만 세 칸
    const rows = findGrid(img);
    expect(rows).toHaveLength(2);
    expect(rows[0].cells).toHaveLength(1);
    expect(rows[1].cells).toHaveLength(3);
  });

  it("칸 안의 짧은 취소선은 표 가로선으로 보지 않는다", () => {
    const img = blank(1000, 400);
    hline(img, 50, 20, 980);
    hline(img, 300, 20, 980);
    hline(img, 170, 300, 700); // 취소선
    expect(findGrid(img)).toHaveLength(1);
  });

  it("살짝 기운 가로선도 찾는다", () => {
    const img = blank(1000, 300);
    for (let x = 20; x <= 980; x++) img.data[(50 + Math.floor((x - 20) / 400)) * 1000 + x] = 0;
    hline(img, 250, 20, 980);
    expect(findGrid(img)).toHaveLength(1);
  });
});

describe("isStruck", () => {
  it("글자 줄 가운데를 가로지르는 선이 있으면 취소선", () => {
    const img = blank(400, 60);
    hline(img, 30, 10, 390);
    expect(isStruck(img, { x0: 0, y0: 10, x1: 400, y1: 50 })).toBe(true);
  });
  it("선이 없으면 취소선이 아니다", () => {
    const img = blank(400, 60);
    for (let x = 10; x < 390; x += 20) vline(img, x, 15, 45); // 글자 획처럼 세로 획만
    expect(isStruck(img, { x0: 0, y0: 10, x1: 400, y1: 50 })).toBe(false);
  });
});

describe("unitGlyphStart (면적 뒤 ㎡ 기호 찾기)", () => {
  /** 사각형 하나를 칠한다 */
  const rect = (img: GrayImage, x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) img.data[y * img.width + x] = 0;
  };
  // 숫자 "1","1","4", ".", "6","2" (키 30) + "m"(소문자 키 20, 두 덩어리로 갈라짐) + 위첨자 "²"
  const draw = () => {
    const img = blank(300, 60);
    for (const x of [10, 30, 50]) rect(img, x, 10, x + 12, 40);
    rect(img, 70, 37, 73, 40); // 소수점
    for (const x of [80, 100]) rect(img, x, 10, x + 14, 40);
    rect(img, 125, 20, 129, 40); // m 첫 획
    rect(img, 132, 20, 148, 40); // m 나머지
    rect(img, 151, 10, 157, 19); // 위첨자 ²
    return img;
  };
  it("갈라진 m까지 포함해 단위 기호가 시작하는 곳을 찾는다", () => {
    expect(unitGlyphStart(draw(), { x0: 0, y0: 0, x1: 300, y1: 60 })).toBe(125);
  });
  it("끝 숫자가 m에 붙어 한 덩어리여도 숫자 뒤(m 시작)에서 자른다", () => {
    const img = blank(300, 60);
    for (const x of [10, 30, 50]) rect(img, x, 10, x + 12, 40);
    rect(img, 70, 37, 73, 40); // 소수점
    rect(img, 80, 10, 94, 40); // "6"
    rect(img, 100, 10, 114, 40); // "2"
    rect(img, 115, 20, 135, 40); // "m" (2에 붙음)
    rect(img, 139, 10, 145, 19); // 위첨자 ²
    const cuts = unitGlyphCuts(img, { x0: 0, y0: 0, x1: 300, y1: 60 });
    expect(cuts[0]).toBe(115);
    expect(cuts.every((c) => c >= 115 && c < 136)).toBe(true);
  });
  it("단위 기호가 없으면 null", () => {
    const img = blank(300, 60);
    for (const x of [10, 30, 50]) rect(img, x, 10, x + 12, 40);
    expect(unitGlyphStart(img, { x0: 0, y0: 0, x1: 300, y1: 60 })).toBeNull();
  });
});

describe("withoutHandwriting (볼펜 동그라미·체크 지우기)", () => {
  it("글자보다 훨씬 높은 옅은 선(동그라미 일부)은 지우고, 진한 인쇄 글자는 남긴다", () => {
    const img = blank(200, 200);
    for (let y = 80; y < 110; y++) for (let x = 90; x < 105; x++) img.data[y * 200 + x] = 20; // 인쇄 숫자
    for (let y = 10; y < 190; y++) img.data[y * 200 + 30] = 170; // 옅은 볼펜 세로 획
    const out = withoutHandwriting(img, { x0: 0, y0: 0, x1: 200, y1: 200 });
    expect(out[95 * 200 + 95]).toBe(20);
    expect(out[100 * 200 + 30]).toBe(255);
  });
});
