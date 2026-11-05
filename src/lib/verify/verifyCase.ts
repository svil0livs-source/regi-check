// Design Ref: DESIGN.md §4.3 — 접수번호로 근저당권(주등기)과 근저당권이전(부기등기)을 찾고, 건 하나를 대조한다. (PLAN 9번)
// 등기부에서 옮겨 적은 내용(RegistryRead)과 한글 서류 값(DocumentFields)을 받아 항목 결과를 만든다.
// 외부 서비스를 부르지 않는 순수 함수라서 서류 없이 시험할 수 있다.

import { compareDocuments } from "@/lib/compare/compareDocuments";
import { normalizeReceiptNumber } from "@/lib/compare/normalize";
import {
  FIELD_DEFINITIONS,
  OPTIONAL_FIELD_KEYS,
  type DocumentFields,
  type ExtractedValue,
  type FieldKey,
  type FieldResult,
} from "@/types/verification";
import type { OcrValue, RegistryMortgage, RegistryRead, RegistryTransfer } from "@/lib/readers/registryOcr";

const toValue = (v: OcrValue | undefined): ExtractedValue =>
  v ? { value: v.text, lowConfidence: v.uncertain } : { value: null };

/** 근저당권(주등기)에 딸린 항목 */
const MORTGAGE_KEYS: FieldKey[] = ["mortgagee", "mortgageeIdFront", "debtor", "maxClaimAmount", "registrationDate"];
/** 근저당권이전(부기등기)에 딸린 항목 */
const TRANSFER_KEYS: FieldKey[] = ["assignee", "assigneeIdFront", "transferReceiptNumber", "transferRegistrationDate"];

/** 부동산 표시 항목 */
const PROPERTY_KEYS: FieldKey[] = ["location", "lotNumber", "unitNumber", "area"];

/** 항목 결과를 강제로 정할 때 쓰는 값 */
interface Forced {
  status: "mismatch" | "needs_review";
  reason: string;
  registryValue?: string | null;
}

/** 한쪽 문서 값 목록 중 접수번호가 같은 것 찾기 (확신 낮은 번호는 짝짓기에 쓰지 않음) */
function matchByReceipt<T extends { receiptNumber: OcrValue }>(list: T[], hwpReceipt: ExtractedValue): T[] {
  const target = hwpReceipt.value ? normalizeReceiptNumber(hwpReceipt.value) : null;
  if (!target) return [];
  return list.filter((m) => {
    if (!m.receiptNumber.text || m.receiptNumber.uncertain) return false;
    return normalizeReceiptNumber(m.receiptNumber.text) === target;
  });
}

const hwpReceiptReadable = (v: ExtractedValue) => !!v.value && normalizeReceiptNumber(v.value) !== null;

/**
 * 등기부 쪽 후보 중 접수번호를 못 읽었거나 확신이 낮은 것이 있는지.
 * 있으면 "해당 접수번호 없음"(불일치)으로 단정하지 않는다 — 그 건이 맞는 건일 수도 있다. (확신 없으면 「확인 필요」)
 */
const someReceiptUnsure = (list: { receiptNumber: OcrValue }[]) =>
  list.some((m) => !m.receiptNumber.text || m.receiptNumber.uncertain);

/** 근저당권·부기등기를 고르고, 고르지 못한 경우의 강제 결과를 정한다 */
function selectMortgage(reg: RegistryRead, hwp: DocumentFields) {
  const forced = new Map<FieldKey, Forced>();
  const all = reg.mortgages;
  let mortgage: RegistryMortgage | undefined;

  // ── 1단계: 원 접수번호 → 근저당권(주등기)
  if (all.length === 0) {
    forced.set("receiptNumber", { status: "mismatch", reason: "등기부등본에 근저당권이 없음", registryValue: null });
    for (const k of [...MORTGAGE_KEYS, ...TRANSFER_KEYS]) forced.set(k, { status: "needs_review", reason: "등기부등본에서 근저당권을 찾지 못함" });
    return { mortgage, transfer: undefined, forced };
  }
  if (all.length === 1) {
    mortgage = all[0];
  } else {
    const hits = matchByReceipt(all, hwp.receiptNumber);
    if (hits.length === 1) {
      mortgage = hits[0];
    } else {
      const unsure = hits.length === 0 && someReceiptUnsure(all);
      const why =
        hits.length > 1
          ? "같은 접수번호의 근저당권이 여러 건이라 어느 것과 비교할지 확신할 수 없음"
          : !hwpReceiptReadable(hwp.receiptNumber)
            ? "한글 서류의 원 접수번호를 읽지 못해 근저당권을 고를 수 없음"
            : unsure
              ? "등기부등본의 접수번호 일부를 확신할 수 없어 해당 근저당권을 고를 수 없음"
              : "한글 서류의 원 접수번호와 같은 근저당권이 없어 어느 것과 비교할지 모름";
      if (hits.length === 0 && hwpReceiptReadable(hwp.receiptNumber) && !unsure) {
        forced.set("receiptNumber", { status: "mismatch", reason: "해당 접수번호 없음", registryValue: "해당 접수번호 없음" });
      } else if (hits.length > 1 || (unsure && hwpReceiptReadable(hwp.receiptNumber))) {
        forced.set("receiptNumber", { status: "needs_review", reason: why });
      }
      // 한글 서류 번호를 못 읽은 경우: 원 접수번호는 compareField가 「읽지 못함」으로 처리
      for (const k of [...MORTGAGE_KEYS, ...TRANSFER_KEYS]) forced.set(k, { status: "needs_review", reason: why });
      return { mortgage, transfer: undefined, forced };
    }
  }

  // ── 2단계: 이전 접수번호 → 근저당권이전(부기등기)
  const transfers = mortgage.transfers;
  let transfer: RegistryTransfer | undefined;
  if (transfers.length === 0) {
    for (const k of TRANSFER_KEYS) forced.set(k, { status: "mismatch", reason: "등기부등본에 없음 (근저당권이전 기록 없음)", registryValue: null });
  } else if (transfers.length === 1) {
    transfer = transfers[0];
  } else {
    const hits = matchByReceipt(transfers, hwp.transferReceiptNumber);
    if (hits.length === 1) {
      transfer = hits[0];
    } else {
      const unsure = hits.length === 0 && someReceiptUnsure(transfers);
      const why =
        hits.length > 1
          ? "같은 접수번호의 근저당권이전이 여러 건이라 확신할 수 없음"
          : unsure
            ? "등기부등본의 이전 접수번호 일부를 확신할 수 없어 해당 근저당권이전을 고를 수 없음"
            : "한글 서류의 이전 접수번호와 같은 근저당권이전을 찾지 못함";
      if (hits.length === 0 && hwpReceiptReadable(hwp.transferReceiptNumber) && !unsure) {
        forced.set("transferReceiptNumber", { status: "mismatch", reason: "해당 접수번호 없음", registryValue: "해당 접수번호 없음" });
      } else if (hits.length > 1 || (unsure && hwpReceiptReadable(hwp.transferReceiptNumber))) {
        forced.set("transferReceiptNumber", { status: "needs_review", reason: why });
      }
      forced.set("assignee", { status: "needs_review", reason: why });
      forced.set("assigneeIdFront", { status: "needs_review", reason: why });
      forced.set("transferRegistrationDate", { status: "needs_review", reason: why });
    }
  }
  return { mortgage, transfer, forced };
}

/** 등기부에서 옮겨 적은 내용 → 대조용 등기부 값 */
export function registryToFields(reg: RegistryRead, mortgage?: RegistryMortgage, transfer?: RegistryTransfer): DocumentFields {
  return {
    parties: {
      mortgagee: mortgage ? [toValue(mortgage.mortgagee)] : [],
      assignee: transfer ? [toValue(transfer.assignee)] : [],
      debtor: mortgage ? mortgage.debtors.map(toValue) : [],
      owner: reg.owners.map(toValue),
    },
    properties: reg.properties.map((p) => ({
      location: toValue(p.location),
      lotNumber: toValue(p.lotNumber),
      unitNumber: toValue(p.unitNumber),
      area: toValue(p.area),
    })),
    maxClaimAmount: toValue(mortgage?.maxClaimAmount),
    receiptNumber: toValue(mortgage?.receiptNumber),
    transferReceiptNumber: toValue(transfer?.receiptNumber),
    registrationDate: toValue(mortgage?.registrationDate),
    transferRegistrationDate: toValue(transfer?.registrationDate),
    mortgageeIdFront: toValue(mortgage?.mortgageeIdFront),
    assigneeIdFront: toValue(transfer?.assigneeIdFront),
  };
}

/** 한쪽 문서의 항목 값을 보기 좋게 합친다 (강제 결과의 한글 서류 칸에 쓰기 위해) */
function hwpValueOf(hwp: DocumentFields, key: FieldKey): string | null {
  if (PROPERTY_KEYS.includes(key)) {
    const k = key as keyof DocumentFields["properties"][number];
    return hwp.properties.length ? hwp.properties.map((p) => p[k].value ?? "(읽지 못함)").join(", ") : null;
  }
  if (key in hwp.parties) {
    const list = hwp.parties[key as keyof DocumentFields["parties"]];
    return list.length ? list.map((v) => v.value ?? "(읽지 못함)").join(", ") : null;
  }
  const v = (hwp as unknown as Record<string, ExtractedValue | undefined>)[key];
  return v && "value" in v ? v.value : null;
}

/** 한글 서류 쪽에서 그 항목을 읽지 못했는지 */
function hwpUnreadable(hwp: DocumentFields, key: FieldKey): boolean {
  if (key in hwp.parties) return hwp.parties[key as keyof DocumentFields["parties"]].some((v) => v.value === null);
  const v = (hwp as unknown as Record<string, ExtractedValue | undefined>)[key];
  return !!v && "value" in v && v.value === null;
}

/** 건 하나를 대조한다: 근저당권 고르기 → 항목 비교 → 고르지 못한 항목은 강제 결과로 바꾸기 */
export function verifyCase(hwp: DocumentFields, reg: RegistryRead): FieldResult[] {
  const { mortgage, transfer, forced } = selectMortgage(reg, hwp);
  // 등록번호 앞 6자리는 두 문서 모두에 번호가 있을 때만 대조한다(DESIGN §4.2). 근저당권을 고르지 못해
  // 등기부 쪽 번호가 없으면 강제 결과도 넣지 않는다. 요약 판정에는 영향 없음 (CHECK 8번)
  for (const k of OPTIONAL_FIELD_KEYS) forced.delete(k);
  // 등기부에서 부동산 표시(집합건물 표제부)를 하나도 찾지 못하면 "등기부등본에 없음"(불일치)으로 단정하지 않는다.
  // 토지·일반건물 등기부는 표제부 모양이 달라 아직 자동으로 읽지 않는다 (CHECK 9번)
  if (reg.properties.length === 0) {
    for (const k of PROPERTY_KEYS) forced.set(k, { status: "needs_review", reason: "등기부등본에서 집합건물 표제부를 찾지 못했습니다. 토지·일반건물 등기부는 부동산 표시를 자동으로 대조하지 않으니 직접 확인해 주세요." });
  }
  const results = compareDocuments(hwp, registryToFields(reg, mortgage, transfer));

  if (forced.size === 0) return results;
  // 한글 서류 값을 읽지 못한 항목은 비교 결과(「읽지 못함」)를 그대로 두고, 나머지 강제 항목만 바꾼다
  const replaceKeys = new Set([...forced.keys()].filter((k) => !hwpUnreadable(hwp, k)));
  const kept = results.filter((r) => !replaceKeys.has(r.key));
  const replaced: FieldResult[] = [];
  for (const [key, f] of forced) {
    if (!replaceKeys.has(key)) continue;
    replaced.push({
      key,
      group: FIELD_DEFINITIONS[key].group,
      hwpValue: hwpValueOf(hwp, key),
      registryValue: f.registryValue ?? null,
      status: f.status,
      reason: f.reason,
    });
  }
  return [...kept, ...replaced];
}
