// Design Ref: DESIGN.md §4 단계 4 — 항목 하나를 비교한다. 등기부등본이 정답이다.
// Plan SC: 확신할 수 없으면 「일치」라고 하지 않고 「확인 필요」로 표시한다.

import {
  FIELD_DEFINITIONS,
  type CompareKind,
  type ExtractedValue,
  type FieldKey,
  type FieldResult,
} from "@/types/verification";
import {
  normalizeAmount,
  normalizeArea,
  normalizeIdFront,
  normalizeLotNumber,
  normalizeReceiptNumber,
  normalizeText,
  normalizeUnitNumber,
  parseDate,
  splitUnitDong,
} from "./normalize";

/**
 * 비교 종류별로 "비교용 값"을 만든다. 만들 수 없으면 null (= 확신할 수 없음).
 * 여러 명·여러 개 짝짓기(compareDocuments.ts)에서도 같은 기준으로 쓰기 위해 내보낸다.
 */
export function toComparable(kind: CompareKind, raw: string): string | null {
  switch (kind) {
    case "amount":
      return normalizeAmount(raw);
    case "receiptNumber":
      return normalizeReceiptNumber(raw);
    case "idFront":
      return normalizeIdFront(raw);
    case "date": {
      const parts = parseDate(raw);
      return parts ? `${parts.year}-${parts.month}-${parts.day}` : null;
    }
    case "text":
    case "lotNumber":
    case "unitNumber":
    case "area": {
      // 지번·건물 호수·면적은 원래 빈칸일 수 있다 (예: 토지는 건물 호수가 없음).
      // 원문이 빈칸이면 "빈 값"으로 비교한다: 양쪽 다 빈칸이면 일치, 한쪽만 빈칸이면 불일치.
      if (raw.trim() === "") return "";
      const text =
        kind === "lotNumber" ? normalizeLotNumber(raw)
        // 동은 짝짓기·층호 비교에서 빼고 compareField에서 따로 대조한다
        : kind === "unitNumber" ? splitUnitDong(normalizeUnitNumber(raw)).rest
        : kind === "area" ? normalizeArea(raw)
        : normalizeText(raw);
      // 글자가 있었는데 정규화 후 비었다면(예: 한자로만 적힘) 확신할 수 없다.
      return text.length > 0 ? text : null;
    }
    case "name":
    case "address": {
      const text = normalizeText(raw);
      // 이름·주소가 비어 있거나 한자로만 적혀 정규화 후 비었다면 확신할 수 없다.
      return text.length > 0 ? text : null;
    }
  }
}

/**
 * 세부 항목 하나를 대조한다.
 * 판정 순서 (앞에서 걸리면 거기서 끝):
 * 1) 어느 한쪽이라도 읽지 못함 → 「읽지 못함」
 * 2) 어느 한쪽이라도 확신이 낮음 → 「확인 필요」
 * 3) 비교용 값을 만들 수 없음(형식이 예상과 다름) → 「확인 필요」
 * 4) 비교용 값이 같음 → 「일치」, 다름 → 「불일치」
 */
export function compareField(
  key: FieldKey,
  hwp: ExtractedValue,
  registry: ExtractedValue,
): FieldResult {
  const { group, kind } = FIELD_DEFINITIONS[key];
  const base = {
    key,
    group,
    hwpValue: hwp.value,
    registryValue: registry.value,
  };

  if (hwp.value === null || registry.value === null) {
    const which =
      hwp.value === null && registry.value === null
        ? "두 문서 모두"
        : hwp.value === null
          ? "한글 서류"
          : "등기부등본";
    return { ...base, status: "unreadable", reason: `${which}에서 값을 읽지 못했습니다.` };
  }

  if (hwp.lowConfidence || registry.lowConfidence) {
    return {
      ...base,
      status: "needs_review",
      reason: "글자 읽기 확신이 낮아 직접 확인이 필요합니다.",
    };
  }

  const hwpComparable = toComparable(kind, hwp.value);
  const registryComparable = toComparable(kind, registry.value);

  if (hwpComparable === null || registryComparable === null) {
    return {
      ...base,
      status: "needs_review",
      reason: "값의 형식이 예상과 달라 자동으로 비교할 수 없습니다.",
    };
  }

  if (hwpComparable !== registryComparable) return { ...base, status: "mismatch" };

  // 호수 앞의 동: 두 문서 모두에 동이 있으면 같아야 일치 (2026-11-09).
  // 어느 한쪽에 동이 없으면 층·호만 같으면 일치 (2026-11-10 사용자 결정: 「동이 없어도 호수 같으면 일치」)
  if (kind === "unitNumber") {
    const hwpDong = splitUnitDong(normalizeUnitNumber(hwp.value)).dong;
    const regDong = splitUnitDong(normalizeUnitNumber(registry.value)).dong;
    if (hwpDong !== null && regDong !== null && hwpDong !== regDong) return { ...base, status: "mismatch", reason: "동이 다릅니다." };
  }

  return { ...base, status: "match" };
}
