// 건 요약 판정 시험: 불일치 > 확인 필요 > 전부 일치 순서와 빠진 항목 처리를 확인한다.
import { describe, expect, it } from "vitest";
import {
  ALL_FIELD_KEYS,
  FIELD_DEFINITIONS,
  type FieldKey,
  type FieldResult,
  type FieldStatus,
} from "@/types/verification";
import { summarizeCase } from "./summarize";

/** 11개 항목을 모두 일치로 만들고, 일부만 원하는 상태로 바꾼다. */
function results(overrides: Partial<Record<FieldKey, FieldStatus>> = {}): FieldResult[] {
  return ALL_FIELD_KEYS.map((key) => ({
    key,
    group: FIELD_DEFINITIONS[key].group,
    hwpValue: "값",
    registryValue: "값",
    status: overrides[key] ?? "match",
  }));
}

describe("summarizeCase", () => {
  it("11개 항목이 모두 일치하면 전부 일치", () => {
    expect(summarizeCase(results())).toBe("all_match");
  });

  it("불일치가 하나라도 있으면 불일치 있음", () => {
    expect(summarizeCase(results({ maxClaimAmount: "mismatch" }))).toBe("mismatch_found");
  });

  it("불일치와 확인 필요가 같이 있으면 불일치 있음", () => {
    expect(summarizeCase(results({ debtor: "mismatch", area: "needs_review" }))).toBe(
      "mismatch_found",
    );
  });

  it("확인 필요만 있으면 확인 필요", () => {
    expect(summarizeCase(results({ area: "needs_review" }))).toBe("needs_review");
  });

  it("읽지 못한 항목이 있으면 전부 일치가 아니라 확인 필요", () => {
    expect(summarizeCase(results({ debtor: "unreadable" }))).toBe("needs_review");
  });

  it("대조하지 않은 항목이 빠져 있으면 확인 필요", () => {
    expect(summarizeCase(results().slice(0, 5))).toBe("needs_review");
  });

  it("결과가 비어 있으면 확인 필요", () => {
    expect(summarizeCase([])).toBe("needs_review");
  });
});
