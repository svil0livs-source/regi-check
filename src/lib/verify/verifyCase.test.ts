// 이전할 근저당권 찾기·대조 규칙 시험 (2026-11-06 양도증서 기준). 외부 서비스 없이 돈다.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { summarizeCase } from "@/lib/compare/summarize";
import type { DocumentFields, FieldResult } from "@/types/verification";
import type { OcrValue, RegistryMortgage, RegistryRead } from "@/lib/readers/registryOcr";
import { verifyCase } from "./verifyCase";

const o = (text: string | null, uncertain = false): OcrValue => ({ text, uncertain });
const v = (value: string | null) => ({ value });

const hwp = (n: 1 | 2 = 1): DocumentFields => ({
  parties: { mortgagee: [v("가나다보험주식회사")], debtor: [v("김가명")] },
  properties: [{ location: v("경기도 성남시 분당구 서현동"), lotNumber: v("255-1"), unitNumber: v("제8층 제씨-809호"), area: v("80㎡") }],
  mortgages: [
    { receiptNumber: v("제14475호"), registrationDate: v("2020년03월13일"), rank: v("3") },
    ...(n === 2 ? [{ receiptNumber: v("제2943호"), registrationDate: v("2022년01월19일"), rank: v("4") }] : []),
  ],
  maxClaimAmount: v(n === 2 ? "금 504,000,000원" : "금 300,000,000원"),
  mortgageeIdFront: v("110111"),
});

const mortgage = (over: Partial<RegistryMortgage> = {}): RegistryMortgage => ({
  rank: "3",
  receiptNumber: o("제14475호"),
  registrationDate: o("2020년3월13일"),
  maxClaimAmount: o("금 300,000,000원"),
  debtors: [o("김가명")],
  mortgagee: o("가나다보험주식회사"),
  mortgageeIdFront: o("110111"),
  transfers: [],
  ...over,
});
const second = () => mortgage({ rank: "4", receiptNumber: o("제2943호"), registrationDate: o("2022년1월19일"), maxClaimAmount: o("금 204,000,000원") });

const reg = (mortgages: RegistryMortgage[]): RegistryRead => ({
  properties: [{ location: o("경기도 성남시 분당구 서현동"), lotNumber: o("255-1"), unitNumber: o("제8층 제씨-809호"), area: o("80㎡") }],
  owners: [],
  mortgages,
});

const status = (rs: FieldResult[], key: string, index?: number) =>
  rs.filter((r) => r.key === key && (index === undefined || r.index === index)).map((r) => r.status);

describe("verifyCase: 이전할 근저당권 1건", () => {
  it("등기부 근저당권 1건이면 그것과 대조 → 전부 일치", () => {
    expect(summarizeCase(verifyCase(hwp(), reg([mortgage()])))).toBe("all_match");
  });

  it("여러 건 중 접수번호가 같은 것을 골라 대조", () => {
    const other = mortgage({ rank: "1", receiptNumber: o("제111호"), maxClaimAmount: o("금 1원") });
    expect(summarizeCase(verifyCase(hwp(), reg([other, mortgage()])))).toBe("all_match");
  });

  it("여러 건인데 같은 접수번호가 없으면 접수번호 불일치", () => {
    const rs = verifyCase(hwp(), reg([mortgage({ receiptNumber: o("제111호") }), mortgage({ receiptNumber: o("제222호") })]));
    expect(status(rs, "receiptNumber")).toEqual(["mismatch"]);
    expect(status(rs, "debtor")).toEqual(["needs_review"]);
    expect(summarizeCase(rs)).toBe("mismatch_found");
  });

  it("등기부 근저당권 1건인데 접수번호가 다르면 그 건과 비교해 불일치로 보여 준다", () => {
    const rs = verifyCase(hwp(), reg([mortgage({ receiptNumber: o("제14476호") })]));
    expect(status(rs, "receiptNumber")).toEqual(["mismatch"]);
    expect(status(rs, "rank")).toEqual(["match"]);
  });

  it("순위가 다르면 불일치", () => {
    expect(status(verifyCase(hwp(), reg([mortgage({ rank: "2" })])), "rank")).toEqual(["mismatch"]);
  });

  it("등기부 접수번호를 확신할 수 없으면 확인 필요", () => {
    const rs = verifyCase(hwp(), reg([mortgage({ receiptNumber: o("제14475호", true) }), mortgage({ receiptNumber: o("제222호") })]));
    expect(status(rs, "receiptNumber")).toEqual(["needs_review"]);
  });
});

describe("verifyCase: 이전할 근저당권 2건", () => {
  it("두 건을 각각 찾고 채권최고액은 합계로 대조 → 전부 일치", () => {
    const rs = verifyCase(hwp(2), reg([second(), mortgage()]));
    expect(summarizeCase(rs)).toBe("all_match");
    expect(rs.find((r) => r.key === "maxClaimAmount")?.registryValue).toBe("금 504,000,000원");
  });

  it("합계가 다르면 채권최고액 불일치", () => {
    const rs = verifyCase(hwp(2), reg([mortgage(), second()].map((m, i) => (i ? { ...m, maxClaimAmount: o("금 204,000,001원") } : m))));
    expect(status(rs, "maxClaimAmount")).toEqual(["mismatch"]);
  });

  it("한 건을 찾지 못하면 그 건 접수번호 불일치, 합계는 확인 필요", () => {
    const rs = verifyCase(hwp(2), reg([mortgage(), mortgage({ rank: "5", receiptNumber: o("제999호") })]));
    expect(status(rs, "receiptNumber", 2)).toEqual(["mismatch"]);
    expect(status(rs, "receiptNumber", 1)).toEqual(["match"]);
    expect(status(rs, "maxClaimAmount")).toEqual(["needs_review"]);
  });
});

describe("verifyCase: 양도인 = 지금 근저당권자", () => {
  it("이전 기록이 있으면 마지막 양수인이 양도인", () => {
    const m = mortgage({ mortgagee: o("옛은행"), mortgageeIdFront: o("120111"), transfers: [{ rank: "3-1", receiptNumber: o("제1호"), registrationDate: o("2021년1월1일"), assignee: o("가나다보험주식회사"), assigneeIdFront: o("110111") }] });
    expect(summarizeCase(verifyCase(hwp(), reg([m])))).toBe("all_match");
  });

  it("이미 한국자산관리공사로 이전된 등기부여도 그 전 권리자를 양도인으로 본다", () => {
    const m = mortgage({ transfers: [{ rank: "3-1", receiptNumber: o("제1호"), registrationDate: o("2026년11월1일"), assignee: o("한국자산관리공사"), assigneeIdFront: o("114671") }] });
    expect(summarizeCase(verifyCase(hwp(), reg([m])))).toBe("all_match");
  });

  it("양도인 이름이 다르면 불일치", () => {
    expect(status(verifyCase(hwp(), reg([mortgage({ mortgagee: o("가나다생명주식회사") })])), "mortgagee")).toEqual(["mismatch"]);
  });
});

describe("verifyCase: 등기부에 근저당권·표제부가 없을 때", () => {
  it("근저당권이 없으면 접수번호 불일치, 딸린 항목 확인 필요", () => {
    const rs = verifyCase(hwp(), reg([]));
    expect(status(rs, "receiptNumber")).toEqual(["mismatch"]);
    expect(status(rs, "mortgagee")).toEqual(["needs_review"]);
  });

  it("집합건물 표제부를 못 찾으면 부동산 표시는 확인 필요", () => {
    const r = reg([mortgage()]);
    r.properties = [];
    expect(status(verifyCase(hwp(), r), "location")).toEqual(["needs_review"]);
  });
});

describe("verifyCase: 한글 서류에 접수번호가 없을 때 (2026-11-07)", () => {
  it("등기부를 탓하지 않고 한글 서류에서 읽지 못했다고 알린다", () => {
    const h = hwp();
    h.mortgages = [{ receiptNumber: v(null), registrationDate: v(null), rank: v(null) }];
    h.parties.mortgagee = [v(null)];
    h.maxClaimAmount = v(null);
    const rs = verifyCase(h, reg([mortgage(), second()]));
    for (const key of ["receiptNumber", "mortgagee", "maxClaimAmount"]) {
      const r = rs.find((x) => x.key === key)!;
      expect(r.status).toBe("unreadable");
      expect(r.reason).toMatch(/^한글 서류에서 값을 읽지 못했습니다\. 한글 서류에 접수번호가 없어/);
    }
  });
});
