// 근저당권·부기등기 찾기 규칙 시험 (DESIGN.md §4.3). 외부 서비스 없이 돈다.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { summarizeCase } from "@/lib/compare/summarize";
import type { DocumentFields, FieldResult } from "@/types/verification";
import type { OcrValue, RegistryMortgage, RegistryRead } from "@/lib/readers/registryOcr";
import { verifyCase } from "./verifyCase";

const o = (text: string | null, uncertain = false): OcrValue => ({ text, uncertain });
const v = (value: string | null) => ({ value });

const hwp = (): DocumentFields => ({
  parties: { mortgagee: [v("가나다은행")], assignee: [v("라마바자산")], debtor: [v("김가명")], owner: [v("김가명")] },
  properties: [{ location: v("서울특별시 강남구 역삼동"), lotNumber: v("123-4"), unitNumber: v("101호"), area: v("84.97㎡") }],
  maxClaimAmount: v("금 120,000,000원"),
  receiptNumber: v("제12345호"),
  transferReceiptNumber: v("제67890호"),
  registrationDate: v("2020년 3월 2일"),
  transferRegistrationDate: v("2026년 11월 4일"),
});

const mortgage = (over: Partial<RegistryMortgage> = {}): RegistryMortgage => ({
  rank: "1",
  receiptNumber: o("제12345호"),
  registrationDate: o("2020년3월2일"),
  maxClaimAmount: o("금 120,000,000원"),
  debtors: [o("김가명")],
  mortgagee: o("가나다은행"),
  transfers: [{ rank: "1-1", receiptNumber: o("제67890호"), registrationDate: o("2026년11월4일"), assignee: o("라마바자산") }],
  ...over,
});

const reg = (mortgages: RegistryMortgage[]): RegistryRead => ({
  properties: [{ location: o("서울특별시 강남구 역삼동"), lotNumber: o("123-4"), unitNumber: o("101호"), area: o("84.97㎡") }],
  owners: [o("김가명")],
  mortgages,
});

const status = (rs: FieldResult[], key: string) => rs.filter((r) => r.key === key).map((r) => r.status);

describe("verifyCase: 1단계 원 접수번호로 근저당권 찾기", () => {
  it("근저당권 1건이면 그것과 대조 → 전부 일치", () => {
    expect(summarizeCase(verifyCase(hwp(), reg([mortgage()])))).toBe("all_match");
  });

  it("근저당권 여러 건 중 접수번호가 같은 것을 골라 대조", () => {
    const other = mortgage({ rank: "1", receiptNumber: o("제11111호"), maxClaimAmount: o("금 50,000,000원"), transfers: [] });
    const rs = verifyCase(hwp(), reg([other, mortgage({ rank: "2" })]));
    expect(summarizeCase(rs)).toBe("all_match");
  });

  it("여러 건인데 같은 접수번호가 없으면 원 접수번호 불일치, 딸린 항목은 확인 필요", () => {
    const a = mortgage({ receiptNumber: o("제11111호") });
    const b = mortgage({ receiptNumber: o("제22222호") });
    const rs = verifyCase(hwp(), reg([a, b]));
    expect(status(rs, "receiptNumber")).toEqual(["mismatch"]);
    expect(rs.find((r) => r.key === "receiptNumber")?.registryValue).toBe("해당 접수번호 없음");
    for (const k of ["mortgagee", "debtor", "maxClaimAmount", "registrationDate", "assignee", "transferReceiptNumber", "transferRegistrationDate"]) {
      expect(status(rs, k), k).toEqual(["needs_review"]);
    }
    expect(summarizeCase(rs)).toBe("mismatch_found");
  });

  it("근저당권 1건이면 접수번호가 틀려도 그 건과 비교해 원 접수번호만 불일치", () => {
    const h = hwp();
    h.receiptNumber = v("제12346호");
    const rs = verifyCase(h, reg([mortgage()]));
    expect(status(rs, "receiptNumber")).toEqual(["mismatch"]);
    expect(status(rs, "maxClaimAmount")).toEqual(["match"]);
  });

  it("같은 접수번호 근저당권이 2건이면 확인 필요", () => {
    const rs = verifyCase(hwp(), reg([mortgage(), mortgage({ rank: "2" })]));
    expect(status(rs, "receiptNumber")).toEqual(["needs_review"]);
    expect(summarizeCase(rs)).toBe("needs_review");
  });

  it("등기부에 근저당권이 없으면 불일치", () => {
    const rs = verifyCase(hwp(), reg([]));
    expect(status(rs, "receiptNumber")).toEqual(["mismatch"]);
    expect(summarizeCase(rs)).toBe("mismatch_found");
  });

  it("한글 서류 원 접수번호를 못 읽고 근저당권이 여러 건이면: 원 접수번호 읽지 못함, 나머지 확인 필요", () => {
    const h = hwp();
    h.receiptNumber = v(null);
    const rs = verifyCase(h, reg([mortgage({ receiptNumber: o("제11111호") }), mortgage()]));
    expect(status(rs, "receiptNumber")).toEqual(["unreadable"]);
    expect(status(rs, "maxClaimAmount")).toEqual(["needs_review"]);
  });

  it("등기부의 접수번호가 불확실하면 그 건으로 짝짓지 않는다", () => {
    const rs = verifyCase(hwp(), reg([mortgage({ receiptNumber: o("제11111호") }), mortgage({ receiptNumber: o("제12345호", true) })]));
    expect(summarizeCase(rs)).not.toBe("all_match");
  });
});

describe("verifyCase: 2단계 이전 접수번호로 부기등기 찾기", () => {
  it("근저당권이전 기록이 없으면 이전 접수번호·양수인·이전 등기날짜 모두 불일치", () => {
    const rs = verifyCase(hwp(), reg([mortgage({ transfers: [] })]));
    for (const k of ["assignee", "transferReceiptNumber", "transferRegistrationDate"]) {
      expect(status(rs, k), k).toEqual(["mismatch"]);
    }
    expect(summarizeCase(rs)).toBe("mismatch_found");
  });

  it("부기등기가 여러 건이면 이전 접수번호가 같은 것을 골라 대조", () => {
    const m = mortgage({
      transfers: [
        { rank: "1-1", receiptNumber: o("제50000호"), registrationDate: o("2024년1월1일"), assignee: o("다른회사") },
        { rank: "1-2", receiptNumber: o("제67890호"), registrationDate: o("2026년11월4일"), assignee: o("라마바자산") },
      ],
    });
    expect(summarizeCase(verifyCase(hwp(), reg([m])))).toBe("all_match");
  });

  it("부기등기 여러 건 중 같은 이전 접수번호가 없으면 이전 접수번호 불일치, 양수인·이전 날짜 확인 필요", () => {
    const m = mortgage({
      transfers: [
        { rank: "1-1", receiptNumber: o("제50000호"), registrationDate: o("2024년1월1일"), assignee: o("A") },
        { rank: "1-2", receiptNumber: o("제50001호"), registrationDate: o("2025년1월1일"), assignee: o("B") },
      ],
    });
    const rs = verifyCase(hwp(), reg([m]));
    expect(status(rs, "transferReceiptNumber")).toEqual(["mismatch"]);
    expect(status(rs, "assignee")).toEqual(["needs_review"]);
    expect(status(rs, "transferRegistrationDate")).toEqual(["needs_review"]);
  });

  it("글자가 불확실하게 읽힌 값은 확인 필요", () => {
    const m = mortgage({ maxClaimAmount: o("금 120,000,000원", true) });
    const rs = verifyCase(hwp(), reg([m]));
    expect(status(rs, "maxClaimAmount")).toEqual(["needs_review"]);
  });
});
