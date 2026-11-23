// 비용 청구 검증: 사건별 비용표(엑셀 한 줄 = 경매 사건 한 건)를 영수증과 사건마다 대조하는 순수 함수 (2026-11-23 사용자 결정).
// - 비용 종류(인지대·증지대·등록세·교육세·송달료·보관금·보증보험료·등본·우편)마다, 사건의 청구 금액 하나에 영수증 금액을 하나씩 맞춘다.
// - 맞추는 순서: ① 영수증에 적힌 사건번호와 금액이 모두 같음 ② 금액이 같음(다른 사건번호가 적힌 영수증은 빼고, 접수일과 같은 날 영수증 먼저)
//   ③ 그 사건번호가 적힌 영수증 여러 장의 합이 같음 ④ 남은 것끼리: 사건번호가 같은 영수증, 또는 종류에 하나씩만 남으면 「불일치」로 짝지음.
//   그래도 남은 청구는 「증빙 누락」, 남은 영수증은 「청구서에 대응하지 않는 영수증」.
// - 법무사 보수(보수·교통비·부가세)는 대조하지 않고 사건마다 따로 보여 준다.
// - 확신할 수 없으면 「일치」로 두지 않는다. 읽지 못한 페이지가 있으면 「전부 일치」로 판정하지 않는다.
import { CATEGORY_LABELS } from "./parse";
import type { CaseCell, CaseResult, ClaimRead, ClaimTable, CostCategory, CostResult, CostRow, CostStatus, CostSummary, PageRead, Receipt } from "./types";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

type Ev = { receipt: Receipt; category: CostCategory; amount: number | null; uncertain: boolean; label: string; used: boolean };
type Slot = { caseIdx: number; header: string; category: CostCategory; amount: number | null; uncertain: boolean; cell: CaseCell };

/** 같은 영수증이 두 번 들어간 것: 영수증 번호가 같거나, 번호가 없고 사건번호·발급기관·날짜·금액이 모두 같은 것 */
function findTableDuplicates(receipts: Receipt[]): Receipt[][] {
  const groups = new Map<string, Receipt[]>();
  for (const r of receipts) {
    if (!r.items.length) continue;
    const sig = [r.issuer ?? "", r.date ?? "", (r.caseNos ?? []).join(","), ...r.items.map((i) => `${i.category}:${i.amount.value}`).sort()].join("|");
    groups.set(sig, [...(groups.get(sig) ?? []), r]);
  }
  const out: Receipt[][] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const dup = g.filter((r) => g.some((o) => o !== r && ((r.ref !== null && r.ref === o.ref) || (r.ref === null && o.ref === null && (r.caseNos?.length ?? 0) > 0))));
    if (dup.length > 1) out.push(dup);
  }
  return out;
}

const worst = (cells: CaseCell[]): CostSummary =>
  cells.some((c) => c.status === "mismatch" || c.status === "missing") ? "불일치 있음" : cells.some((c) => c.status === "needs_review") ? "확인 필요" : "전부 일치";

export function compareCaseTable(claim: ClaimRead & { table: ClaimTable }, receipts: Receipt[], pages: { claim: PageRead[]; receipts: PageRead[] }): CostResult {
  const table = claim.table;
  const warnings: string[] = [];
  for (const p of pages.claim) if (p.error) warnings.push(`청구서 ${p.page}쪽을 읽지 못했습니다 (${p.error}).`);
  for (const p of pages.receipts) {
    if (p.error) warnings.push(`영수증 PDF ${p.page}쪽을 읽지 못했습니다 (${p.error}).`);
    else if (p.found === 0) warnings.push(`영수증 PDF ${p.page}쪽에서 영수증 금액을 찾지 못했습니다. 원본을 확인해 주세요.`);
  }
  if (receipts.length === 0) warnings.push("영수증 PDF에서 영수증을 찾지 못했습니다.");

  // 엑셀 합계 줄과 사건 금액의 합이 다르면 알린다
  if (table.totalRow) {
    for (const c of table.columns) {
      const written = table.totalRow.values[c.col];
      if (written === undefined) continue;
      const sum = table.cases.reduce((s, k) => s + (k.items.find((i) => i.label === c.header)?.amount.value ?? 0), 0);
      if (written !== sum) warnings.push(`엑셀 ${table.totalRow.row}행 합계의 ${c.header}(${won(written)})와 사건별 금액의 합(${won(sum)})이 다릅니다.`);
    }
  }

  const cases: CaseResult[] = table.cases.map((k) => ({
    sheet: k.sheet,
    page: k.page,
    row: k.row,
    no: k.no,
    caseNo: k.caseNo,
    court: k.court,
    debtor: k.debtor,
    date: k.date,
    summary: "전부 일치",
    cells: [],
    fees: k.items.filter((i) => i.category === "fee").map((i) => ({ header: i.label, amount: i.amount.value ?? 0 })),
  }));

  // 청구 칸 (보수 제외)
  const slots: Slot[] = [];
  table.cases.forEach((k, caseIdx) => {
    for (const it of k.items) {
      if (it.category === "fee") continue;
      const cell: CaseCell = { header: it.label, category: it.category, claimed: it.amount.value, evidenced: null, status: "missing", receipts: [], reasons: [] };
      cases[caseIdx].cells.push(cell);
      slots.push({ caseIdx, header: it.label, category: it.category, amount: it.amount.value, uncertain: it.amount.uncertain, cell });
    }
  });

  // 영수증 금액 (보수 영수증 제외)
  const evs: Ev[] = [];
  for (const r of receipts) for (const it of r.items) if (it.category !== "fee") evs.push({ receipt: r, category: it.category, amount: it.amount.value, uncertain: it.amount.uncertain || r.uncertain, label: it.label, used: false });

  const caseNoOf = (s: Slot) => table.cases[s.caseIdx].caseNo;
  const dateOf = (s: Slot) => table.cases[s.caseIdx].date;
  const refersTo = (e: Ev, s: Slot) => !!caseNoOf(s) && (e.receipt.caseNos ?? []).includes(caseNoOf(s)!);
  /** 영수증에 다른 사건번호만 적혀 있음 */
  const otherCase = (e: Ev, s: Slot) => (e.receipt.caseNos?.length ?? 0) > 0 && !refersTo(e, s);
  const attach = (s: Slot, list: Ev[], status: CostStatus, reason?: string) => {
    for (const e of list) e.used = true;
    const c = s.cell;
    c.evidenced = list.every((e) => e.amount !== null) ? list.reduce((a, e) => a + (e.amount ?? 0), 0) : null;
    c.receipts = [...new Map(list.map((e) => [e.receipt.id, { id: e.receipt.id, page: e.receipt.page }])).values()];
    c.status = status;
    if (reason) c.reasons.push(reason);
    if (status === "match" && (s.uncertain || list.some((e) => e.uncertain))) {
      c.status = "needs_review";
      c.reasons.push("글자 읽기가 불확실한 금액이 있음");
    }
    if (status === "mismatch" && c.evidenced === null) {
      c.status = "needs_review";
      c.reasons.push("영수증 금액을 읽지 못함");
    }
  };
  const open = (s: Slot) => s.cell.receipts.length === 0;
  const free = (cat: CostCategory) => evs.filter((e) => !e.used && e.category === cat);

  const categories = [...new Set(slots.map((s) => s.category))];
  for (const cat of categories) {
    const mine = slots.filter((s) => s.category === cat);
    // ① 사건번호와 금액이 모두 같음
    for (const s of mine) {
      const e = free(cat).find((x) => refersTo(x, s) && x.amount === s.amount);
      if (e) attach(s, [e], "match");
    }
    // ② 금액이 같음 (다른 사건번호가 적힌 영수증은 빼고, 접수일과 같은 날 영수증 먼저)
    for (const s of mine.filter(open)) {
      const cands = free(cat).filter((x) => !otherCase(x, s) && x.amount === s.amount);
      const e = cands.find((x) => x.receipt.date && x.receipt.date === dateOf(s)) ?? cands[0];
      if (e) attach(s, [e], "match");
    }
    // ③ 그 사건번호가 적힌 영수증 여러 장의 합
    for (const s of mine.filter(open)) {
      const list = free(cat).filter((x) => refersTo(x, s));
      if (list.length > 1 && list.every((x) => x.amount !== null) && list.reduce((a, x) => a + (x.amount ?? 0), 0) === s.amount) attach(s, list, "match", `영수증 ${list.length}장의 합`);
    }
  }
  // 등록세·교육세를 한 영수증 금액 하나로 낸 경우: 같은 사건의 등록세+교육세 합과 같은 지방세 영수증 하나에 둘 다 맞춘다
  for (const reg of slots.filter((s) => s.category === "registration_tax" && open(s))) {
    const edu = slots.find((s) => s.caseIdx === reg.caseIdx && s.category === "education_tax" && open(s));
    if (!edu || reg.amount === null || edu.amount === null) continue;
    const both = reg.amount + edu.amount;
    const cands = [...free("registration_tax"), ...free("education_tax")].filter((x) => !otherCase(x, reg) && x.amount === both);
    const e = cands.find((x) => refersTo(x, reg)) ?? cands.find((x) => x.receipt.date && x.receipt.date === dateOf(reg)) ?? cands[0];
    if (!e) continue;
    attach(reg, [e], "match", "등록세·교육세를 한 금액으로 낸 영수증");
    reg.cell.evidenced = reg.amount;
    edu.cell.receipts = reg.cell.receipts;
    edu.cell.evidenced = edu.amount;
    edu.cell.status = reg.cell.status;
    edu.cell.reasons.push("등록세·교육세를 한 금액으로 낸 영수증");
  }
  for (const cat of categories) {
    const mine = slots.filter((s) => s.category === cat);
    // ④ 남은 것끼리: 사건번호가 같은 영수증 → 불일치
    for (const s of mine.filter(open)) {
      const list = free(cat).filter((x) => refersTo(x, s));
      if (list.length) attach(s, list, "mismatch");
    }
    //    종류에 청구 하나·영수증 하나만 남으면 → 불일치로 짝지음
    const restSlots = mine.filter(open);
    const restEvs = free(cat);
    if (restSlots.length === 1 && restEvs.length === 1 && !otherCase(restEvs[0], restSlots[0])) attach(restSlots[0], restEvs, "mismatch", "같은 종류에 남은 영수증이 이것 하나뿐이라 짝지음");
    for (const s of mine.filter(open)) {
      s.cell.status = "missing";
      s.cell.reasons.push(free(cat).length ? `금액이 맞는 ${CATEGORY_LABELS[cat]} 영수증이 없음 (남은 같은 종류 영수증 ${free(cat).length}장)` : "대응하는 영수증을 찾지 못함");
    }
  }
  for (const k of cases) k.summary = worst(k.cells);

  const dupGroups = findTableDuplicates(receipts);
  const dupIds = new Set(dupGroups.flat().map((r) => r.id));
  for (const k of cases) {
    for (const c of k.cells) {
      if (c.receipts.some((x) => dupIds.has(x.id))) {
        if (c.status === "match") c.status = "needs_review";
        c.reasons.push("같은 영수증이 두 번 들어간 것으로 보임");
      }
    }
    k.summary = worst(k.cells);
  }

  // 청구서에 대응하지 않는 영수증
  const extraReceipts: CostResult["extraReceipts"] = [];
  for (const r of receipts) {
    for (const it of r.items) {
      if (it.category === "fee") {
        extraReceipts.push({ id: r.id, page: r.page, label: it.label, amount: it.amount.value, reason: "법무사 보수 영수증 (대조하지 않음)" });
        continue;
      }
      const e = evs.find((x) => x.receipt === r && x.label === it.label && x.amount === it.amount.value && !x.used);
      if (!e) continue;
      e.used = true;
      const where = r.caseNos?.length ? ` (영수증의 사건번호 ${r.caseNos.join(", ")})` : "";
      extraReceipts.push({
        id: r.id,
        page: r.page,
        label: it.label || r.title,
        amount: it.amount.value,
        reason: it.category === "other" ? `항목을 알아보지 못한 영수증${where}` : `어느 사건 청구와도 금액이 맞지 않음${where}`,
      });
    }
    if (r.items.length === 0) extraReceipts.push({ id: r.id, page: r.page, label: r.title, amount: null, reason: r.notes.join(", ") || "금액을 찾지 못함" });
  }

  // 비용 종류별 합계 (사건 청구 합 ↔ 그 종류 영수증 전체 합)
  const rows: CostRow[] = categories.map((cat) => {
    const cells = cases.flatMap((k) => k.cells.filter((c) => c.category === cat));
    const claimed = cells.reduce((s, c) => s + (c.claimed ?? 0), 0);
    const catEvs = evs.filter((e) => e.category === cat);
    const evidenced = catEvs.every((e) => e.amount !== null) ? catEvs.reduce((s, e) => s + (e.amount ?? 0), 0) : null;
    const statuses = cells.map((c) => c.status);
    const status: CostStatus = statuses.includes("mismatch") ? "mismatch" : statuses.includes("missing") ? "missing" : statuses.includes("needs_review") ? "needs_review" : "match";
    const bad = cells.filter((c) => c.status !== "match").length;
    return {
      category: cat,
      label: [...new Set(cells.map((c) => c.header))].join(", "),
      claimed,
      evidenced,
      diff: evidenced === null ? null : claimed - evidenced,
      status,
      receipts: [...new Map(catEvs.map((e) => [e.receipt.id, { id: e.receipt.id, page: e.receipt.page }])).values()],
      claimPages: [...new Set(cases.filter((k) => k.cells.some((c) => c.category === cat)).map((k) => k.page))],
      reasons: bad ? [`${cells.length}건 중 ${bad}건 문제`] : [],
    };
  });

  const counts: Record<CostStatus, number> = { match: 0, mismatch: 0, missing: 0, needs_review: 0 };
  for (const k of cases) for (const c of k.cells) counts[c.status]++;

  const claimedExpenses = slots.reduce((s, x) => s + (x.amount ?? 0), 0);
  const feeTotal = cases.reduce((s, k) => s + k.fees.reduce((a, f) => a + f.amount, 0), 0);
  const evidencedTotal = evs.reduce((s, e) => s + (e.amount ?? 0), 0);
  const duplicates = dupGroups.map((g) => ({ ids: g.map((r) => r.id), reason: "같은 사건·발급기관·날짜·금액의 영수증" }));

  let summary: CostSummary;
  if (counts.mismatch > 0 || counts.missing > 0) summary = "불일치 있음";
  else if (counts.needs_review > 0 || warnings.length > 0 || extraReceipts.some((e) => !e.reason.startsWith("법무사 보수")) || duplicates.length > 0 || slots.length === 0) summary = "확인 필요";
  else summary = "전부 일치";

  return {
    summary,
    rows,
    feeItems: cases.flatMap((k) => k.fees.map((f) => ({ label: `${k.no}번 ${f.header}`, category: "fee" as const, amount: { value: f.amount, uncertain: false }, page: k.page, sheet: k.sheet, row: k.row }))),
    extraReceipts,
    duplicates,
    totals: { claimedTotal: claimedExpenses + feeTotal, claimedTotalFromDoc: false, claimedExpenses, evidencedTotal, diff: claimedExpenses - evidencedTotal },
    counts,
    warnings,
    cases,
  };
}
