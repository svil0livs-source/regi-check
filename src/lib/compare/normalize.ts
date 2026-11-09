// Design Ref: DESIGN.md §4 단계 3 — 비교 전에 "표기만 다르고 뜻이 같은" 차이를 없앤다.
// PRD 규칙: 공백, 쉼표 차이는 같은 값으로 본다.
// 사용자 결정(2026-11-04): 한자는 인식·대조하지 않는다. 한자는 모두 지우고 한글·숫자만 비교한다.
// 그 밖의 차이는 그대로 남긴다. 놓치는 것(틀린 값을 일치로 판정)이 가장 위험하기 때문이다.

/** 모든 한자 (한중일 통합 한자 전체) */
const HANJA_PATTERN = /\p{Script=Han}/gu;

/**
 * 모든 비교 종류에 공통으로 적용하는 정규화.
 * 1) NFKC: 전각 숫자·쉼표·괄호(１，（)와 ㎡ 같은 호환 문자를 일반 문자로 바꾼다.
 * 2) 공백(띄어쓰기, 줄바꿈, 전각 공백 포함)을 모두 없앤다.
 * 3) 쉼표를 없앤다.
 * 4) 한자를 모두 지운다. 한자를 지우고 남은 빈 괄호 "()"도 지운다.
 *    예: "홍길동(洪吉童)" → "홍길동", "金120,000,000원" → "120000000원"
 *    한자로만 적힌 값은 빈 값이 되어, 비교 단계에서 「확인 필요」로 간다.
 */
export function normalizeText(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/\s+/gu, "")
    .replace(/,/gu, "")
    .replace(HANJA_PATTERN, "")
    .replace(/\(\)/gu, "");
}

/**
 * 금액을 숫자 문자열로 바꾼다. 예: "金 120,000,000원정" → "120000000"
 * 앞의 "금", 뒤의 "원"/"원정"만 떼어 내고, 나머지가 숫자만이 아니면 null(확신할 수 없음)을 돌려준다.
 * 예: "금일억이천만원"처럼 숫자를 한글로 쓴 경우는 자동 변환하지 않고 확인 필요로 보낸다.
 */
export function normalizeAmount(raw: string): string | null {
  const text = normalizeText(raw)
    .replace(/^금/u, "")
    .replace(/원정?$/u, "");
  if (!/^\d+$/u.test(text)) return null;
  // 앞자리 0은 값이 같으므로 없앤다 (단, "0" 하나는 남긴다).
  return text.replace(/^0+(?=\d)/u, "");
}

/**
 * 접수번호를 숫자 문자열로 바꾼다. 예: "제12345호" → "12345"
 * 앞의 "제", 뒤의 "호"만 떼어 내고, 나머지가 숫자(와 붙임표)만이 아니면 null을 돌려준다.
 */
export function normalizeReceiptNumber(raw: string): string | null {
  const text = normalizeText(raw)
    .replace(/^제/u, "")
    .replace(/호$/u, "");
  if (!/^\d+(-\d+)*$/u.test(text)) return null;
  return text;
}

/**
 * 주민·법인등록번호의 앞 6자리만 꺼낸다. 예: "750101-1******" → "750101", "110111-1087115" → "110111"
 * 뒷자리는 가려져 있을 수 있고 개인정보라 쓰지 않는다. 앞자리가 숫자 6개가 아니면 null(확신할 수 없음).
 */
export function normalizeIdFront(raw: string): string | null {
  const front = normalizeText(raw).split("-")[0];
  return /^\d{6}$/.test(front) ? front : null;
}

/**
 * 지번의 표기 차이를 없앤다 (2026-11-05 사용자 결정: 표기만 다른 값은 일치).
 * "123번지4" · "123번지의4" · "123의4" → "123-4", "123번지" → "123". 숫자·"산" 같은 뜻 있는 글자는 그대로 둔다.
 */
export function normalizeLotNumber(raw: string): string {
  return normalizeText(raw)
    .replace(/(\d)번지의?(?=\d)/gu, "$1-")
    .replace(/(\d)의(?=\d)/gu, "$1-")
    .replace(/(\d)번지$/u, "$1");
}

/** 건물 호수의 표기 차이를 없앤다. "제2층 제201호" → "2층201호" (숫자 앞 "제"만 뗀다) */
export function normalizeUnitNumber(raw: string): string {
  return normalizeText(raw).replace(/제(?=\d)/gu, "");
}

/**
 * 호수 앞에 붙은 동을 나눈다 (2026-11-09 사용자 결정: 한글 서류의 "제110동 제13층 제1301호"에서
 * 동은 등기부 「1동의 건물의 표시」의 건물 이름과, 층·호는 건물번호와 대조한다).
 * "110동13층1301호" → { dong: "110동", rest: "13층1301호" }. 동이 없으면 dong은 null.
 */
export function splitUnitDong(normalized: string): { dong: string | null; rest: string } {
  const m = /^(.+동)(?=(?:지하)?\d+층|\d+호$)/u.exec(normalized);
  return m ? { dong: m[1], rest: normalized.slice(m[1].length) } : { dong: null, rest: normalized };
}

/**
 * 면적의 표기 차이를 없앤다. 단위(㎡·m²·m2·제곱미터·평방미터)는 같은 것으로 보고,
 * 소수 끝의 0(59.820 = 59.82)도 같은 값으로 본다. 숫자+단위 모양이 아니면 정규화한 글자 그대로 비교한다.
 */
export function normalizeArea(raw: string): string {
  const text = normalizeText(raw) // NFKC가 ㎡·m²를 "m2"로 바꾼다
    .replace(/(제곱|평방)미터|m\^?2/giu, "m2");
  const m = /^(\d+)(?:\.(\d+))?(m2)?$/u.exec(text);
  if (!m) return text;
  const int = m[1].replace(/^0+(?=\d)/u, "");
  const frac = (m[2] ?? "").replace(/0+$/u, "");
  return frac ? `${int}.${frac}` : int;
}

/** 연·월·일 */
export interface DateParts {
  year: number;
  month: number;
  day: number;
}

/**
 * 날짜를 연·월·일로 나눈다.
 * 받는 형식: "2026년 11월 4일", "2026.11.04", "2026. 11. 4.", "2026-11-04", "2026/11/4"
 * 형식이 다르거나 있을 수 없는 날짜면 null(확신할 수 없음)을 돌려준다.
 */
export function parseDate(raw: string): DateParts | null {
  const text = normalizeText(raw);
  const match = /^(\d{4})[년.\-/](\d{1,2})[월.\-/](\d{1,2})(일|\.)?$/u.exec(text);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // 달력에 실제로 있는 날짜인지 확인한다 (예: 2월 30일은 거절).
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}
