// 읽기 결과 되돌려 받기 검사 (2026-11-06)
import { describe, expect, it } from "vitest";
import { parseRegistryReadGroups, parseRegistryReads } from "./caseRequest";

const v = (text: string | null) => ({ text, uncertain: false });
const read = {
  properties: [{ location: v("서울"), lotNumber: v("1"), unitNumber: v("101호"), area: v("59.82㎡") }],
  owners: [v("홍길동")],
  mortgages: [
    {
      rank: "1", receiptNumber: v("제1호"), registrationDate: v("2020년1월1일"), maxClaimAmount: v("금1원"),
      debtors: [v("홍길동")], mortgagee: v("가은행"), mortgageeIdFront: v("110111"),
      transfers: [{ rank: "1-1", receiptNumber: v("제2호"), registrationDate: v("2021년1월1일"), assignee: v("나은행"), assigneeIdFront: v("110112") }],
    },
  ],
};

describe("parseRegistryReads", () => {
  it("올바른 모양은 받는다", () => {
    expect(parseRegistryReads(JSON.stringify([read, read]))).toEqual([read, read]);
  });
  it("빈 목록·틀린 모양은 받지 않는다", () => {
    expect(parseRegistryReads("[]")).toBeNull();
    expect(parseRegistryReads("x")).toBeNull();
    expect(parseRegistryReads(JSON.stringify([{ ...read, owners: [{ text: 1, uncertain: false }] }]))).toBeNull();
  });
  it("등록번호 뒷자리가 섞이면 받지 않는다", () => {
    const bad = structuredClone(read);
    bad.mortgages[0].mortgageeIdFront = v("110111-1234567");
    expect(parseRegistryReads(JSON.stringify([bad]))).toBeNull();
  });
});

describe("parseRegistryReadGroups (2026-11-09: 스캔본 읽기 묶음 + 글자 PDF)", () => {
  it("묶음 목록을 받고, 모양이 틀린 묶음이 하나라도 있으면 받지 않는다", () => {
    expect(parseRegistryReadGroups(JSON.stringify([[read, read], [read]]))).toEqual([[read, read], [read]]);
    expect(parseRegistryReadGroups(JSON.stringify([[read], []]))).toBeNull();
    expect(parseRegistryReadGroups(JSON.stringify([]))).toBeNull();
    expect(parseRegistryReadGroups(JSON.stringify([[read], [read], [read], [read], [read]]))).toBeNull();
  });
});
