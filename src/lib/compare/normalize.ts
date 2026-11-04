// Design Ref: DESIGN.md §4 단계 3 — 비교 전에 "표기만 다르고 뜻이 같은" 차이를 없앤다.
// PRD 규칙: 공백, 쉼표, 한자/한글 표기(金/금) 차이는 같은 값으로 본다.
// 사용자 결정(2026-11-04): 한자는 검사하지 않는다. 대응표에 없는 한자는 지우고 비교한다.
// 그 밖의 차이는 그대로 남긴다. 놓치는 것(틀린 값을 일치로 판정)이 가장 위험하기 때문이다.

/**
 * 한자 → 한글 대응표.
 * 지우기 전에 먼저 한글로 바꿔서 "金 = 금" 규칙을 지킨다. (예: "金철수"와 "금철수"는 같다)
 */
const HANJA_TO_HANGUL: Record<string, string> = {
  金: "금", // 금 120,000,000원
  圓: "원", // 금액 단위
  整: "정", // "원정"의 정
};

const HANJA_PATTERN = new RegExp(`[${Object.keys(HANJA_TO_HANGUL).join("")}]`, "gu");

/** 모든 한자 (한중일 통합 한자 전체) */
const ANY_HANJA_PATTERN = /\p{Script=Han}/gu;

/**
 * 모든 비교 종류에 공통으로 적용하는 정규화.
 * 1) NFKC: 전각 숫자·쉼표·괄호(１，（)와 ㎡ 같은 호환 문자를 일반 문자로 바꾼다.
 * 2) 공백(띄어쓰기, 줄바꿈, 전각 공백 포함)을 모두 없앤다.
 * 3) 쉼표를 없앤다.
 * 4) 대응표에 있는 한자를 한글로 바꾼다.
 * 5) 남은 한자를 모두 지운다. 한자를 지우고 남은 빈 괄호 "()"도 지운다.
 *    예: "홍길동(洪吉童)" → "홍길동"
 *    한자로만 적힌 값은 빈 값이 되어, 비교 단계에서 「확인 필요」로 간다.
 */
export function normalizeText(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/\s+/gu, "")
    .replace(/,/gu, "")
    .replace(HANJA_PATTERN, (ch) => HANJA_TO_HANGUL[ch] ?? ch)
    .replace(ANY_HANJA_PATTERN, "")
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
