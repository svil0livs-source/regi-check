// Design Ref: DESIGN.md §4.3 — 접수번호로 근저당권(주등기)과 근저당권이전(부기등기)을 찾고, 건 하나를 대조한다. (PLAN 9번)
// 등기부에서 옮겨 적은 내용(RegistryRead)과 한글 서류 값(DocumentFields)을 받아 항목 결과를 만든다.
// 외부 서비스를 부르지 않는 순수 함수라서 서류 없이 시험할 수 있다.

import { compareDocuments } from "@/lib/compare/compareDocuments";
import { normalizeAmount, normalizeReceiptNumber } from "@/lib/compare/normalize";
import {
  FIELD_DEFINITIONS,
  type DocumentFields,
  type ExtractedValue,
  type FieldKey,
  type FieldResult,
} from "@/types/verification";
import type { OcrValue, RegistryMortgage, RegistryRead, RegistryTransfer } from "@/lib/readers/registryOcr";

const toValue = (v: OcrValue | undefined): ExtractedValue =>
  v ? { value: v.text, lowConfidence: v.uncertain } : { value: null };

/** 이번 서류의 양수인. 등기부에 이미 이전이 끝나 이 이름이 나와도 양도인으로 보지 않는다 */
const ASSIGNEE_NAME = "한국자산관리공사";

/** 부동산 표시 항목 */
const PROPERTY_KEYS: FieldKey[] = ["location", "lotNumber", "unitNumber", "area"];

/** 항목 결과를 강제로 정할 때 쓰는 값 */
interface Forced {
  key: FieldKey;
  index?: number;
  status: "mismatch" | "needs_review";
  reason: string;
  registryValue?: string | null;
}

const receiptOf = (v: ExtractedValue) => (v.value ? normalizeReceiptNumber(v.value) : null);

/**
 * 한글 서류의 이전할 근저당권마다 등기부에서 같은 접수번호의 근저당권을 찾는다.
 * - 등기부 근저당권이 1건이고 서류도 1건이면 번호가 달라도 그 건과 비교한다 (틀린 번호를 불일치로 보여 주기 위해)
 * - 찾지 못하면: 번호를 확신할 수 있으면 「해당 접수번호 없음」(불일치), 아니면 「확인 필요」
 */
function selectMortgages(reg: RegistryRead, hwp: DocumentFields) {
  const forced: Forced[] = [];
  const all = reg.mortgages;
  const used = new Set<RegistryMortgage>();
  const picked: (RegistryMortgage | undefined)[] = hwp.mortgages.map((m, i) => {
    const index = i + 1;
    const needAll = (reason: string) => {
      for (const key of ["receiptNumber", "registrationDate", "rank"] as const) forced.push({ key, index, status: "needs_review", reason });
    };
    if (all.length === 0) {
      forced.push({ key: "receiptNumber", index, status: "mismatch", reason: "등기부등본에 근저당권이 없음", registryValue: null });
      forced.push({ key: "registrationDate", index, status: "needs_review", reason: "등기부등본에서 근저당권을 찾지 못함" });
      forced.push({ key: "rank", index, status: "needs_review", reason: "등기부등본에서 근저당권을 찾지 못함" });
      return undefined;
    }
    if (all.length === 1 && hwp.mortgages.length === 1) return all[0];
    const target = receiptOf(m.receiptNumber);
    if (!target) {
      needAll("한글 서류의 접수번호를 읽지 못해 등기부의 근저당권을 고를 수 없음");
      return undefined;
    }
    const hits = all.filter((r) => r.receiptNumber.text && !r.receiptNumber.uncertain && normalizeReceiptNumber(r.receiptNumber.text) === target);
    if (hits.length === 1) return hits[0];
    // 건물·토지 등기부가 한 PDF에 함께 있으면 같은 공동담보 근저당권이 여러 번 나온다: 접수일까지 같으면 같은 건으로 본다
    const sameDay = (r: RegistryMortgage) => r.registrationDate.text?.replace(/\s+/g, "");
    // 한글 서류도 같은 공동담보 근저당권을 부동산마다 한 줄씩(순위는 그 등기부의 순위) 적는다 (2026-11-09 실제 서류):
    // 아직 짝짓지 않은 것 중 순위가 같은 것 → 아직 짝짓지 않은 것 → 첫 건 순서로 고른다
    if (hits.length > 1 && hits.every((h) => !h.registrationDate.uncertain && sameDay(h) && sameDay(h) === sameDay(hits[0]))) {
      const want = (m.rank.value ?? "").replace(/\D/g, "");
      const hit = hits.find((h) => !used.has(h) && h.rank === want) ?? hits.find((h) => !used.has(h)) ?? hits[0];
      used.add(hit);
      return hit;
    }
    if (hits.length > 1) {
      needAll("같은 접수번호의 근저당권이 여러 건이라 어느 것과 비교할지 확신할 수 없음");
      return undefined;
    }
    if (all.some((r) => !r.receiptNumber.text || r.receiptNumber.uncertain)) {
      needAll("등기부등본의 접수번호 일부를 확신할 수 없어 해당 근저당권을 고를 수 없음");
      return undefined;
    }
    forced.push({ key: "receiptNumber", index, status: "mismatch", reason: "해당 접수번호 없음", registryValue: "해당 접수번호 없음" });
    forced.push({ key: "registrationDate", index, status: "needs_review", reason: "등기부등본에서 같은 접수번호의 근저당권을 찾지 못함" });
    forced.push({ key: "rank", index, status: "needs_review", reason: "등기부등본에서 같은 접수번호의 근저당권을 찾지 못함" });
    return undefined;
  });
  return { picked, forced };
}

/**
 * 근저당권의 지금 권리자(= 이번 서류의 양도인): 원 근저당권자 → 이전(부기등기) 양수인 순서에서
 * 마지막 사람. 단 이번 양수인(한국자산관리공사)은 건너뛴다.
 */
function currentHolder(m: RegistryMortgage): { name: OcrValue; idFront: OcrValue } {
  const chain = [{ name: m.mortgagee, idFront: m.mortgageeIdFront }, ...m.transfers.map((t: RegistryTransfer) => ({ name: t.assignee, idFront: t.assigneeIdFront }))];
  const notAssignee = chain.filter((c) => !(c.name.text ?? "").replace(/\s+/g, "").includes(ASSIGNEE_NAME));
  return notAssignee[notAssignee.length - 1] ?? chain[0];
}

/**
 * 채권최고액 합계 (하나라도 읽지 못하면 null, 확신 낮으면 확신 낮음).
 * 같은 공동담보 근저당권(접수번호·접수일이 같음)이 부동산마다 나와도 한 번만 더한다 (2026-11-09 실제 서류)
 */
function sumAmounts(all: RegistryMortgage[]): ExtractedValue {
  const keyOf = (m: RegistryMortgage) => `${normalizeReceiptNumber(m.receiptNumber.text ?? "")}|${(m.registrationDate.text ?? "").replace(/\s+/g, "")}`;
  const list = all.filter((m, i) => !m.receiptNumber.text || all.findIndex((x) => keyOf(x) === keyOf(m)) === i);
  let total = BigInt(0);
  let low = false;
  for (const m of list) {
    const n = m.maxClaimAmount.text ? normalizeAmount(m.maxClaimAmount.text) : null;
    if (n === null) return { value: null };
    total += BigInt(n);
    low ||= m.maxClaimAmount.uncertain;
  }
  if (list.length === 1) return toValue(list[0].maxClaimAmount);
  return { value: `금 ${total.toLocaleString("en-US")}원`, lowConfidence: low };
}

/** 등기부에서 옮겨 적은 내용 → 대조용 등기부 값 (picked: 한글 서류 근저당권과 같은 순서로 찾은 건) */
export function registryToFields(reg: RegistryRead, picked: (RegistryMortgage | undefined)[]): DocumentFields {
  const found = picked.filter((m): m is RegistryMortgage => !!m);
  const holder = found[0] ? currentHolder(found[0]) : undefined;
  const debtors: OcrValue[] = [];
  for (const m of found) for (const d of m.debtors) if (!debtors.some((x) => x.text === d.text)) debtors.push(d);
  return {
    parties: {
      mortgagee: holder ? [toValue(holder.name)] : [],
      debtor: debtors.map(toValue),
    },
    properties: reg.properties.map((p) => ({
      location: toValue(p.location),
      lotNumber: toValue(p.lotNumber),
      unitNumber: toValue(p.unitNumber),
      area: toValue(p.area),
    })),
    mortgages: picked.map((m) => ({
      receiptNumber: toValue(m?.receiptNumber),
      registrationDate: toValue(m?.registrationDate),
      rank: { value: m?.rank || null },
    })),
    maxClaimAmount: found.length ? sumAmounts(found) : { value: null },
    mortgageeIdFront: toValue(holder?.idFront),
  };
}

/** 한글 서류 쪽 값을 보기 좋게 합친다 (강제 결과의 한글 서류 칸에 쓰기 위해) */
function hwpValueOf(hwp: DocumentFields, f: Forced): string | null {
  const join = (l: ExtractedValue[]) => (l.length ? l.map((v) => v.value ?? "(읽지 못함)").join(", ") : null);
  if (PROPERTY_KEYS.includes(f.key)) return join(hwp.properties.map((p) => p[f.key as keyof DocumentFields["properties"][number]]));
  if (f.key === "mortgagee" || f.key === "debtor") return join(hwp.parties[f.key]);
  if (f.key === "receiptNumber" || f.key === "registrationDate" || f.key === "rank") return hwp.mortgages[(f.index ?? 1) - 1]?.[f.key].value ?? null;
  if (f.key === "maxClaimAmount" || f.key === "mortgageeIdFront") return hwp[f.key].value;
  return null;
}

/** 한글 서류 쪽에서 그 항목을 읽지 못했는지 (그러면 비교 결과 「읽지 못함」을 그대로 둔다) */
function hwpUnreadable(hwp: DocumentFields, f: Forced): boolean {
  if (f.key === "mortgagee" || f.key === "debtor") return hwp.parties[f.key].some((v) => v.value === null);
  if (f.key === "receiptNumber" || f.key === "registrationDate" || f.key === "rank") return hwp.mortgages[(f.index ?? 1) - 1]?.[f.key].value === null;
  if (f.key === "maxClaimAmount") return hwp.maxClaimAmount.value === null;
  return false;
}

/** 고른 근저당권에 딸린 항목 (근저당권을 고르지 못하면 등기부 쪽 값이 비는 항목) */
const MORTGAGE_KEYS: FieldKey[] = ["mortgagee", "debtor", "maxClaimAmount", "mortgageeIdFront", "receiptNumber", "registrationDate", "rank"];
const MORTGAGE_ROW_KEYS: FieldKey[] = ["receiptNumber", "registrationDate", "rank"];

/**
 * 한글 서류에 값이 없어 등기부의 근저당권을 고르지 못한 경우, 「두 문서 모두에서 값을 읽지 못했습니다」는 틀린 말이다
 * (등기부는 읽었지만 어느 근저당권과 비교할지 몰라 값을 꺼내지 않았을 뿐). 한글 서류 탓임을 밝힌다 (2026-11-07).
 */
function explainUnpicked(results: FieldResult[], picked: (RegistryMortgage | undefined)[]): FieldResult[] {
  if (picked.every(Boolean)) return results;
  return results.map((r) =>
    r.status === "unreadable" && r.hwpValue === null && r.registryValue === null && MORTGAGE_KEYS.includes(r.key) &&
    // 접수번호·접수일·순위번호의 index는 몇 번째 근저당권, 양도인·채무자의 index는 몇 번째 사람이다
    (MORTGAGE_ROW_KEYS.includes(r.key) ? !picked[(r.index ?? 1) - 1] : picked.every((m) => !m))
      ? { ...r, reason: "한글 서류에서 값을 읽지 못했습니다. 한글 서류에 접수번호가 없어 등기부등본에서 대조할 근저당권도 고르지 못했습니다." }
      : r,
  );
}

/** 건 하나를 대조한다: 근저당권 찾기 → 항목 비교 → 고르지 못한 항목은 강제 결과로 바꾸기 */
export function verifyCase(hwp: DocumentFields, reg: RegistryRead): FieldResult[] {
  const { picked, forced } = selectMortgages(reg, hwp);
  const found = picked.filter(Boolean);
  // 근저당권을 하나도 찾지 못하면 그 근저당권에 딸린 양도인·채무자·채권최고액은 대조할 수 없다
  if (found.length === 0) {
    for (const key of ["mortgagee", "debtor", "maxClaimAmount"] as const) forced.push({ key, status: "needs_review", reason: "등기부등본에서 해당 근저당권을 찾지 못함" });
  } else if (found.length < picked.length) {
    // 일부만 찾았으면 합계를 맞출 수 없다
    forced.push({ key: "maxClaimAmount", status: "needs_review", reason: "이전할 근저당권 일부를 등기부등본에서 찾지 못해 합계를 대조할 수 없음" });
  }
  // 등기부에서 표제부를 찾지 못하면 "등기부등본에 없음"(불일치)으로 단정하지 않는다 (CHECK 9번).
  // 2026-11-09부터 토지·일반건물 표제부도 자동 대조한다
  if (reg.properties.length === 0) {
    for (const key of PROPERTY_KEYS) forced.push({ key, status: "needs_review", reason: "등기부등본에서 표제부(부동산 표시)를 찾지 못했습니다. 직접 확인해 주세요." });
  }
  const results = explainUnpicked(compareDocuments(hwp, registryToFields(reg, picked)), picked);
  const active = forced.filter((f) => !hwpUnreadable(hwp, f));
  if (active.length === 0) return results;
  // 강제 결과가 있는 항목(같은 key, index가 있으면 같은 index)의 비교 결과를 바꾼다
  const hit = (r: FieldResult, f: Forced) => r.key === f.key && (f.index === undefined || r.index === f.index);
  const kept = results.filter((r) => !active.some((f) => hit(r, f)));
  const seen = new Set<string>();
  const replaced: FieldResult[] = [];
  for (const f of active) {
    const id = `${f.key}:${f.index ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    replaced.push({
      key: f.key,
      group: FIELD_DEFINITIONS[f.key].group,
      hwpValue: hwpValueOf(hwp, f),
      registryValue: f.registryValue ?? null,
      status: f.status,
      reason: f.reason,
      ...(f.index !== undefined ? { index: f.index } : {}),
    });
  }
  return [...kept, ...replaced];
}
