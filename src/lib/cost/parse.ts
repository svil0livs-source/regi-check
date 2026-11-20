// 비용 청구 검증: 청구서·영수증 페이지의 줄(글자 PDF에서 바로 읽었거나 스캔을 글자 읽기 한 것)에서 항목·금액을 꺼내는 순수 함수.
// 읽은 원문은 여기서 값으로만 바꾸고 저장·로그에 남기지 않는다. 확신할 수 없는 금액은 uncertain으로 표시한다 (2026-11-20).
import type { ParseLine } from "@/lib/readers/registryParse";
import type { ClaimItem, ClaimRead, CostAmount, CostCategory, Receipt, ReceiptItem } from "./types";

/** 글자 확신도가 이보다 낮은 금액은 확인 필요 (근이전 검증과 같은 값) */
export const COST_CONF_MIN = 60;

const compact = (s: string) => s.replace(/[^가-힣A-Za-z0-9]/g, "");

// ── 지출 항목 종류 ─────────────────────────────────────────────
// 위에서부터 차례로 본다. 「등기신청수수료」가 법무사 「수수료」로, 「지방교육세」가 「등록면허세」로 잘못 묶이지 않게 순서를 지킨다.
const CATEGORY_RULES: [CostCategory, RegExp][] = [
  ["education_tax", /지방교육세|교육세/],
  ["registration_tax", /등록면허세|등록세|면허세|취득세/],
  ["housing_bond", /국민주택채권|주택채권|채권할인|채권매입|채권/],
  ["court_fee", /등기신청수수료|신청수수료|수입증지|등기수수료|증지|등기신청/],
  ["stamp_tax", /인지세|수입인지|전자수입인지|인지대|인지/],
  ["certificate", /제증명|증명서|등본|초본|열람|발급수수료|발급비|발급/],
  ["postage", /우편|송달|택배|퀵/],
  ["fee", /보수|부가가치세|부가세|교통비|여비|일당|출장|대행|수수료|제출대행|원인증서|작성료/],
];

export const CATEGORY_LABELS: Record<CostCategory, string> = {
  registration_tax: "등록면허세",
  education_tax: "지방교육세",
  housing_bond: "국민주택채권",
  court_fee: "등기신청수수료",
  stamp_tax: "인지세",
  certificate: "제증명 발급비",
  postage: "우편·송달료",
  fee: "법무사 보수",
  other: "기타",
};

export function categoryOf(label: string): CostCategory {
  const t = compact(label);
  // 「등록면허세 및 지방교육세」처럼 한 줄에 함께 청구하면 등록면허세로 묶는다 (대조할 때 지방교육세 영수증도 함께 더함)
  if (/등록|면허세/.test(t) && /교육세/.test(t)) return "registration_tax";
  for (const [cat, re] of CATEGORY_RULES) if (re.test(t)) return cat;
  return "other";
}

// ── 금액 ─────────────────────────────────────────────────────
/** 날짜·시각·번호처럼 금액이 아닌 숫자를 지운다 (지운 자리는 띄어쓰기로) */
function stripNonAmounts(text: string): string {
  return text
    .replace(/(19|20)\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*[.일]?/g, " ")
    .replace(/\d{1,2}\s*:\s*\d{2}(\s*:\s*\d{2})?/g, " ")
    .replace(/번호\s*[:：]?\s*[\d\-\s]+/g, "번호 ")
    .replace(/\d+(\s*-\s*\d+)+/g, " ");
}

export interface AmountToken {
  value: number;
  /** 줄 안에서 금액 글자(쉼표 포함) */
  raw: string;
  start: number;
  end: number;
  /** 쉼표 자리가 이상하거나(마침표 등) 해서 표기만으로는 확신할 수 없음 */
  badFormat: boolean;
}

/**
 * 줄 안의 금액 글자를 모두 찾는다. 「150,000원」「₩150,000」「150, 000 원」「금150000원」을 숫자 150000으로 읽는다.
 * 쉼표 없이 「원」도 없는 숫자는 1,000 이상일 때만 금액으로 본다(수량·쪽수와 구분). 10자리 넘는 숫자(계좌 등)는 금액이 아니다.
 */
export function amountTokens(text: string): AmountToken[] {
  const cleaned = stripNonAmounts(text).replace(/(\d)\s*,\s*(?=\d{3}(?!\d))/g, "$1,");
  const out: AmountToken[] = [];
  const re = /(?<![\d,.])(\d{1,3}(?:,\d{3})+|\d{1,3}(?:\.\d{3})+|\d+)(?![\d,.]*\d)(\s*원)?(\s*(?:년|월|일|호|번|건|통|매|장|부|%|층|쪽|면|개|필지|명|회|㎡|m))?/g;
  for (let m = re.exec(cleaned); m; m = re.exec(cleaned)) {
    const [, digits, won, unit] = m;
    if (unit) continue;
    const comma = digits.includes(",");
    const dotted = /^\d{1,3}(\.\d{3})+$/.test(digits);
    const plain = digits.replace(/[,.]/g, "");
    if (plain.length > 10 || /^0\d/.test(plain)) continue;
    const value = Number(plain);
    if (!comma && !dotted && !won && value < 1000) continue;
    if (value < 10) continue;
    out.push({ value, raw: digits, start: m.index, end: m.index + digits.length, badFormat: dotted });
  }
  return out;
}

/** 금액 글자의 확신도 (낱말 확신도 중 그 숫자가 든 낱말의 최솟값) */
function tokenConfidence(line: ParseLine, raw: string): number {
  const digits = raw.replace(/[^\d]/g, "");
  let joined = "";
  const conf: number[] = [];
  for (const w of line.words) {
    for (const ch of w.text.replace(/[^\d]/g, "")) {
      joined += ch;
      conf.push(w.confidence);
    }
  }
  const at = joined.indexOf(digits);
  if (at < 0) return 0;
  return Math.min(...conf.slice(at, at + digits.length));
}

function toAmount(line: ParseLine, t: AmountToken, confMin: number): CostAmount {
  return { value: t.value, uncertain: t.badFormat || tokenConfidence(line, t.raw) < confMin };
}

/** 금액 앞 글자에서 항목 이름만 남긴다 */
function labelOf(s: string): string {
  return s
    .replace(/[^가-힣A-Za-z()\s]/g, " ")
    .replace(/\b(금|원)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-30)
    .trim();
}

const TOTAL_RE = /^(총청구금액|청구금액합계|청구합계|청구금액|총계|총액|합계금액|합계|금액합계|총금액|합|계)/;
const SUBTOTAL_RE = /소계|중계/;
/** 금액처럼 보여도 항목 금액이 아닌 줄 */
const SKIP_LINE_RE = /계좌|예금주|전화|TEL|FAX|팩스|사업자|주소|입금|송금|잔액|잔금|단가|수량/i;

// ── 청구서 ─────────────────────────────────────────────────────
/**
 * 청구서 한 페이지의 줄들 → 항목·금액. 한 줄에 「항목 금액  항목 금액」처럼 두 칸이 나란히 있어도 따로 읽는다.
 * 「합계·총액·청구금액」 줄은 총 청구금액, 「소계」 줄은 버린다.
 */
export function parseClaimLines(lines: ParseLine[], page: number, confMin = COST_CONF_MIN): ClaimRead {
  const items: ClaimItem[] = [];
  const totals: (CostAmount & { page: number })[] = [];
  for (const line of lines) {
    if (SKIP_LINE_RE.test(line.text)) continue;
    const tokens = amountTokens(line.text);
    if (tokens.length === 0) continue;
    const cleaned = stripNonAmounts(line.text).replace(/(\d)\s*,\s*(?=\d{3}(?!\d))/g, "$1,");
    let from = 0;
    /** 이 줄에서 바로 앞에 읽은 금액 칸 (이름 없는 금액이 이어지면 오른쪽 칸 금액으로 바꾼다) */
    let setLast: ((a: CostAmount) => void) | null = null;
    for (const t of tokens) {
      const label = labelOf(cleaned.slice(from, t.start));
      from = t.end;
      const key = compact(label);
      const amount = toAmount(line, t, confMin);
      if (!key) {
        // 「항목  1  15,000  15,000」처럼 이름 없이 이어진 금액: 표의 맨 오른쪽 칸(금액)을 쓴다
        setLast?.(amount);
        continue;
      }
      setLast = null;
      if (SUBTOTAL_RE.test(key)) continue;
      if (TOTAL_RE.test(key) || /^총/.test(key)) {
        const at = totals.push({ ...amount, page }) - 1;
        setLast = (a) => (totals[at] = { ...a, page });
        continue;
      }
      if (!/[가-힣]{2,}/.test(key)) continue;
      const item: ClaimItem = { label, category: categoryOf(label), amount, page };
      items.push(item);
      setLast = (a) => (item.amount = a);
    }
  }
  // 합계 줄이 여러 개(보수 합계·공과금 합계·총 합계)면 가장 큰 값이 총 청구금액
  const total = totals.length ? totals.reduce((a, b) => ((b.value ?? 0) > (a.value ?? 0) ? b : a)) : null;
  return { items, total };
}

/** 여러 페이지 청구서 읽기를 합친다 */
export function mergeClaimPages(reads: ClaimRead[]): ClaimRead {
  const items = reads.flatMap((r) => r.items);
  const totals = reads.map((r) => r.total).filter((t): t is NonNullable<ClaimRead["total"]> => t !== null);
  const total = totals.length ? totals.reduce((a, b) => ((b.value ?? 0) > (a.value ?? 0) ? b : a)) : null;
  return { items, total };
}

// ── 영수증 ─────────────────────────────────────────────────────
const RECEIPT_TITLE_RE = /영수증|영수필|납부확인서|납부확인|납입확인|납부서|수납확인|계산서|영수확인|확인서|RECEIPT/i;
const RECEIPT_TOTAL_RE = /합계|총액|총계|납부금액|납부액|납부할금액|납부한금액|수납금액|영수금액|결제금액|받은금액|청구금액|금액합계|총납부/;
/** 국민주택채권 영수증의 매입(액면) 금액. 실제 부담은 할인료라 대조에 쓰지 않는다 */
const BOND_FACE_RE = /매입금액|채권금액|매입액|액면/;
const ISSUER_RE =
  /(\S*(?:구청|시청|군청|구청장|시장|군수|지방법원|등기소|등기국|대법원|법원행정처|은행|세무서|우체국|주민센터|행정복지센터|위택스|이택스|인터넷등기소|조달청|농협|신협|새마을금고)(?:\s*\S*(?:등기소|등기국|지점|출장소|지원))?)/;
/** 영수증 번호 (같은 날 같은 금액 영수증이 여러 장일 때 중복과 구분) */
const REF_RE = /(발급번호|전자납부번호|납부번호|승인번호|영수증번호|일련번호|관리번호|수납번호|고지번호|문서확인번호|확인번호)\s*[:：]?\s*([0-9A-Za-z][0-9A-Za-z\- ]{3,30}[0-9A-Za-z])/;
const DATE_RE = /((?:19|20)\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/;

function dateOf(text: string): string | null {
  const m = DATE_RE.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 한 페이지 줄들을 영수증 단위로 나눈다: 금액을 이미 하나 이상 본 뒤에 제목 줄(영수증·영수필·납부확인서 …)이 또 나오면 새 영수증 */
export function splitReceipts(lines: ParseLine[]): ParseLine[][] {
  const groups: ParseLine[][] = [];
  let cur: ParseLine[] = [];
  let seenAmount = false;
  for (const line of lines) {
    if (RECEIPT_TITLE_RE.test(compact(line.text)) && seenAmount && cur.length) {
      groups.push(cur);
      cur = [];
      seenAmount = false;
    }
    cur.push(line);
    if (amountTokens(line.text).length) seenAmount = true;
  }
  if (cur.length) groups.push(cur);
  // 금액이 하나도 없는 조각(머리말·꼬리말)은 앞뒤 영수증에 붙인다
  const merged: ParseLine[][] = [];
  for (const g of groups) {
    const has = g.some((l) => amountTokens(l.text).length);
    if (!has && merged.length) merged[merged.length - 1].push(...g);
    else merged.push(g);
  }
  return merged;
}

/** 영수증 한 장의 줄들 → 영수증 값 */
export function parseReceipt(lines: ParseLine[], page: number, index: number, confMin = COST_CONF_MIN): Receipt {
  const notes: string[] = [];
  const titleLine = lines.find((l) => RECEIPT_TITLE_RE.test(compact(l.text)));
  const title = titleLine ? labelOf(titleLine.text).slice(0, 40) : "";
  const whole = lines.map((l) => l.text).join(" ");

  let issuer: string | null = null;
  const issuerLine = lines.find((l) => /수납기관|발급기관|발행기관|수납처|기관명/.test(compact(l.text)) && ISSUER_RE.test(l.text)) ?? lines.find((l) => ISSUER_RE.test(l.text));
  if (issuerLine) issuer = ISSUER_RE.exec(issuerLine.text)?.[1].trim().slice(0, 40) ?? null;

  const refMatch = REF_RE.exec(whole);
  const ref = refMatch ? refMatch[2].replace(/\s/g, "") : null;

  const dateLine = lines.find((l) => /납부일|수납일|납부일자|발급일|거래일|영수일|일시|납입일/.test(compact(l.text)) && dateOf(l.text)) ?? lines.find((l) => dateOf(l.text));
  const date = dateLine ? dateOf(dateLine.text) : null;

  const items: ReceiptItem[] = [];
  const totals: CostAmount[] = [];
  const loose: { label: string; amount: CostAmount }[] = [];
  for (const line of lines) {
    if (SKIP_LINE_RE.test(line.text)) continue;
    const tokens = amountTokens(line.text);
    if (!tokens.length) continue;
    const cleaned = stripNonAmounts(line.text).replace(/(\d)\s*,\s*(?=\d{3}(?!\d))/g, "$1,");
    let from = 0;
    let setLast: ((a: CostAmount) => void) | null = null;
    for (const t of tokens) {
      const label = labelOf(cleaned.slice(from, t.start));
      from = t.end;
      const key = compact(label);
      const amount = toAmount(line, t, confMin);
      if (!key && setLast) {
        // 이름 없이 이어진 금액은 표의 맨 오른쪽 칸(금액)
        setLast(amount);
        continue;
      }
      setLast = null;
      if (BOND_FACE_RE.test(key)) continue;
      if (RECEIPT_TOTAL_RE.test(key)) {
        const at = totals.push(amount) - 1;
        setLast = (a) => (totals[at] = a);
        continue;
      }
      const cat = key ? categoryOf(label) : "other";
      const entry = { label, category: cat, amount };
      if (cat !== "other") items.push(entry);
      else loose.push(entry);
      setLast = (a) => (entry.amount = a);
    }
  }

  // 합계가 여러 번 나오면(같은 영수증의 보관용 칸 등) 가장 큰 값
  const total = totals.length ? totals.reduce((a, b) => ((b.value ?? 0) > (a.value ?? 0) ? b : a)) : null;
  let uncertain = false;

  if (items.length === 0) {
    // 항목 줄이 없으면 영수증 제목·본문의 항목 종류 + 합계(없으면 「금액」 줄) 하나로 본다
    const cat = categoryOf(title) !== "other" ? categoryOf(title) : categoryOf(whole);
    const amount = total ?? loose.find((l) => /금액|금|수수료|납부/.test(compact(l.label)))?.amount ?? (loose.length === 1 ? loose[0].amount : null);
    if (amount) items.push({ label: title || CATEGORY_LABELS[cat], category: cat, amount });
    else {
      uncertain = true;
      notes.push("영수증 금액을 찾지 못함");
    }
    if (cat === "other") notes.push("영수증 항목을 알아보지 못함");
  } else if (total?.value != null) {
    const sum = items.reduce((s, i) => s + (i.amount.value ?? 0), 0);
    if (sum !== total.value) {
      // 같은 금액이 보관용 칸마다 되풀이된 경우: 같은 (종류, 금액)은 한 번만 센다
      const uniq = new Map(items.map((i) => [`${i.category}|${i.amount.value}`, i]));
      const uniqSum = [...uniq.values()].reduce((s, i) => s + (i.amount.value ?? 0), 0);
      if (uniqSum === total.value) items.splice(0, items.length, ...uniq.values());
      else {
        uncertain = true;
        notes.push(`항목 금액 합(${sum.toLocaleString("ko-KR")}원)과 영수증 합계(${total.value.toLocaleString("ko-KR")}원)가 다름`);
      }
    }
  }
  if (items.some((i) => i.amount.uncertain) || total?.uncertain) uncertain = true;

  return { id: `${page}쪽-${index}`, page, index, title, issuer, ref, date, items, total, uncertain, notes };
}

/** 영수증 PDF 한 페이지 → 영수증들 */
export function parseReceiptPage(lines: ParseLine[], page: number, confMin = COST_CONF_MIN): Receipt[] {
  return splitReceipts(lines)
    .map((g, i) => parseReceipt(g, page, i + 1, confMin))
    .filter((r) => r.items.length > 0 || r.title !== "");
}
