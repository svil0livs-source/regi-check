// 사건별 비용표(엑셀 한 줄 = 경매 사건 한 건) 읽기·대조 시험 (2026-11-23). 이름·금액은 모두 가짜.
import { describe, expect, it } from "vitest";
import { compareCaseTable } from "./caseCompare";
import { parseClaimSheets, type Cell, type Sheet } from "./excel";
import { caseNosOf, parseReceiptPage } from "./parse";
import type { ClaimRead, ClaimTable, Receipt } from "./types";

const HEADER: Cell[] = ["번호", "접수일자", "사건명", "차주번호/CIF", "차주", "채무자", "법원", "사건번호", "인지대", "증지대", "등록세", "교육세", "등기부 등본대", "초본 외", "민원우편", "송달료", "보관금", "보증 보험료", "소계1", "보수", "교통비/여비", "부가세", "소계2", "합계", "담당자"];
const row = (no: number, date: string, debtor: string, court: string, caseNo: number, reg: number, edu: number, svc: number, dep: number, fee: number): Cell[] => {
  const sub1 = 4500 + 4000 + reg + edu + svc + dep;
  return [no, date, "임의경매", `가짜은행-${no}`, 0, debtor, court, caseNo, 4500, 4000, reg, edu, 0, 0, 0, svc, dep, 0, sub1, fee, null, fee / 10, fee * 1.1, sub1 + fee * 1.1, "담당"];
};
const CASES = [row(1, "2026-07-21", "가나다", "가짜지원", 21089, 816480, 163290, 282000, 3742200, 250000), row(2, "2026-07-06", "라마바", "가짜지원", 21014, 242140, 48420, 275000, 2306370, 153400), row(3, "2026-07-15", "사아자", "가짜법원", 50943, 211340, 42260, 282000, 2229370, 147200)];
const sum = (col: number) => CASES.reduce((s, r) => s + (r[col] as number), 0);
const TOTAL: Cell[] = ["합계", null, null, null, null, null, null, null, ...Array.from({ length: 16 }, (_, i) => (i === 12 ? 0 : sum(8 + i)))];
const SHEET: Sheet = { name: "담당", rows: [[], Array(23).fill(null).concat(["(단위:원)"]), HEADER, ...CASES, TOTAL] };

const lines = (text: string) => text.split("\n").map((t) => ({ text: t, words: t.split(/\s+/).map((w) => ({ text: w, confidence: 95 })) }));
/** 사건 하나의 영수증 (법원 영수증 3장 + 지방세 1장) */
function receiptsFor(page: number, caseNo: number, v: { stamp: number; court: number; reg: number; edu: number; svc: number; dep: number }): Receipt[] {
  const pages = [
    `법원 보관금 영수증서\n사건번호 2026타경${caseNo}\n보관금 ${v.dep.toLocaleString("en-US")}원\n납부일 2026.07.21`,
    `송달료 납부서\n사건번호 2026타경${caseNo}\n송달료 ${v.svc.toLocaleString("en-US")}원`,
    `전자수입인지 영수증\n인지대 ${v.stamp.toLocaleString("en-US")}원\n수입증지 영수증\n증지대 ${v.court.toLocaleString("en-US")}원`,
    `지방세 영수증\n등록면허세 ${v.reg.toLocaleString("en-US")}원\n지방교육세 ${v.edu.toLocaleString("en-US")}원\n합계 ${(v.reg + v.edu).toLocaleString("en-US")}원`,
  ];
  return pages.flatMap((t, i) => parseReceiptPage(lines(t), page * 10 + i));
}
const ok = (r: Cell[]) => ({ stamp: 4500, court: 4000, reg: r[10] as number, edu: r[11] as number, svc: r[15] as number, dep: r[16] as number });

function claimOf(): ClaimRead & { table: ClaimTable } {
  const { claim } = parseClaimSheets([SHEET]);
  if (!claim.table) throw new Error("사건별 비용표로 읽지 못함");
  return claim as ClaimRead & { table: ClaimTable };
}
const pages = { claim: [{ page: 1, source: "text" as const, found: 1 }], receipts: [] };

describe("사건별 비용표 읽기", () => {
  it("머리줄의 비용 칸과 사건 줄·합계 줄을 찾는다", () => {
    const { table } = claimOf();
    expect(table.cases).toHaveLength(3);
    expect(table.cases.map((c) => [c.no, c.caseNo, c.date, c.row])).toEqual([
      ["1", "21089", "2026-07-21", 4],
      ["2", "21014", "2026-07-06", 5],
      ["3", "50943", "2026-07-15", 6],
    ]);
    const cats = Object.fromEntries(table.columns.map((c) => [c.header, c.category]));
    expect(cats).toMatchObject({ 인지대: "stamp_tax", 증지대: "court_fee", 등록세: "registration_tax", 교육세: "education_tax", 송달료: "court_service", 보관금: "deposit", "보증 보험료": "insurance", 민원우편: "postage", 보수: "fee", 부가세: "fee" });
    expect(table.columns.some((c) => /소계|합계/.test(c.header))).toBe(false);
    expect(table.totalRow?.row).toBe(7);
    // 0원 칸은 청구로 보지 않는다
    expect(table.cases[0].items.map((i) => i.label)).toEqual(["인지대", "증지대", "등록세", "교육세", "송달료", "보관금", "보수", "부가세"]);
  });

  it("영수증의 사건번호는 금액으로 읽지 않는다", () => {
    expect(caseNosOf("사건번호 2026타경21089 / 2026 타 경 50943")).toEqual(["21089", "50943"]);
    const [r] = parseReceiptPage(lines("송달료 납부서\n사건번호 2026타경21089\n송달료 282,000원"), 1);
    expect(r.caseNos).toEqual(["21089"]);
    expect(r.items.map((i) => [i.category, i.amount.value])).toEqual([["court_service", 282000]]);
  });
});

describe("사건별 대조", () => {
  it("모든 사건의 영수증이 맞으면 전부 일치", () => {
    const receipts = CASES.flatMap((r, i) => receiptsFor(i + 1, r[7] as number, ok(r)));
    const res = compareCaseTable(claimOf(), receipts, pages);
    expect(res.cases?.map((c) => c.summary)).toEqual(["전부 일치", "전부 일치", "전부 일치"]);
    expect(res.extraReceipts).toEqual([]);
    expect(res.summary).toBe("전부 일치");
    expect(res.totals.diff).toBe(0);
  });

  it("한 사건의 보관금이 다르면 그 사건만 불일치 (사건번호로 짝지음)", () => {
    const receipts = CASES.flatMap((r, i) => receiptsFor(i + 1, r[7] as number, i === 1 ? { ...ok(r), dep: 2306730 } : ok(r)));
    const res = compareCaseTable(claimOf(), receipts, pages);
    expect(res.summary).toBe("불일치 있음");
    expect(res.cases?.map((c) => c.summary)).toEqual(["전부 일치", "불일치 있음", "전부 일치"]);
    const cell = res.cases![1].cells.find((c) => c.header === "보관금")!;
    expect(cell).toMatchObject({ status: "mismatch", claimed: 2306370, evidenced: 2306730 });
    expect(res.extraReceipts).toEqual([]);
  });

  it("사건번호가 없는 영수증은 금액으로 짝짓고, 맞는 영수증이 없는 사건은 증빙 누락", () => {
    // 3번 사건 인지 영수증이 빠짐
    const receipts = CASES.flatMap((r, i) => receiptsFor(i + 1, r[7] as number, ok(r))).filter((r) => !(r.page === 32 && /인지/.test(r.items.map((x) => x.label).join())));
    const res = compareCaseTable(claimOf(), receipts, pages);
    const missing = res.cases!.flatMap((c) => c.cells.filter((x) => x.status === "missing").map((x) => `${c.no}:${x.header}`));
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatch(/인지대$/);
    expect(res.summary).toBe("불일치 있음");
  });

  it("등록세·교육세를 한 금액으로 낸 지방세 영수증도 맞춘다", () => {
    const r = CASES[0];
    const receipts = [
      ...receiptsFor(1, 21089, ok(r)).filter((x) => !/지방세/.test(x.title)),
      ...parseReceiptPage(lines(`지방세 영수증\n등록면허세 ${(816480 + 163290).toLocaleString("en-US")}원`), 99),
    ];
    const claim = claimOf();
    claim.table = { ...claim.table, cases: [claim.table.cases[0]], totalRow: null };
    const res = compareCaseTable(claim, receipts, pages);
    expect(res.cases![0].summary).toBe("전부 일치");
  });

  it("엑셀 합계 줄이 사건 금액의 합과 다르면 알린다", () => {
    const sheet: Sheet = { ...SHEET, rows: SHEET.rows.map((r, i) => (i === 6 ? r.map((v, j) => (j === 16 ? (v as number) + 10 : v)) : r)) };
    const { claim } = parseClaimSheets([sheet]);
    const res = compareCaseTable(claim as ClaimRead & { table: ClaimTable }, [], pages);
    expect(res.warnings.some((w) => /보관금/.test(w) && /합계/.test(w))).toBe(true);
  });
});
