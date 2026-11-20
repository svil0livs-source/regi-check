// 비용 청구 검증(법무사 비용 청구서 ↔ 영수증)의 데이터 모양. 근이전 검증(src/types/verification.ts)과 따로 둔다 (2026-11-20).
// 금액은 모두 원 단위 정수(number)로 다룬다.

/** 지출 항목 종류. fee(법무사 보수)는 영수증과 대조하지 않는다 */
export type CostCategory =
  | "registration_tax" // 등록면허세
  | "education_tax" // 지방교육세
  | "housing_bond" // 국민주택채권 (할인료·본인부담금)
  | "court_fee" // 등기신청수수료 (증지)
  | "stamp_tax" // 인지세 (수입인지)
  | "certificate" // 제증명 발급비 (등기사항증명서 등)
  | "postage" // 우편료·송달료
  | "fee" // 법무사 보수 (기본·누진 보수, 부가세, 교통비·일당)
  | "other"; // 알아보지 못한 항목

/** 읽은 금액 하나 */
export interface CostAmount {
  /** 원. 읽지 못했으면 null */
  value: number | null;
  /** 글자 읽기가 불확실하거나 표기가 이상함 → 확인 필요 */
  uncertain: boolean;
}

/** 청구서 줄 하나 (항목 + 금액) */
export interface ClaimItem {
  label: string;
  category: CostCategory;
  amount: CostAmount;
  /** 청구서 PDF 페이지 (1부터) */
  page: number;
}

export interface ClaimRead {
  items: ClaimItem[];
  /** 청구서에 적힌 합계(총 청구금액). 없으면 null */
  total: (CostAmount & { page: number }) | null;
}

/** 영수증 안의 금액 줄 하나 */
export interface ReceiptItem {
  label: string;
  category: CostCategory;
  amount: CostAmount;
}

/** 영수증 한 장 */
export interface Receipt {
  /** 화면에서 가리키는 이름 (예: "3쪽-1") */
  id: string;
  /** 영수증 PDF 페이지 (1부터) */
  page: number;
  /** 그 페이지 안에서 몇 번째 영수증인지 (1부터) */
  index: number;
  /** 영수증 제목 줄 (예: 지방세 납부확인서) */
  title: string;
  issuer: string | null;
  /** 발급번호·납부번호 등 영수증 번호 (중복 판단에만 쓰고 화면에 보이지 않는다) */
  ref: string | null;
  /** 납부일자 YYYY-MM-DD */
  date: string | null;
  items: ReceiptItem[];
  /** 영수증에 적힌 합계·납부금액 */
  total: CostAmount | null;
  /** 항목 합계와 적힌 합계가 다르거나 금액을 못 읽음 → 확인 필요 */
  uncertain: boolean;
  notes: string[];
}

/** 페이지 하나를 읽은 결과 */
export interface PageRead {
  page: number;
  /** text: 글자 PDF에서 바로 읽음, ocr: 스캔 사진을 글자 읽기 */
  source: "text" | "ocr";
  /** 읽기에 실패했으면 이유 (이 페이지가 있으면 「전부 일치」로 판정하지 않는다) */
  error?: string;
  /** 이 페이지에서 찾은 영수증(또는 청구 항목) 수. 영수증 페이지에서 0이면 「전부 일치」로 판정하지 않는다 */
  found?: number;
}

export type CostStatus = "match" | "mismatch" | "missing" | "needs_review";
export type CostSummary = "전부 일치" | "불일치 있음" | "확인 필요";

export const COST_STATUS_LABELS: Record<CostStatus, string> = {
  match: "일치",
  mismatch: "불일치",
  missing: "증빙 누락",
  needs_review: "확인 필요",
};

/** 대조 결과 한 줄 (지출 항목 종류 하나) */
export interface CostRow {
  category: CostCategory;
  /** 화면 이름: 청구서 항목 이름들 */
  label: string;
  claimed: number | null;
  evidenced: number | null;
  /** 청구 − 증빙 */
  diff: number | null;
  status: CostStatus;
  /** 대응한 영수증 id와 페이지 */
  receipts: { id: string; page: number }[];
  claimPages: number[];
  reasons: string[];
}

export interface CostResult {
  summary: CostSummary;
  rows: CostRow[];
  /** 법무사 보수 (영수증과 대조하지 않음) */
  feeItems: ClaimItem[];
  /** 청구서에 대응하는 항목이 없는 영수증 */
  extraReceipts: { id: string; page: number; label: string; amount: number | null; reason: string }[];
  /** 같은 영수증이 두 번 들어간 것으로 보이는 묶음 */
  duplicates: { ids: string[]; reason: string }[];
  totals: {
    /** 청구서 합계 줄 (없으면 항목 합) */
    claimedTotal: number | null;
    claimedTotalFromDoc: boolean;
    /** 법무사 보수를 뺀 실비 청구 합계 */
    claimedExpenses: number;
    /** 영수증 금액 합계 */
    evidencedTotal: number;
    /** 실비 청구 합계 − 증빙 합계 */
    diff: number;
  };
  counts: Record<CostStatus, number>;
  /** 읽지 못한 페이지 등 전체 판정에 영향을 주는 안내 */
  warnings: string[];
}
