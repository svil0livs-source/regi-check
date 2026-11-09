// Design Ref: DESIGN.md §4.1 — 검증에 쓰는 공통 용어와 데이터 모양
// 식별자는 영어, 화면에 보이는 문구는 아래 *_LABELS의 한국어를 그대로 쓴다.

/**
 * 대조 항목 그룹 (2026-11-06 사용자 결정: 실제 서류 「위임장 + 확정채권 및 근저당권 양도증서」에 있는 것만 대조)
 * 한글 서류에 없는 소유자·양수인·이전등기 접수번호·이전등기 날짜는 대조하지 않는다.
 */
export type FieldGroup =
  | "parties" // 당사자 (양도인 = 근저당권자, 채무자)
  | "property" // 부동산 표시
  | "maxClaimAmount" // 채권최고액 (이전할 근저당권 합계)
  | "mortgage"; // 이전할 근저당권 (건마다 접수일·접수번호·순위)

export type FieldKey =
  // 당사자
  | "mortgagee" // 근저당권자 = 한글 서류의 「채권 양도인」
  | "debtor" // 채무자
  // 부동산 표시
  | "location" // 소재지
  | "lotNumber" // 지번
  | "unitNumber" // 건물 호수
  | "area" // 면적
  // 채권최고액: 이전할 근저당권이 여러 건이면 합계 (2026-11-06 사용자 확인)
  | "maxClaimAmount"
  // 이전할 근저당권 (1~2건, 건마다 index)
  | "receiptNumber" // 접수번호
  | "registrationDate" // 접수일(등기날짜)
  | "rank" // 순위번호
  // 양도인 주민·법인등록번호 앞 6자리. 뒷자리는 읽지 않는다.
  | "mortgageeIdFront";

/** 값을 어떤 규칙으로 비교할지 정하는 종류 */
export type CompareKind =
  | "name" // 이름: 한 글자라도 다르면 불일치
  | "address" // 주소: 한 글자라도 다르면 불일치
  | "text" // 그 밖의 글자
  | "lotNumber" // 지번: "123-4" = "123번지4" = "123번지의4" (표기만 다르면 일치, 2026-11-05 사용자 결정)
  | "unitNumber" // 건물 호수: "제201호" = "201호"
  | "area" // 면적: "59.82㎡" = "59.82제곱미터" = "59.82m²" = "59.820㎡"
  | "amount" // 금액: 숫자 한 자리라도 다르면 불일치
  | "receiptNumber" // 접수번호·순위번호: 숫자 한 자리라도 다르면 불일치
  | "date" // 날짜: 연·월·일 중 하나라도 다르면 불일치
  | "idFront"; // 등록번호 앞 6자리: 한 자리라도 다르면 불일치

/** 세부 항목별 소속 그룹과 비교 종류 */
export const FIELD_DEFINITIONS: Record<FieldKey, { group: FieldGroup; kind: CompareKind }> = {
  mortgagee: { group: "parties", kind: "name" },
  debtor: { group: "parties", kind: "name" },
  location: { group: "property", kind: "address" },
  lotNumber: { group: "property", kind: "lotNumber" },
  unitNumber: { group: "property", kind: "unitNumber" },
  area: { group: "property", kind: "area" },
  maxClaimAmount: { group: "maxClaimAmount", kind: "amount" },
  receiptNumber: { group: "mortgage", kind: "receiptNumber" },
  registrationDate: { group: "mortgage", kind: "date" },
  rank: { group: "mortgage", kind: "receiptNumber" },
  mortgageeIdFront: { group: "parties", kind: "idFront" },
};

/** 모든 세부 항목 */
export const ALL_FIELD_KEYS = Object.keys(FIELD_DEFINITIONS) as FieldKey[];

/** 두 문서 모두에 값이 있을 때만 대조하는 항목 (등록번호 앞 6자리). 빠져도 「전부 일치」를 막지 않는다. */
export const OPTIONAL_FIELD_KEYS: FieldKey[] = ["mortgageeIdFront"];

/**
 * 문서에서 읽어 온 값 하나.
 * - value가 null이면 읽지 못한 것이다 (추측해서 채우지 않는다).
 * - lowConfidence가 true면 스캔 글자 읽기의 확신이 낮은 값이다.
 */
export interface ExtractedValue {
  value: string | null;
  lowConfidence?: boolean;
}

/** 항목 하나의 상태 */
export type FieldStatus = "match" | "mismatch" | "needs_review" | "unreadable";

/** 항목 하나의 대조 결과 (상세 화면에서 두 값을 나란히 보여 줄 때 쓴다) */
export interface FieldResult {
  key: FieldKey;
  group: FieldGroup;
  hwpValue: string | null; // 한글 서류 값 (null: 읽지 못함 또는 한글 서류에 없음 — reason 참고)
  registryValue: string | null; // 등기부등본 값 (정답, null의 뜻은 위와 같음)
  status: FieldStatus;
  reason?: string; // 확인 필요·읽지 못함·없음의 이유 (화면 안내용)
  index?: number; // 여러 명·여러 개일 때 몇 번째인지 (1부터). 화면에 "소유자 2"처럼 표시
}

// ── 여러 명·여러 개 (DESIGN.md §4.5, §4.7) ──────────────────────────

/** 당사자 역할 (세부 항목 키와 같은 이름) */
export type PartyRole = "mortgagee" | "debtor";

export const PARTY_ROLES: PartyRole[] = ["mortgagee", "debtor"];

/** 부동산 1개 = 4개 칸 묶음 */
export interface PropertyEntry {
  location: ExtractedValue; // 소재지
  lotNumber: ExtractedValue; // 지번
  unitNumber: ExtractedValue; // 건물 호수
  area: ExtractedValue; // 면적
}

/** 부동산 칸 4개 (세부 항목 키와 같은 이름) */
export type PropertyFieldKey = keyof PropertyEntry;

export const PROPERTY_FIELD_KEYS: PropertyFieldKey[] = [
  "location",
  "lotNumber",
  "unitNumber",
  "area",
];

/** 이전할 근저당권 1건 */
export interface MortgageEntry {
  receiptNumber: ExtractedValue; // 접수번호 (예: 제14475호)
  registrationDate: ExtractedValue; // 접수일 (예: 2020년03월13일)
  rank: ExtractedValue; // 순위번호 (예: 3)
}

/** 문서 하나에서 읽은 전체 값 (한글 서류용 1개, 등기부등본용 1개) */
export interface DocumentFields {
  parties: Record<PartyRole, ExtractedValue[]>; // 역할마다 여러 명
  properties: PropertyEntry[]; // 부동산 여러 개
  /** 이전할 근저당권 (보통 1건, 많아야 2건). 등기부 쪽은 접수번호로 찾은 같은 순서의 건 */
  mortgages: MortgageEntry[];
  maxClaimAmount: ExtractedValue; // 이전할 근저당권 채권최고액 합계
  mortgageeIdFront: ExtractedValue; // 양도인(근저당권자) 등록번호 앞 6자리 (뒷자리는 담지 않는다)
  /**
   * 서류 종류. 없으면 근저당권 이전 서류.
   * "nameChange": 「변경할 사항」(을구 N번 … 로 변경)이 있는 등기명의인표시변경 서류 (2026-11-09 사용자 결정: 대조할 수 있는 항목은 모두 대조).
   * 이 서류의 근저당권은 순위번호만, 양도인 칸은 신청인(= 등기부의 지금 근저당권자)이다. 접수번호·접수일·채권최고액·채무자는 서류에 없어 대조하지 않는다.
   */
  kind?: "nameChange";
}

/**
 * 건 하나의 한 줄 요약.
 * - 대조 결과 3종: all_match, mismatch_found, needs_review (summarizeCase가 정한다)
 * - 대조 전 상태 2종: file_problem(업로드 검사에서), processing_failed(서버 처리 오류)
 */
export type CaseSummary =
  | "all_match"
  | "mismatch_found"
  | "needs_review"
  | "file_problem"
  | "processing_failed";

/** 화면 문구: 항목 상태 */
export const FIELD_STATUS_LABELS: Record<FieldStatus, string> = {
  match: "일치",
  mismatch: "불일치",
  needs_review: "확인 필요",
  unreadable: "읽지 못함",
};

/** 화면 문구: 건 요약 */
export const CASE_SUMMARY_LABELS: Record<CaseSummary, string> = {
  all_match: "전부 일치",
  mismatch_found: "불일치 있음",
  needs_review: "확인 필요",
  file_problem: "파일 부족/초과",
  processing_failed: "처리 실패",
};

/** 화면 문구: 항목 그룹 */
export const FIELD_GROUP_LABELS: Record<FieldGroup, string> = {
  parties: "당사자",
  property: "부동산 표시",
  maxClaimAmount: "채권최고액",
  mortgage: "이전할 근저당권",
};

/** 화면 문구: 세부 항목 */
export const FIELD_KEY_LABELS: Record<FieldKey, string> = {
  mortgagee: "근저당권자(양도인)",
  debtor: "채무자",
  location: "소재지",
  lotNumber: "지번",
  unitNumber: "건물 호수",
  area: "면적",
  maxClaimAmount: "채권최고액(합계)",
  receiptNumber: "접수번호",
  registrationDate: "접수일",
  rank: "순위번호",
  mortgageeIdFront: "양도인 등록번호(앞 6자리)",
};
