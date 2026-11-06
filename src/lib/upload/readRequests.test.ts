// 큰 등기부를 요청 한도에 맞게 나눠 보내는 규칙 시험 (2026-11-06)
import { describe, expect, it } from "vitest";
import type { PageImageObject } from "@/lib/readers/pdfPages";
import { MAX_REQUEST_BYTES, parseImageMeta } from "@/lib/verify/caseRequest";
import { chunkRoom, groupByPage, imageCost, readBody, takeChunk } from "./readRequests";

const img = (page: number, size: number): PageImageObject => ({
  page,
  dict: "/Type /XObject /Subtype /Image /Width 2480 /Height 3507 /Filter /DCTDecode",
  data: new Uint8Array(size),
});

/** 처음부터 끝까지 나눠 본다 (꾸러미 없이) */
function chunks(images: PageImageObject[], room: number): number[][] {
  const out: number[][] = [];
  for (let start = 0; start < images.length; ) {
    const end = takeChunk(images, start, room);
    if (end === start) throw new Error("못 나눔");
    out.push(images.slice(start, end).map((o) => o.page));
    start = end;
  }
  return out;
}

describe("takeChunk", () => {
  it("한 요청에 다 들어가면 한 번에 보낸다", () => {
    const images = [img(0, 500_000), img(1, 500_000)];
    expect(chunks(images, chunkRoom("A"))).toEqual([[0, 1]]);
  });

  it("실제 23쪽 등기부(13.9MB, 쪽마다 약 600KB)는 여러 요청으로 나뉘고, 요청마다 한도 안", () => {
    const images = Array.from({ length: 23 }, (_, p) => img(p, 600 * 1024 + (p % 3) * 70 * 1024));
    const room = chunkRoom("2026-0001", "x".repeat(200_000));
    const parts = chunks(images, room);
    expect(parts.flat()).toEqual(images.map((o) => o.page));
    expect(parts.length).toBeGreaterThan(3);
    for (const part of parts) {
      expect(part.reduce((n, p) => n + imageCost(images[p]), 0)).toBeLessThanOrEqual(room);
    }
  });

  it("한 페이지의 사진들은 같은 요청에 넣는다", () => {
    const images = [img(0, 100), img(1, 100), img(1, 100), img(2, 100)];
    const room = imageCost(images[0]) * 2 + 10;
    expect(chunks(images, room)).toEqual([[0], [1, 1], [2]]);
    expect(groupByPage(images).map((g) => g.length)).toEqual([1, 2, 1]);
  });

  it("첫 페이지도 안 들어가면 시작 위치를 그대로 돌려준다", () => {
    expect(takeChunk([img(0, 1000)], 0, 500)).toBe(0);
  });

  it("앞 조각 꾸러미가 크면 담을 수 있는 크기가 그만큼 준다", () => {
    expect(chunkRoom("A", "x".repeat(1000))).toBeLessThan(chunkRoom("A") - 1000);
    expect(chunkRoom("A")).toBeLessThan(MAX_REQUEST_BYTES);
  });
});

describe("readBody", () => {
  it("조각 정보와 사진을 서버가 받는 모양으로 담는다", () => {
    const body = readBody("A", [img(3, 10), img(4, 20)], { pass: 2, chunk: 1, last: false, carry: "abc" });
    expect(body.get("step")).toBe("read");
    expect(body.get("pass")).toBe("2");
    expect(body.get("chunk")).toBe("1");
    expect(body.get("last")).toBe("0");
    expect(body.get("carry")).toBe("abc");
    expect(parseImageMeta(String(body.get("images")))?.map((m) => m.page)).toEqual([3, 4]);
    expect((body.get("img1") as Blob).size).toBe(20);
    expect(readBody("A", [img(0, 1)], { pass: 0, chunk: 0, last: true }).get("carry")).toBeNull();
  });
});
