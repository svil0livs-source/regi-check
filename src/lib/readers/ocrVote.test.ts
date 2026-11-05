// 다수결 규칙 시험 (외부 서비스 없이)
import { describe, expect, it } from "vitest";
import { voteNameList, voteRegistryReads, voteValue } from "./ocrVote";
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
        mortgageeIdFront: o("110111"),
        transfers: [{ rank: "1-1", receiptNumber: o("제2호"), registrationDate: o("2026년1월1일"), assignee: o("양수인"), assigneeIdFront: o("110222") }],
      },
    ],
  });

  it("값마다 다수결", () => {
    const r = voteRegistryReads([read("윤테스"), read("문테스"), read("윤테스")]);
    expect(r.owners).toEqual([o("윤테스")]);
    expect(r.mortgages[0].debtors).toEqual([o("윤테스")]);
  });

  // 부동산·근저당권 목록은 목록 길이로 다수결 (이름 목록은 아래 voteNameList)
  const withProps = (count: number): RegistryRead => ({
    ...read("가"),
    properties: Array.from({ length: count }, () => ({ location: o("서울"), lotNumber: o("1"), unitNumber: o(""), area: o("10㎡") })),
  });

  it("목록 길이가 과반으로 정해지지 않으면 그 목록은 모두 불확실", () => {
    const r = voteRegistryReads([withProps(1), withProps(2), withProps(3)]);
    expect(r.properties.every((p) => p.location.uncertain && p.area.uncertain)).toBe(true);
  });

  it("목록 길이가 과반이면 그 길이의 결과들로 다수결", () => {
    const r = voteRegistryReads([withProps(2), withProps(2), withProps(1)]);
    expect(r.properties).toHaveLength(2);
    expect(r.properties.every((p) => !p.location.uncertain)).toBe(true);
  });

  it("1번만 읽었으면 그대로", () => {
    const one = read("가");
    expect(voteRegistryReads([one])).toBe(one);
  });
});

describe("voteNameList (이름 목록은 이름마다 다수결)", () => {
  const n = (t: string) => ({ text: t, uncertain: false });

  it("읽을 때마다 한 명씩 빠져도 과반에 나온 이름은 모두 넣는다", () => {
    const r = voteNameList([[n("정임시"), n("임연습")], [n("정임시"), n("임연습")], [n("정임시")], [n("정 임시")], [n("임연습")]]);
    expect(r).toEqual([n("정임시"), n("임연습")]);
  });

  it("한 글자 다른 표기는 같은 이름의 오독으로 묶고 많이 나온 표기를 쓴다", () => {
    const r = voteNameList([[n("조모의")], [n("조모의")], [n("소모의")], [n("조모의")], [n("조모의")]]);
    expect(r).toEqual([n("조모의")]);
  });

  it("과반은 아니지만 2번 이상 나온 이름은 불확실로 넣는다 (빠뜨려 불일치로 단정하지 않게)", () => {
    const r = voteNameList([[n("A가나"), n("장견본")], [n("A가나"), n("장견본")], [n("A가나")], [n("A가나")], [n("A가나")]]);
    expect(r).toEqual([n("A가나"), { text: "장견본", uncertain: true }]);
  });

  it("표기가 갈리면(과반 표기 없음) 불확실", () => {
    const r = voteNameList([[n("차카타은행")], [n("차카타은핵")], [n("차카타은행")], [n("차카타은핵")], [n("차카타은잭")]]);
    expect(r[0].uncertain).toBe(true);
  });

  it("1번만 나온 잡글자는 버린다", () => {
    expect(voteNameList([[n("가나다")], [n("가나다")], [n("가나다"), n("주식회사 예시개발")]])).toEqual([n("가나다")]);
  });
});
