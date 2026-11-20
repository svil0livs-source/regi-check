// 비용 청구 검증: 금액 읽기·청구서/영수증 해석·대조·다수결 시험 (가상 자료)
import { describe, expect, it } from "vitest";
import type { ParseLine } from "@/lib/readers/registryParse";
import { amountTokens, categoryOf, parseClaimLines, parseReceiptPage } from "./parse";
import { compareCosts } from "./compare";
import { voteReceipts } from "./vote";
import type { ClaimRead, Receipt } from "./types";

const L = (text: string, conf = 95): ParseLine => ({ text, words: text.split(/\s+/).filter(Boolean).map((w) => ({ text: w, confidence: conf })) });
const lines = (...t: string[]) => t.map((x) => L(x));

describe("금액 읽기", () => {
  it("쉼표·원·띄어쓰기를 숫자로", () => {
    expect(amountTokens("등록면허세 150,000원").map((t) => t.value)).toEqual([150000]);
    expect(amountTokens("금 1, 250,000 원").map((t) => t.value)).toEqual([1250000]);
    expect(amountTokens("₩15,000").map((t) => t.value)).toEqual([15000]);
    expect(amountTokens("수수료 15000").map((t) => t.value)).toEqual([15000]);
  });
  it("날짜·시각·번호·수량은 금액이 아님", () => {
    expect(amountTokens("납부일 2026.11.20 14:03:22")).toEqual([]);
    expect(amountTokens("계좌 110-234-567890")).toEqual([]);
    expect(amountTokens("발급 2통 부동산 1건")).toEqual([]);
    expect(amountTokens("전자납부번호 1234567890123456789")).toEqual([]);
  });
  it("쉼표 자리에 마침표로 읽힌 금액은 확인 필요 표시", () => {
    const [t] = amountTokens("등록면허세 150.000");
    expect(t.value).toBe(150000);
    expect(t.badFormat).toBe(true);
  });
});

describe("항목 종류", () => {
  it("이름이 달라도 같은 지출 항목", () => {
    expect(categoryOf("등록세")).toBe("registration_tax");
    expect(categoryOf("지방 교육세")).toBe("education_tax");
    expect(categoryOf("등기신청 수수료(증지)")).toBe("court_fee");
    expect(categoryOf("대법원 수입증지")).toBe("court_fee");
    expect(categoryOf("등기사항증명서 발급")).toBe("certificate");
    expect(categoryOf("국민주택채권 할인료")).toBe("housing_bond");
    expect(categoryOf("기본보수")).toBe("fee");
    expect(categoryOf("부가가치세")).toBe("fee");
    expect(categoryOf("등록면허세 및 지방교육세")).toBe("registration_tax");
    expect(categoryOf("알수없는비용")).toBe("other");
  });
});

describe("청구서 해석", () => {
  it("항목·금액·합계, 한 줄 두 칸, 소계는 버림", () => {
    const r = parseClaimLines(
      lines("비 용 청 구 서", "기본보수  300,000  등록면허세  150,000", "부가가치세  30,000  지방교육세  30,000", "등기신청수수료  1  15,000  15,000", "소계  330,000", "합계  525,000원"),
      1,
    );
    expect(r.items.map((i) => [i.category, i.amount.value])).toEqual([
      ["fee", 300000],
      ["registration_tax", 150000],
      ["fee", 30000],
      ["education_tax", 30000],
      ["court_fee", 15000],
    ]);
    expect(r.total?.value).toBe(525000);
  });
  it("확신도 낮은 금액은 불확실", () => {
    const r = parseClaimLines([L("등록면허세 150,000", 40)], 1);
    expect(r.items[0].amount.uncertain).toBe(true);
  });
});

describe("영수증 해석", () => {
  it("한 페이지에 영수증 두 장", () => {
    const rs = parseReceiptPage(
      lines(
        "지방세 납부확인서",
        "수납기관 서울특별시 강남구청",
        "납부일자 2026.11.10",
        "등록면허세  150,000",
        "지방교육세  30,000",
        "납부금액  180,000",
        "등기신청수수료 현금영수필확인서",
        "서울중앙지방법원 등기국",
        "2026-11-11",
        "금액  15,000원",
      ),
      3,
    );
    expect(rs).toHaveLength(2);
    expect(rs[0]).toMatchObject({ id: "3쪽-1", page: 3, date: "2026-11-10", uncertain: false });
    expect(rs[0].issuer).toContain("강남구청");
    expect(parseReceiptPage(lines("영수증", "발급번호: 1234-5678-9012", "열람 수수료 1,000원"), 1)[0]).toMatchObject({ ref: "1234-5678-9012", items: [{ amount: { value: 1000 } }] });
    expect(rs[0].items.map((i) => [i.category, i.amount.value])).toEqual([
      ["registration_tax", 150000],
      ["education_tax", 30000],
    ]);
    expect(rs[1].items.map((i) => [i.category, i.amount.value])).toEqual([["court_fee", 15000]]);
    expect(rs[1].issuer).toContain("지방법원");
  });
  it("항목 합과 합계가 다르면 확인 필요", () => {
    const [r] = parseReceiptPage(lines("영수증", "등록면허세 150,000", "합계 160,000"), 1);
    expect(r.uncertain).toBe(true);
  });
  it("국민주택채권 매입금액은 빼고 할인료만", () => {
    const [r] = parseReceiptPage(lines("국민주택채권 매입 영수증", "채권매입금액 1,300,000", "본인부담금(할인료) 52,000"), 1);
    expect(r.items.map((i) => [i.category, i.amount.value])).toEqual([["housing_bond", 52000]]);
  });
});

const claim = (items: [string, number][], total?: number): ClaimRead => ({
  items: items.map(([label, v]) => ({ label, category: categoryOf(label), amount: { value: v, uncertain: false }, page: 1 })),
  total: total === undefined ? null : { value: total, uncertain: false, page: 1 },
});
const receipt = (id: string, page: number, items: [string, number][], extra: Partial<Receipt> = {}): Receipt => ({
  id,
  page,
  index: 1,
  title: "영수증",
  issuer: "기관",
  ref: null,
  date: "2026-11-10",
  items: items.map(([label, v]) => ({ label, category: categoryOf(label), amount: { value: v, uncertain: false } })),
  total: null,
  uncertain: false,
  notes: [],
  ...extra,
});
const ok = { claim: [{ page: 1, source: "text" as const }], receipts: [{ page: 1, source: "ocr" as const }] };

describe("대조", () => {
  it("전부 일치, 보수는 대조하지 않음", () => {
    const r = compareCosts(claim([["기본보수", 300000], ["등록면허세", 150000], ["등기신청수수료", 15000]], 465000), [receipt("3쪽-1", 3, [["등록면허세", 150000]]), receipt("5쪽-1", 5, [["수입증지", 15000]])], ok);
    expect(r.summary).toBe("전부 일치");
    expect(r.rows.map((x) => [x.category, x.status, x.receipts[0].page])).toEqual([
      ["registration_tax", "match", 3],
      ["court_fee", "match", 5],
    ]);
    expect(r.feeItems).toHaveLength(1);
    expect(r.totals).toMatchObject({ claimedTotal: 465000, claimedExpenses: 165000, evidencedTotal: 165000, diff: 0 });
  });
  it("불일치·증빙 누락·청구서에 없는 영수증", () => {
    const r = compareCosts(
      claim([["제증명 발급비", 20000], ["등록면허세", 150000]]),
      [receipt("7쪽-1", 7, [["등기사항증명서 발급", 15000]]), receipt("8쪽-1", 8, [["인지세", 3000]])],
      ok,
    );
    expect(r.summary).toBe("불일치 있음");
    const cert = r.rows.find((x) => x.category === "certificate")!;
    expect(cert).toMatchObject({ status: "mismatch", diff: 5000 });
    expect(r.rows.find((x) => x.category === "registration_tax")!.status).toBe("missing");
    expect(r.extraReceipts.map((e) => e.id)).toEqual(["8쪽-1"]);
    expect(r.counts).toMatchObject({ mismatch: 1, missing: 1 });
  });
  it("같은 종류 영수증 여러 장은 합계로, 중복 의심은 확인 필요", () => {
    const r = compareCosts(claim([["등기사항증명서", 2000]]), [receipt("1쪽-1", 1, [["열람", 1000]]), receipt("1쪽-2", 1, [["열람", 1000]], { index: 2 })], ok);
    expect(r.rows[0]).toMatchObject({ claimed: 2000, evidenced: 2000, status: "needs_review" });
    expect(r.duplicates).toHaveLength(1);
  });
  it("번호가 다른 같은 금액 영수증은 중복이 아님", () => {
    const r = compareCosts(claim([["등기사항증명서", 2000]]), [receipt("1쪽-1", 1, [["열람", 1000]], { ref: "A1" }), receipt("1쪽-2", 1, [["열람", 1000]], { index: 2, ref: "A2" })], ok);
    expect(r.duplicates).toEqual([]);
    expect(r.rows[0].status).toBe("match");
  });
  it("등록면허세·지방교육세를 한 줄로 청구하면 두 영수증 금액을 더해 대조", () => {
    const r = compareCosts(claim([["등록면허세 및 지방교육세", 180000]]), [receipt("2쪽-1", 2, [["등록면허세", 150000], ["지방교육세", 30000]])], ok);
    expect(r.rows[0]).toMatchObject({ status: "match", evidenced: 180000 });
    expect(r.extraReceipts).toEqual([]);
  });
  it("읽지 못한 페이지가 있으면 전부 일치로 두지 않음", () => {
    const r = compareCosts(claim([["등록면허세", 150000]]), [receipt("1쪽-1", 1, [["등록면허세", 150000]])], {
      claim: ok.claim,
      receipts: [{ page: 1, source: "ocr" }, { page: 2, source: "ocr", error: "시간 초과" }],
    });
    expect(r.rows[0].status).toBe("match");
    expect(r.summary).toBe("확인 필요");
  });
  it("영수증을 하나도 찾지 못한 페이지가 있으면 전부 일치로 두지 않음", () => {
    const r = compareCosts(claim([["등록면허세", 150000]]), [receipt("1쪽-1", 1, [["등록면허세", 150000]])], {
      claim: ok.claim,
      receipts: [{ page: 1, source: "ocr", found: 1 }, { page: 2, source: "ocr", found: 0 }],
    });
    expect(r.summary).toBe("확인 필요");
    expect(r.warnings.join()).toContain("2쪽");
  });
  it("불확실한 금액은 같아도 확인 필요", () => {
    const rc = receipt("1쪽-1", 1, [["등록면허세", 150000]]);
    rc.items[0].amount.uncertain = true;
    const r = compareCosts(claim([["등록면허세", 150000]]), [rc], ok);
    expect(r.rows[0].status).toBe("needs_review");
    expect(r.summary).toBe("확인 필요");
  });
  it("청구서 합계가 항목 합과 다르면 안내", () => {
    const r = compareCosts(claim([["등록면허세", 150000]], 160000), [receipt("1쪽-1", 1, [["등록면허세", 150000]])], ok);
    expect(r.warnings.join()).toContain("합계");
    expect(r.summary).toBe("확인 필요");
  });
});

describe("여러 번 읽기 다수결", () => {
  const rc = (v: number, unc = false) => [receipt("1쪽-1", 1, [["등록면허세", v]], {})].map((r) => ({ ...r, items: r.items.map((i) => ({ ...i, amount: { value: v, uncertain: unc } })) }));
  it("금액을 못 찾은 읽기는 빠지고, 같은 값을 하나라도 또렷하게 읽었으면 확신", () => {
    expect(voteReceipts([rc(150000, true), [], rc(150000)])[0].items[0].amount).toEqual({ value: 150000, uncertain: false });
  });
  it("한 번만 읽히면 확인 필요", () => {
    expect(voteReceipts([rc(150000), [], []])[0].items[0].amount.uncertain).toBe(true);
  });
  it("같은 값을 낸 읽기가 모두 불확실하면 불확실", () => {
    expect(voteReceipts([rc(150000, true), rc(150000, true), rc(158000)])[0].items[0].amount.uncertain).toBe(true);
  });
  it("모두 같으면 확신, 일부만 불확실이면 확신", () => {
    expect(voteReceipts([rc(150000, true), rc(150000), rc(150000)])[0].items[0].amount.uncertain).toBe(false);
  });
  it("과반수가 없으면 확인 필요", () => {
    const v = voteReceipts([rc(150000), rc(158000), rc(130000)]);
    expect(v[0].items[0].amount.uncertain).toBe(true);
  });
  it("2:1이면 과반수 값", () => {
    expect(voteReceipts([rc(150000), rc(158000), rc(150000)])[0].items[0].amount.value).toBe(150000);
  });
});
