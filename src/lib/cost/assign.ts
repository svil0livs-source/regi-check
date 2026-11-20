// 비용 검증: 한꺼번에 올린 파일들을 청구서(엑셀 또는 PDF)와 영수증 PDF로 나눈다 (2026-11-20 사용자 요청).
// 엑셀은 청구서, PDF가 하나 남으면 영수증. PDF 두 개는 파일 이름(청구·영수 등)으로만 나누고, 이름으로 안 정해지면 추측하지 않는다.
import { isExcelName } from "./excel";

const RECEIPT_NAME_RE = /영수|증빙|납부|수납|receipt/i;
const CLAIM_NAME_RE = /청구|비용|견적|내역|명세|정산|invoice|bill/i;

export type AssignResult<T> = { claim?: T; receipt?: T; error?: string; ignored: number };

export function assignCostFiles<T extends { name: string }>(files: T[]): AssignResult<T> {
  const excels = files.filter((f) => isExcelName(f.name));
  const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
  const ignored = files.length - excels.length - pdfs.length;
  if (excels.length === 0 && pdfs.length === 0) return { ignored, error: "엑셀(.xlsx, .xls)이나 PDF 파일이 없습니다." };
  if (excels.length > 1) return { ignored, error: "청구서 엑셀 파일이 여러 개입니다. 한 건씩(청구서 1개 + 영수증 PDF 1개) 올려 주세요." };
  const isReceipt = (f: T) => RECEIPT_NAME_RE.test(f.name);
  const isClaim = (f: T) => !isReceipt(f) && CLAIM_NAME_RE.test(f.name);

  if (excels.length === 1) {
    if (pdfs.length <= 1) return { ignored, claim: excels[0], receipt: pdfs[0] };
    const named = pdfs.filter(isReceipt);
    if (named.length === 1) return { ignored, claim: excels[0], receipt: named[0] };
    return { ignored, claim: excels[0], error: "영수증 PDF가 여러 개입니다. 영수증을 한 PDF로 모아 올리거나, 영수증 칸에 하나만 올려 주세요." };
  }
  if (pdfs.length === 1) return isClaim(pdfs[0]) ? { ignored, claim: pdfs[0] } : { ignored, receipt: pdfs[0] };
  if (pdfs.length > 2) return { ignored, error: "PDF가 세 개 이상입니다. 한 건씩(청구서 1개 + 영수증 PDF 1개) 올려 주세요." };
  const [a, b] = pdfs;
  const kind = (f: T) => (isReceipt(f) ? "receipt" : isClaim(f) ? "claim" : null);
  const ka = kind(a);
  const kb = kind(b);
  if ((ka === "claim" && kb !== "claim") || (kb === "receipt" && ka !== "receipt")) return { ignored, claim: a, receipt: b };
  if ((kb === "claim" && ka !== "claim") || (ka === "receipt" && kb !== "receipt")) return { ignored, claim: b, receipt: a };
  return { ignored, error: "PDF 두 개 중 어느 것이 청구서인지 파일 이름으로 알 수 없습니다. 청구서 칸과 영수증 칸에 하나씩 올려 주세요." };
}
