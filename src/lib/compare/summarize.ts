// Design Ref: DESIGN.md §4 단계 5 — 항목 결과들로 건 하나의 한 줄 요약을 정한다.
// PRD 규칙: 불일치와 확인 필요가 같이 있으면 「불일치 있음」. 확신할 수 없으면 「일치」가 아니다.

import {
  ALL_FIELD_KEYS,
  OPTIONAL_FIELD_KEYS,
  type CaseSummary,
  type FieldResult,
} from "@/types/verification";

/**
 * 건 요약 판정.
 * 1) 불일치가 하나라도 있으면 → 「불일치 있음」
 * 2) 확인 필요·읽지 못함이 하나라도 있으면 → 「확인 필요」
 * 3) 세부 항목이 빠짐없이 모두 일치할 때만 → 「전부 일치」
 * 빠진 항목이 있으면(대조하지 않은 항목) 전부 일치라고 할 수 없으므로 「확인 필요」로 본다.
 * 단, 등록번호 앞 6자리 2개는 두 문서 모두에 번호가 있을 때만 대조하므로 빠져도 된다 (PRD §5 must2).
 * (「파일 부족/초과」는 대조 전에 업로드 검사에서 정한다.)
 */
export function summarizeCase(results: FieldResult[]): CaseSummary {
  if (results.some((r) => r.status === "mismatch")) return "mismatch_found";

  if (results.some((r) => r.status === "needs_review" || r.status === "unreadable")) {
    return "needs_review";
  }

  const checked = new Set(results.map((r) => r.key));
  const allChecked = ALL_FIELD_KEYS.every((key) => OPTIONAL_FIELD_KEYS.includes(key) || checked.has(key));
  if (!allChecked) return "needs_review";

  return "all_match";
}
