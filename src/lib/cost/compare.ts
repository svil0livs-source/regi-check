// 비용 청구 검증: 청구서 항목과 영수증을 지출 항목 종류별로 맞춰 금액을 대조하는 순수 함수 (2026-11-20).
// - 법무사 보수(fee)는 영수증과 대조하지 않고 따로 보여 준다.
// - 같은 종류의 청구 항목·영수증이 여러 개면 종류별 합계로 대조한다(부동산 여러 건, 영수증 여러 장).
// - 확신할 수 없으면 「일치」로 두지 않는다. 읽지 못한 페이지가 있으면 「전부 일치」로 판정하지 않는다.
import { CATEGORY_LABELS } from "./parse";
import type { ClaimItem, ClaimRead, CostCategory, CostResult, CostRow, CostStatus, PageRead, Receipt } from "./types";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

/**
 * 같은 영수증이 두 번 들어간 것으로 보이는 묶음: 발급기관·날짜·항목 금액이 모두 같고,
 * 영수증 번호가 같거나 (둘 중 하나라도) 번호를 읽지 못한 영수증. 번호가 서로 다르면 다른 영수증이다.
 */
export function findDuplicates(receipts: Receipt[]): Receipt[][] {
  const groups = new Map<string, Receipt[]>();
  for (const r of receipts) {
    if (!r.items.length) continue;
    const sig = [r.issuer ?? "", r.date ?? "", ...r.items.map((i) => `${i.category}:${i.amount.value}`).sort()].join("|");
    groups.set(sig, [...(groups.get(sig) ?? []), r]);
  }
  const out: Receipt[][] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const dup = g.filter((r) => g.some((o) => o !== r && (r.ref === null || o.ref === null || r.ref === o.ref)));
    if (dup.length > 1) out.push(dup);
  }
  return out;
}

export function compareCosts(claim: ClaimRead, receipts: Receipt[], pages: { claim: PageRead[]; receipts: PageRead[] }): CostResult {
  const warnings: string[] = [];
  for (const p of pages.claim) if (p.error) warnings.push(`청구서 ${p.page}쪽을 읽지 못했습니다 (${p.error}).`);
  for (const p of pages.receipts) {
    if (p.error) warnings.push(`영수증 PDF ${p.page}쪽을 읽지 못했습니다 (${p.error}).`);
    else if (p.found === 0) warnings.push(`영수증 PDF ${p.page}쪽에서 영수증 금액을 찾지 못했습니다. 원본을 확인해 주세요.`);
  }
  if (claim.items.length === 0) warnings.push("청구서에서 청구 항목을 찾지 못했습니다.");
  if (receipts.length === 0) warnings.push("영수증 PDF에서 영수증을 찾지 못했습니다.");

  const feeItems = claim.items.filter((i) => i.category === "fee");
  const claimByCat = new Map<CostCategory, ClaimItem[]>();
  for (const i of claim.items) if (i.category !== "fee") claimByCat.set(i.category, [...(claimByCat.get(i.category) ?? []), i]);

  // 영수증 항목을 종류별로 모은다 (법무사 보수 영수증은 대조하지 않음)
  type Ev = { receipt: Receipt; amount: number | null; uncertain: boolean; label: string };
  const evByCat = new Map<CostCategory, Ev[]>();
  for (const r of receipts) {
    for (const it of r.items) {
      if (it.category === "fee") continue;
      evByCat.set(it.category, [...(evByCat.get(it.category) ?? []), { receipt: r, amount: it.amount.value, uncertain: it.amount.uncertain || r.uncertain, label: it.label }]);
    }
  }

  // 등록면허세와 지방교육세를 한 줄로 청구했으면(따로 지방교육세 청구가 없으면) 지방교육세 영수증도 그 줄에 더한다
  if (!claimByCat.has("education_tax") && claimByCat.get("registration_tax")?.some((i) => /교육세/.test(i.label)) && evByCat.has("education_tax")) {
    evByCat.set("registration_tax", [...(evByCat.get("registration_tax") ?? []), ...(evByCat.get("education_tax") ?? [])]);
    evByCat.delete("education_tax");
  }

  const dupGroups = findDuplicates(receipts);
  const dupIds = new Set(dupGroups.flat().map((r) => r.id));

  const rows: CostRow[] = [];
  const used = new Set<CostCategory>();
  for (const [cat, items] of claimByCat) {
    const reasons: string[] = [];
    const claimUncertain = items.some((i) => i.amount.uncertain || i.amount.value === null);
    const claimed = items.every((i) => i.amount.value !== null) ? items.reduce((s, i) => s + (i.amount.value ?? 0), 0) : null;
    // 알아보지 못한 항목(other)은 이름이 같은 영수증 항목만 대응시킨다
    const evs = (evByCat.get(cat) ?? []).filter((e) => cat !== "other" || items.some((i) => i.label.replace(/\s/g, "") === e.label.replace(/\s/g, "")));
    if (cat !== "other" || evs.length) used.add(cat);
    const evidenced = evs.length ? (evs.every((e) => e.amount !== null) ? evs.reduce((s, e) => s + (e.amount ?? 0), 0) : null) : null;
    let status: CostStatus;
    if (evs.length === 0) {
      status = cat === "other" ? "needs_review" : "missing";
      reasons.push(cat === "other" ? "항목을 알아보지 못해 대응하는 영수증을 정하지 못함" : "대응하는 영수증을 찾지 못함");
    } else if (claimed === null || evidenced === null) {
      status = "needs_review";
      reasons.push("금액을 읽지 못함");
    } else {
      status = claimed === evidenced ? "match" : "mismatch";
      if (claimUncertain || evs.some((e) => e.uncertain)) {
        status = "needs_review";
        reasons.push("글자 읽기가 불확실한 금액이 있음");
      }
    }
    if (evs.some((e) => dupIds.has(e.receipt.id))) {
      if (status === "match") status = "needs_review";
      reasons.push("같은 영수증이 두 번 들어간 것으로 보임");
    }
    if (status === "mismatch" && claimed !== null && evidenced !== null) reasons.push(`청구 ${won(claimed)}, 영수증 ${won(evidenced)}`);
    const receiptRefs = [...new Map(evs.map((e) => [e.receipt.id, { id: e.receipt.id, page: e.receipt.page }])).values()];
    rows.push({
      category: cat,
      label: cat === "other" ? items.map((i) => i.label).join(", ") : [...new Set(items.map((i) => i.label))].join(", ") || CATEGORY_LABELS[cat],
      claimed,
      evidenced,
      diff: claimed !== null && evidenced !== null ? claimed - evidenced : null,
      status,
      receipts: receiptRefs,
      claimPages: [...new Set(items.map((i) => i.page))],
      reasons,
    });
  }

  // 청구서에 없는 영수증
  const extraReceipts: CostResult["extraReceipts"] = [];
  for (const r of receipts) {
    for (const it of r.items) {
      if (it.category === "fee") {
        extraReceipts.push({ id: r.id, page: r.page, label: it.label, amount: it.amount.value, reason: "법무사 보수 영수증 (대조하지 않음)" });
        continue;
      }
      const merged = it.category === "education_tax" && !evByCat.has("education_tax") && used.has("registration_tax");
      const matched = merged || (used.has(it.category) && (it.category !== "other" || rows.some((row) => row.receipts.some((x) => x.id === r.id))));
      if (!matched) extraReceipts.push({ id: r.id, page: r.page, label: it.label || r.title, amount: it.amount.value, reason: it.category === "other" ? "항목을 알아보지 못한 영수증" : "청구서에 이 항목이 없음" });
    }
    if (r.items.length === 0) extraReceipts.push({ id: r.id, page: r.page, label: r.title, amount: null, reason: r.notes.join(", ") || "금액을 찾지 못함" });
  }

  const duplicates = dupGroups.map((g) => ({ ids: g.map((r) => r.id), reason: "발급기관·날짜·금액이 모두 같은 영수증" }));

  const claimedItemsSum = claim.items.reduce((s, i) => s + (i.amount.value ?? 0), 0);
  const claimedExpenses = claim.items.filter((i) => i.category !== "fee").reduce((s, i) => s + (i.amount.value ?? 0), 0);
  const evidencedTotal = receipts.flatMap((r) => r.items).filter((i) => i.category !== "fee").reduce((s, i) => s + (i.amount.value ?? 0), 0);
  const claimedTotal = claim.total?.value ?? (claim.items.length ? claimedItemsSum : null);
  if (claim.total?.value != null && claim.total.value !== claimedItemsSum) {
    warnings.push(`청구서 합계(${won(claim.total.value)})와 항목 금액의 합(${won(claimedItemsSum)})이 다릅니다.`);
  }
  if (claim.total?.uncertain) warnings.push("청구서 합계 금액의 글자 읽기가 불확실합니다.");

  const counts: Record<CostStatus, number> = { match: 0, mismatch: 0, missing: 0, needs_review: 0 };
  for (const r of rows) counts[r.status]++;

  let summary: CostResult["summary"];
  if (counts.mismatch > 0 || counts.missing > 0) summary = "불일치 있음";
  else if (counts.needs_review > 0 || warnings.length > 0 || extraReceipts.some((e) => !e.reason.startsWith("법무사 보수")) || duplicates.length > 0 || rows.length === 0)
    summary = "확인 필요";
  else summary = "전부 일치";

  return {
    summary,
    rows,
    feeItems,
    extraReceipts,
    duplicates,
    totals: { claimedTotal, claimedTotalFromDoc: claim.total?.value != null, claimedExpenses, evidencedTotal, diff: claimedExpenses - evidencedTotal },
    counts,
    warnings,
  };
}
