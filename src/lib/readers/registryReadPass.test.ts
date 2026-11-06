// 읽기 한 번을 시간 예산에 맞춰 중간에 멈추고 이어 읽는 규칙 시험 (2026-11-06, 검증 시간 제한 없앰)
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// 사진 풀기와 글자 읽기는 가짜로: 페이지 번호를 글자로 돌려준다
vi.mock("./pdfImages", () => ({
  PdfImageError: class extends Error {},
  decodePageImages: async (objs: { page: number }[]) => [Buffer.from(String(objs[0].page))],
}));
vi.mock("./registryTable", () => ({
  readTablePage: async (page: Buffer) => [{ text: `쪽${page.toString()}`, words: [] }],
}));
vi.mock("./registryOcr", () => ({ RegistryReadError: class extends Error {}, readRegistryImages: vi.fn() }));

import { readRegistryPass } from "./registryRead";

const objs = (pages: number[]) => pages.map((page) => ({ page, dict: "/Subtype /Image", data: new Uint8Array(1) }));

describe("readRegistryPass 시간 예산", () => {
  it("예산이 다 되면 실패하지 않고 읽은 줄과 다음 페이지 번호를 돌려준다 (한 페이지는 반드시 읽음)", async () => {
    const r = await readRegistryPass(objs([4, 5, 6]), 0, undefined, { last: true, budgetMs: -1 });
    expect(r).toEqual({ done: false, carry: { lines: [{ text: "쪽4", words: [] }], skip: "none" }, nextPage: 5 });
  });

  it("이어받은 줄 뒤에 붙여 읽고, 마지막 조각을 다 읽으면 해석한 결과를 낸다", async () => {
    const carry = { lines: [{ text: "쪽4", words: [] }], skip: "none" as const };
    const mid = await readRegistryPass(objs([5]), 0, undefined, { carry, last: false });
    expect(mid).toEqual({ done: false, carry: { lines: [{ text: "쪽4", words: [] }, { text: "쪽5", words: [] }], skip: "none" } });
    const end = await readRegistryPass(objs([6]), 0, undefined, { carry, last: true });
    expect(end.done).toBe(true);
  });
});
