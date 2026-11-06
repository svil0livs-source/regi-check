// 여러 명·여러 개 짝짓기 시험 (DESIGN.md §4.7, §9 짝짓기 시험 목록)
import { describe, expect, it } from "vitest";
import type { DocumentFields, ExtractedValue, PropertyEntry } from "@/types/verification";
import { compareDocuments, compareParties, compareProperties } from "./compareDocuments";
import { summarizeCase } from "./summarize";

const v = (value: string | null, lowConfidence = false): ExtractedValue => ({ value, lowConfidence });
const names = (...list: string[]) => list.map((n) => v(n));
const statuses = (results: { status: string }[]) => results.map((r) => r.status);

const prop = (location: string, lotNumber: string, unitNumber: string, area: string): PropertyEntry => ({
  location: v(location),
  lotNumber: v(lotNumber),
  unitNumber: v(unitNumber),
  area: v(area),
});

describe("compareParties: 여러 명", () => {
  it("순서만 다르면 모두 일치", () => {
    const r = compareParties("debtor", names("홍길동", "김철수"), names("김철수", "홍길동"));
    expect(statuses(r)).toEqual(["match", "match"]);
  });

  it("한 명 이름이 틀리면 그 사람만 불일치", () => {
    const r = compareParties("debtor", names("홍길동", "김철수"), names("김철수", "홍길돈"));
    expect(statuses(r)).toEqual(["match", "mismatch"]);
    expect(r[1].hwpValue).toBe("홍길동");
    expect(r[1].registryValue).toBe("홍길돈");
  });

  it("한글 서류에 한 명이 빠지면 불일치 + 한글 서류에 없음", () => {
    const r = compareParties("debtor", names("홍길동"), names("홍길동", "김철수"));
    expect(statuses(r)).toEqual(["match", "mismatch"]);
    expect(r[1].hwpValue).toBeNull();
    expect(r[1].reason).toBe("한글 서류에 없음");
  });

  it("한글 서류에 한 명이 더 있으면 불일치 + 등기부등본에 없음", () => {
    const r = compareParties("debtor", names("홍길동", "이영희"), names("홍길동"));
    expect(statuses(r)).toEqual(["match", "mismatch"]);
    expect(r[1].reason).toBe("등기부등본에 없음");
  });

  it("남은 수가 다르고 이름도 틀리면 남은 사람 모두 불일치", () => {
    const r = compareParties("debtor", names("홍길동"), names("홍길돈", "김철수"));
    expect(statuses(r)).toEqual(["mismatch", "mismatch"]);
  });

  it("같은 이름이 한쪽에 2번 있으면 역할 전체 확인 필요", () => {
    const r = compareParties("debtor", names("홍길동", "홍길동"), names("홍길동", "김철수"));
    expect(statuses(r)).toEqual(["needs_review", "needs_review"]);
  });

  it("확신 낮은 이름이 하나라도 있으면 역할 전체 확인 필요 (값이 같아 보여도)", () => {
    const r = compareParties("debtor", names("홍길동", "김철수"), [v("홍길동"), v("김철수", true)]);
    expect(statuses(r)).toEqual(["needs_review", "needs_review"]);
  });

  it("읽지 못한 이름은 읽지 못함, 나머지는 확인 필요", () => {
    const r = compareParties("debtor", names("홍길동", "김철수"), [v("홍길동"), v(null)]);
    expect(statuses(r)).toEqual(["needs_review", "unreadable"]);
  });

  it("한자로만 적힌 이름은 짝을 지을 수 없어 확인 필요", () => {
    const r = compareParties("debtor", names("홍길동", "김철수"), names("洪吉童", "김철수"));
    expect(statuses(r)).toEqual(["needs_review", "needs_review"]);
  });

  it("한 명일 때는 기존과 같이 동작", () => {
    expect(statuses(compareParties("mortgagee", names("한국은행"), names("한국은행")))).toEqual(["match"]);
    expect(statuses(compareParties("mortgagee", names("한국은행"), names("한국은앵")))).toEqual(["mismatch"]);
  });

  it("양쪽 다 비어 있으면 결과 없음 (요약에서 확인 필요가 됨)", () => {
    expect(compareParties("mortgagee", [], [])).toEqual([]);
  });

  it("번호(index)를 1부터 붙인다", () => {
    const r = compareParties("debtor", names("홍길동", "김철수"), names("홍길동", "김철수"));
    expect(r.map((x) => x.index)).toEqual([1, 2]);
  });
});

describe("compareProperties: 여러 개", () => {
  const A = prop("서울특별시 강남구 역삼동", "123-4", "101동 1001호", "84.97㎡");
  const B = prop("서울특별시 강남구 역삼동", "123-5", "", "200㎡");

  it("순서만 다르면 모두 일치 (호수가 원래 빈칸인 토지 포함)", () => {
    const r = compareProperties([A, B], [B, A]);
    expect(statuses(r)).toEqual(Array(8).fill("match"));
  });

  it("호수가 한쪽에만 있으면 그 칸은 불일치", () => {
    const B2 = prop("서울특별시 강남구 역삼동", "123-5", "101호", "200㎡");
    const r = compareProperties([B], [B2]);
    expect(statuses(r)).toEqual(["match", "match", "mismatch", "match"]);
  });

  it("부동산 하나의 면적만 틀리면 면적만 불일치", () => {
    const A2 = prop("서울특별시 강남구 역삼동", "123-4", "101동 1001호", "84.79㎡");
    const r = compareProperties([A], [A2]);
    expect(statuses(r)).toEqual(["match", "match", "match", "mismatch"]);
  });

  it("짝 기준 칸(지번)이 틀려도 1:1로 남으면 짝지어 틀린 칸을 보여 준다", () => {
    const A2 = prop("서울특별시 강남구 역삼동", "123-9", "101동 1001호", "84.97㎡");
    const r = compareProperties([A], [A2]);
    expect(statuses(r)).toEqual(["match", "mismatch", "match", "match"]);
  });

  it("한쪽에만 있는 부동산은 4칸 모두 불일치 + 없음", () => {
    const r = compareProperties([A], [A, B]);
    const extra = r.filter((x) => x.index === 2);
    expect(statuses(extra)).toEqual(["mismatch", "mismatch", "mismatch", "mismatch"]);
    expect(extra[0].reason).toBe("한글 서류에 없음");
  });

  it("짝 없는 부동산이 양쪽에 2개 이상씩이면 모두 확인 필요", () => {
    const C = prop("서울특별시 서초구 서초동", "1", "", "10㎡");
    const D = prop("서울특별시 서초구 서초동", "2", "", "20㎡");
    const C2 = prop("서울특별시 서초구 서초동", "1-1", "", "10㎡");
    const D2 = prop("서울특별시 서초구 서초동", "2-1", "", "20㎡");
    const r = compareProperties([C, D], [C2, D2]);
    expect(new Set(statuses(r))).toEqual(new Set(["needs_review"]));
    expect(r.length).toBe(16);
  });

  it("짝 없는 부동산이 2:1로 남으면 모두 확인 필요 (어느 것이 빠졌는지 확신할 수 없음)", () => {
    const C = prop("부산광역시 해운대구 우동", "1", "", "10㎡");
    const D = prop("부산광역시 해운대구 우동", "2", "", "20㎡");
    const E = prop("부산광역시 해운대구 우동", "3", "", "30㎡");
    const r = compareProperties([C, D], [E]);
    expect(new Set(statuses(r))).toEqual(new Set(["needs_review"]));
  });

  it("양쪽 다 비어 있으면 결과 없음", () => {
    expect(compareProperties([], [])).toEqual([]);
  });
});

describe("compareDocuments + summarizeCase: 건 전체 (2026-11-06 양도증서 기준)", () => {
  const m = (receipt: string, date: string, rank: string) => ({ receiptNumber: v(receipt), registrationDate: v(date), rank: v(rank) });
  const base = (): DocumentFields => ({
    parties: { mortgagee: names("삼성화재해상보험주식회사"), debtor: names("홍길동") },
    properties: [prop("경기도 성남시 분당구 서현동", "255-1", "제8층 제씨-809호", "80㎡")],
    mortgages: [m("제14475호", "2020년03월13일", "3"), m("제2943호", "2022년01월19일", "4")],
    maxClaimAmount: v("금 504,000,000원"),
    mortgageeIdFront: v("110111"),
  });

  it("모두 같으면 전부 일치", () => {
    expect(summarizeCase(compareDocuments(base(), base()))).toBe("all_match");
  });

  it("근저당권마다 접수번호·접수일·순위를 대조한다", () => {
    const keys = compareDocuments(base(), base()).filter((r) => r.group === "mortgage").map((r) => `${r.key}${r.index}`);
    expect(keys.sort()).toEqual(["rank1", "rank2", "receiptNumber1", "receiptNumber2", "registrationDate1", "registrationDate2"]);
  });

  it("두 번째 근저당권 순위만 틀려도 불일치 있음", () => {
    const hwp = base();
    hwp.mortgages[1].rank = v("5");
    const r = compareDocuments(hwp, base());
    expect(r.find((x) => x.key === "rank" && x.index === 2)?.status).toBe("mismatch");
    expect(summarizeCase(r)).toBe("mismatch_found");
  });

  it("접수일이 하루 틀려도 불일치 있음", () => {
    const hwp = base();
    hwp.mortgages[0].registrationDate = v("2020년03월14일");
    expect(summarizeCase(compareDocuments(hwp, base()))).toBe("mismatch_found");
  });

  it("양도인 등록번호 앞자리가 한 자리 다르면 불일치 있음", () => {
    const hwp = base();
    hwp.mortgageeIdFront = v("110112");
    expect(summarizeCase(compareDocuments(hwp, base()))).toBe("mismatch_found");
  });

  it("등기부에 등록번호가 없으면 그 항목은 대조하지 않는다", () => {
    const registry = base();
    registry.mortgageeIdFront = v(null);
    const r = compareDocuments(base(), registry);
    expect(r.some((x) => x.key === "mortgageeIdFront")).toBe(false);
    expect(summarizeCase(r)).toBe("all_match");
  });

  it("공동 채무자 한 명이 빠지면 불일치 있음", () => {
    const registry = base();
    registry.parties.debtor = names("홍길동", "김철수");
    expect(summarizeCase(compareDocuments(base(), registry))).toBe("mismatch_found");
  });

  it("채권최고액이 다르면 불일치 있음", () => {
    const hwp = base();
    hwp.maxClaimAmount = v("금 504,000,001원");
    expect(summarizeCase(compareDocuments(hwp, base()))).toBe("mismatch_found");
  });
});
