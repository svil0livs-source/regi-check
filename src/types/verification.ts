// Design Ref: DESIGN.md §4.1 — 검증에 쓰는 공통 용어와 데이터 모양
// 식별자는 영어, 화면에 보이는 문구는 아래 *_LABELS의 한국어를 그대로 쓴다.

/** 대조 항목 그룹 5개 (PRD must 2) */
export type FieldGroup =
  | "parties" // 당사자
  | "property" // 부동산 표시
  | "maxClaimAmount" // 채권최고액
  | "receiptNumber" // 접수번호
  | "registrationDate"; // 등기날짜

/** 세부 항목. 당사자 4개, 부동산 표시 4개, 나머지는 그룹과 같은 1개씩 */
export type FieldKey =
  // 당사자
  | "mortgagee" // 근저당권자
  | "assignee" // 양수인
  | "debtor" // 채무자
  | "owner" // 소유자
  // 부동산 표시
  | "location" // 소재지
  | "lotNumber" // 지번
  | "unitNumber" // 건물 호수
  | "area" // 면적
  // 단일 항목
  | "maxClaimAmount"
  | "receiptNumber" // 원 접수번호: 원래 근저당권(주등기)의 접수번호
  | "transferReceiptNumber" // 이전 접수번호: 근저당권이전(부기등기)의 접수번호
  | "registrationDate" // 원 등기날짜: 원래 근저당권(주등기)의 날짜
  | "transferRegistrationDate" // 이전 등기날짜: 근저당권이전(부기등기)의 날짜
  // 등록번호 앞 6자리 (2026-11-05 사용자 요청). 뒷자리는 가려져 있을 수 있고 개인정보라 읽지 않는다.
  | "mortgageeIdFront" // 근저당권자(양도인)의 주민·법인등록번호 앞 6자리
  | "assigneeIdFront"; // 양수인의 주민·법인등록번호 앞 6자리

/** 값을 어떤 규칙으로 비교할지 정하는 종류 */
export type CompareKind =
  | "name" // 이름: 한 글자라도 다르면 불일치
  | "address" // 주소: 한 글자라도 다르면 불일치
  | "text" // 그 밖의 글자 (지번, 호수, 면적)
  | "amount" // 금액: 숫자 한 자리라도 다르면 불일치
  | "receiptNumber" // 접수번호: 숫자 한 자리라도 다르면 불일치
  | "date" // 날짜: 연·월·일 중 하나라도 다르면 불일치
  | "idFront"; // 등록번호 앞 6자리: 한 자리라도 다르면 불일치

/** 세부 항목별 소속 그룹과 비교 종류 */
export const FIELD_DEFINITIONS: Record<
  FieldKey,
  { group: FieldGroup; kind: CompareKind }
> = {
  mortgagee: { group: "parties", kind: "name" },
  assignee: { group: "parties", kind: "name" },
  debtor: { group: "parties", kind: "name" },
  owner: { group: "parties", kind: "name" },
  location: { group: "property", kind: "address" },
  lotNumber: { group: "property", kind: "text" },
  unitNumber: { group: "property", kind: "text" },
  area: { group: "property", kind: "text" },
  maxClaimAmount: { group: "maxClaimAmount", kind: "amount" },
  receiptNumber: { group: "receiptNumber", kind: "receiptNumber" },
  transferReceiptNumber: { group: "receiptNumber", kind: "receiptNumber" },
  registrationDate: { group: "registrationDate", kind: "date" },
  transferRegistrationDate: { group: "registrationDate", kind: "date" },
  mortgageeIdFront: { group: "parties", kind: "idFront" },
  assigneeIdFront: { group: "parties", kind: "idFront" },
};

/** 모든 세부 항목 (한 건마다 이 15개를 빠짐없이 대조한다) */
export const ALL_FIELD_KEYS = Object.keys(FIELD_DEFINITIONS) as FieldKey[];

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

/** 당사자 역할 4개 (세부 항목 키와 같은 이름) */
export type PartyRole = "mortgagee" | "assignee" | "debtor" | "owner";

export const PARTY_ROLES: PartyRole[] = ["mortgagee", "assignee", "debtor", "owner"];

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

/** 문서 하나에서 읽은 전체 값 (한글 서류용 1개, 등기부등본용 1개) */
export interface DocumentFields {
  parties: Record<PartyRole, ExtractedValue[]>; // 역할마다 여러 명
  properties: PropertyEntry[]; // 부동산 여러 개
  maxClaimAmount: ExtractedValue;
  receiptNumber: ExtractedValue; // 원 접수번호 (주등기)
  transferReceiptNumber: ExtractedValue; // 이전 접수번호 (부기등기)
  registrationDate: ExtractedValue; // 원 등기날짜 (주등기)
  transferRegistrationDate: ExtractedValue; // 이전 등기날짜 (부기등기)
  mortgageeIdFront: ExtractedValue; // 근저당권자 등록번호 앞 6자리 (뒷자리는 담지 않는다)
  assigneeIdFront: ExtractedValue; // 양수인 등록번호 앞 6자리 (뒷자리는 담지 않는다)
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
  receiptNumber: "접수번호",
  registrationDate: "등기날짜",
};

/** 화면 문구: 세부 항목 */
export const FIELD_KEY_LABELS: Record<FieldKey, string> = {
  mortgagee: "근저당권자",
  assignee: "양수인",
  debtor: "채무자",
  owner: "소유자",
  location: "소재지",
  lotNumber: "지번",
  unitNumber: "건물 호수",
  area: "면적",
  maxClaimAmount: "채권최고액",
  receiptNumber: "원 접수번호",
  transferReceiptNumber: "이전 접수번호",
  registrationDate: "원 등기날짜",
  transferRegistrationDate: "이전 등기날짜",
  mortgageeIdFront: "근저당권자 등록번호(앞 6자리)",
  assigneeIdFront: "양수인 등록번호(앞 6자리)",
};
