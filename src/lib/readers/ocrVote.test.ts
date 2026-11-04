// 다수결 규칙 시험 (외부 서비스 없이)
import { describe, expect, it } from "vitest";
import { voteRegistryReads, voteValue } from "./ocrVote";
import type { RegistryRead } from "./registryOcr";

const o = (text: string | null, uncertain = false) => ({ text, uncertain });

describe("voteValue", () => {
  it("3번 중 2번 같으면 그 값, 확실", () => {
    expect(voteValue([o("장견본"), o("장건본"), o("장견본")])).toEqual(o("장견본"));
  });

  it("셋 다 다르면 불확실", () => {
    expect(voteValue([o("가"), o("나"), o("다")]).uncertain).toBe(true);
  });

  it("과반이 같아도 그중 과반이 불확실이라고 하면 불확실", () => {
    expect(voteValue([o("가", true), o("가", true), o("나")]).uncertain).toBe(true);
  });

  it("띄어쓰기 차이는 같은 값으로 본다", () => {
    expect(voteValue([o("주식회사 가나다"), o("주식회사가나다"), o("다른값")])).toEqual(o("주식회사 가나다"));
  });

  it("못 읽음(null)도 과반이면 못 읽음", () => {
    expect(voteValue([o(null), o(null), o("가")]).text).toBeNull();
  });
});

describe("voteRegistryReads", () => {
  const read = (owner: string, owners = 1): RegistryRead => ({
    properties: [{ location: o("서울"), lotNumber: o("1"), unitNumber: o(""), area: o("10㎡") }],
    owners: Array.from({ length: owners }, () => o(owner)),
    mortgages: [
      {
        rank: "1",
        receiptNumber: o("제1호"),
        registrationDate: o("2020년1월1일"),
        maxClaimAmount: o("금 1원"),
        debtors: [o(owner)],
        mortgagee: o("은행"),
        transfers: [{ rank: "1-1", receiptNumber: o("제2호"), registrationDate: o("2026년1월1일"), assignee: o("양수인") }],
      },
    ],
  });

  it("값마다 다수결", () => {
    const r = voteRegistryReads([read("윤테스"), read("문테스"), read("윤테스")]);
    expect(r.owners).toEqual([o("윤테스")]);
    expect(r.mortgages[0].debtors).toEqual([o("윤테스")]);
  });

  it("목록 길이가 과반으로 정해지지 않으면 그 목록은 모두 불확실", () => {
    const r = voteRegistryReads([read("가", 1), read("가", 2), read("가", 3)]);
    expect(r.owners.every((v) => v.uncertain)).toBe(true);
  });

  it("목록 길이가 과반이면 그 길이의 결과들로 다수결", () => {
    const r = voteRegistryReads([read("가", 2), read("가", 2), read("가", 1)]);
    expect(r.owners).toEqual([o("가"), o("가")]);
  });

  it("1번만 읽었으면 그대로", () => {
    const one = read("가");
    expect(voteRegistryReads([one])).toBe(one);
  });
});
