// 표 칸 찾기·취소선 찾기 시험 (2026-11-06). 그림을 직접 그려 시험한다.
import { describe, expect, it } from "vitest";
import { findGrid, isStruck, type GrayImage } from "./tableGrid";

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
