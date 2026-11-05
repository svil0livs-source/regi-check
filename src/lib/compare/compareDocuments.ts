// Design Ref: DESIGN.md §4.7 — 여러 명·여러 개를 짝지어 대조한다. 등기부등본이 정답이다.
// Plan SC: 짝을 확신할 수 없으면 「일치」나 「불일치」로 단정하지 않고 「확인 필요」로 둔다.

import {
  FIELD_DEFINITIONS,
  PARTY_ROLES,
  PROPERTY_FIELD_KEYS,
  type DocumentFields,
  type ExtractedValue,
  type FieldResult,
  type PartyRole,
  type PropertyEntry,
} from "@/types/verification";
import { compareField, toComparable } from "./compareField";

const REASON_NOT_IN_HWP = "한글 서류에 없음";
const REASON_NOT_IN_REGISTRY = "등기부등본에 없음";

/** 짝짓기에 쓸 수 있는 값인지: 읽었고, 확신이 높고, 비교용 값을 만들 수 있어야 한다. */
function usableComparable(
  kind: Parameters<typeof toComparable>[0],
  v: ExtractedValue,
): string | null {
  if (v.value === null || v.lowConfidence) return null;
  return toComparable(kind, v.value);
}

/** 한쪽 목록에 같은 비교용 값이 2번 이상 있는지 */
function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

// ── 당사자 ─────────────────────────────────────────────────────────

/**
 * 역할 하나(예: 소유자)의 여러 명을 대조한다.
 * 1) 같은 이름끼리 먼저 짝 → 「일치」 (순서 무관)
 * 2) 남은 이름이 양쪽에 있으면 원래 순서대로 짝 → 「불일치」
 * 3) 짝이 없는 이름 → 「불일치」 + "…에 없음" (인원 수가 다름)
 * 4) 읽지 못했거나 확신 낮은 이름이 있으면 짝을 확신할 수 없음 → 역할 전체를 확인 필요/읽지 못함
 * 5) 한쪽에 같은 이름이 2번 이상 → 역할 전체 「확인 필요」
 */
export function compareParties(
  role: PartyRole,
  hwpList: ExtractedValue[],
  registryList: ExtractedValue[],
): FieldResult[] {
  const { group, kind } = FIELD_DEFINITIONS[role];
  const hwpNorm = hwpList.map((v) => usableComparable(kind, v));
  const regNorm = registryList.map((v) => usableComparable(kind, v));

  const allUsable = [...hwpNorm, ...regNorm].every((n) => n !== null);
  const duplicated =
    allUsable && (hasDuplicates(hwpNorm as string[]) || hasDuplicates(regNorm as string[]));

  // 4)·5) 짝을 확신할 수 없는 경우: 순서대로 나란히 보여 주되 「일치」/「불일치」로 단정하지 않는다.
  if (!allUsable || duplicated) {
    const reason = duplicated
      ? "같은 이름이 2번 이상 있어 짝을 확신할 수 없습니다."
      : "읽지 못했거나 확신이 낮은 이름이 있어 짝을 확신할 수 없습니다.";
    const count = Math.max(hwpList.length, registryList.length);
    return Array.from({ length: count }, (_, i) => {
      const hwp = hwpList[i];
      const reg = registryList[i];
      const base = {
        key: role,
        group,
        hwpValue: hwp?.value ?? null,
        registryValue: reg?.value ?? null,
        index: i + 1,
      };
      // 이 칸 자체를 읽지 못했으면 「읽지 못함」을 그대로 보여 준다.
      if ((hwp && hwp.value === null) || (reg && reg.value === null)) {
        const single = compareField(role, hwp ?? { value: null }, reg ?? { value: null });
        return { ...single, index: i + 1 };
      }
      return { ...base, status: "needs_review" as const, reason };
    });
  }

  const results: FieldResult[] = [];
  const usedReg = new Set<number>();
  const leftoverHwp: number[] = [];

  // 1) 같은 이름끼리 짝
  hwpNorm.forEach((h, i) => {
    const j = regNorm.findIndex((r, idx) => !usedReg.has(idx) && r === h);
    if (j === -1) {
      leftoverHwp.push(i);
      return;
    }
    usedReg.add(j);
    results.push({
      key: role,
      group,
      hwpValue: hwpList[i].value,
      registryValue: registryList[j].value,
      status: "match",
    });
  });
  const leftoverReg = regNorm.map((_, j) => j).filter((j) => !usedReg.has(j));

  // 2) 남은 것끼리 순서대로 짝 → 불일치
  const paired = Math.min(leftoverHwp.length, leftoverReg.length);
  for (let k = 0; k < paired; k++) {
    results.push({
      key: role,
      group,
      hwpValue: hwpList[leftoverHwp[k]].value,
      registryValue: registryList[leftoverReg[k]].value,
      status: "mismatch",
    });
  }

  // 3) 짝이 없는 이름 → 불일치 (상대 문서에 없음)
  for (const i of leftoverHwp.slice(paired)) {
    results.push({
      key: role,
      group,
      hwpValue: hwpList[i].value,
      registryValue: null,
      status: "mismatch",
      reason: REASON_NOT_IN_REGISTRY,
    });
  }
  for (const j of leftoverReg.slice(paired)) {
    results.push({
      key: role,
      group,
      hwpValue: null,
      registryValue: registryList[j].value,
      status: "mismatch",
      reason: REASON_NOT_IN_HWP,
    });
  }

  return results.map((r, i) => ({ ...r, index: i + 1 }));
}

// ── 부동산 ─────────────────────────────────────────────────────────

/** 짝 기준: 소재지+지번+건물 호수. 하나라도 쓸 수 없으면 null (1단계 짝짓기에서 뺀다). */
function propertyKey(p: PropertyEntry): string | null {
  const parts = (["location", "lotNumber", "unitNumber"] as const).map((k) =>
    usableComparable(FIELD_DEFINITIONS[k].kind, p[k]),
  );
  return parts.every((x) => x !== null) ? parts.join("\u0000") : null;
}

/** 짝지은 부동산 두 개의 4개 칸을 각각 비교한다. */
function comparePropertyPair(
  hwp: PropertyEntry,
  reg: PropertyEntry,
  index: number,
): FieldResult[] {
  return PROPERTY_FIELD_KEYS.map((k) => ({ ...compareField(k, hwp[k], reg[k]), index }));
}

/** 한쪽에만 있는 부동산의 4개 칸을 같은 상태로 만든다. */
function propertyOneSide(
  p: PropertyEntry,
  side: "hwp" | "registry",
  status: "mismatch" | "needs_review",
  reason: string,
  index: number,
): FieldResult[] {
  return PROPERTY_FIELD_KEYS.map((k) => ({
    key: k,
    group: "property" as const,
    hwpValue: side === "hwp" ? p[k].value : null,
    registryValue: side === "registry" ? p[k].value : null,
    status,
    reason,
    index,
  }));
}

/**
 * 부동산 여러 개를 대조한다.
 * 1) 소재지+지번+건물 호수가 같은 것끼리 짝 → 4개 칸 각각 비교
 * 2) 짝 없는 부동산이 양쪽에 1개씩 → 그 둘을 짝지어 4개 칸 각각 비교
 * 3) 짝 없는 부동산이 한쪽에만 있음 → 4개 칸 모두 「불일치」 + "…에 없음"
 * 4) 그 밖(양쪽에 남았지만 1:1이 아님) → 짝을 확신할 수 없으므로 4개 칸 모두 「확인 필요」
 * 짝 기준 칸을 읽지 못했거나 확신이 낮은 부동산은 1)에서 빠지고 2)~4)로 간다.
 */
export function compareProperties(
  hwpList: PropertyEntry[],
  registryList: PropertyEntry[],
): FieldResult[] {
  const hwpKeys = hwpList.map(propertyKey);
  const regKeys = registryList.map(propertyKey);

  const results: FieldResult[] = [];
  const usedReg = new Set<number>();
  const leftoverHwp: number[] = [];
  let index = 0;

  // 1) 같은 부동산끼리 짝
  hwpKeys.forEach((h, i) => {
    const j = h === null ? -1 : regKeys.findIndex((r, idx) => !usedReg.has(idx) && r === h);
    if (j === -1) {
      leftoverHwp.push(i);
      return;
    }
    usedReg.add(j);
    results.push(...comparePropertyPair(hwpList[i], registryList[j], ++index));
  });
  const leftoverReg = regKeys.map((_, j) => j).filter((j) => !usedReg.has(j));

  if (leftoverHwp.length === 1 && leftoverReg.length === 1) {
    // 2) 1:1로 남음 → 짝지어 틀린 칸을 보여 준다
    results.push(...comparePropertyPair(hwpList[leftoverHwp[0]], registryList[leftoverReg[0]], ++index));
  } else if (leftoverHwp.length === 0 || leftoverReg.length === 0) {
    // 3) 한쪽에만 남음 → 상대 문서에 없는 부동산
    for (const i of leftoverHwp) {
      results.push(...propertyOneSide(hwpList[i], "hwp", "mismatch", REASON_NOT_IN_REGISTRY, ++index));
    }
    for (const j of leftoverReg) {
      results.push(...propertyOneSide(registryList[j], "registry", "mismatch", REASON_NOT_IN_HWP, ++index));
    }
  } else {
    // 4) 양쪽에 남았지만 1:1이 아님 → 어느 것끼리 짝인지 확신할 수 없다
    const reason = "부동산 짝을 확신할 수 없어 직접 확인이 필요합니다.";
    for (const i of leftoverHwp) {
      results.push(...propertyOneSide(hwpList[i], "hwp", "needs_review", reason, ++index));
    }
    for (const j of leftoverReg) {
      results.push(...propertyOneSide(registryList[j], "registry", "needs_review", reason, ++index));
    }
  }

  return results;
}

// ── 건 전체 ────────────────────────────────────────────────────────

/** 한글 서류와 등기부등본에서 읽은 값을 받아, 건 하나의 모든 항목 대조 결과를 만든다. */
export function compareDocuments(hwp: DocumentFields, registry: DocumentFields): FieldResult[] {
  return [
    ...PARTY_ROLES.flatMap((role) =>
      compareParties(role, hwp.parties[role], registry.parties[role]),
    ),
    ...compareProperties(hwp.properties, registry.properties),
    compareField("maxClaimAmount", hwp.maxClaimAmount, registry.maxClaimAmount),
    compareField("receiptNumber", hwp.receiptNumber, registry.receiptNumber),
    compareField("transferReceiptNumber", hwp.transferReceiptNumber, registry.transferReceiptNumber),
    compareField("registrationDate", hwp.registrationDate, registry.registrationDate),
    compareField(
      "transferRegistrationDate",
      hwp.transferRegistrationDate,
      registry.transferRegistrationDate,
    ),
    ...compareIdFront("mortgageeIdFront", hwp.mortgageeIdFront, registry.mortgageeIdFront),
    ...compareIdFront("assigneeIdFront", hwp.assigneeIdFront, registry.assigneeIdFront),
  ];
}

/**
 * 등록번호 앞 6자리는 두 문서 모두에서 번호를 읽은 경우에만 대조한다 (PRD §5 must2, 2026-11-05 사용자 결정).
 * 한쪽에 번호가 없거나 읽지 못하면 이 항목은 대조하지 않는다(결과에 넣지 않음). 읽었지만 확신이 낮으면 compareField가 「확인 필요」로 둔다.
 */
function compareIdFront(
  key: "mortgageeIdFront" | "assigneeIdFront",
  hwp: DocumentFields["mortgageeIdFront"],
  registry: DocumentFields["mortgageeIdFront"],
): FieldResult[] {
  const has = (v: DocumentFields["mortgageeIdFront"]) => !!v.value && v.value.trim() !== "";
  return has(hwp) && has(registry) ? [compareField(key, hwp, registry)] : [];
}
