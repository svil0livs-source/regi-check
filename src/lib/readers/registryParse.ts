// Design Ref: DESIGN.md §4.2, §4.4 — Tesseract가 읽은 줄들에서 집합건물 등기사항증명서의 표 내용을 뽑는다.
// 양식: 사용자가 준 「등기사항증명서(말소사항 포함) 집합건물」 샘플 (2026-11-05).
// 외부 서비스를 부르지 않는 순수 함수다. 글자 읽기 오류에 대비해:
//   - 구역은 긴 문구로 찾고(제목 글자가 틀려도 찾게), 줄 묶음은 등기목적 글자(근저당권설정 등)로 나눈다.
//   - 값마다 글자 확신도의 최솟값을 구해, 낮으면 uncertain(→ 「확인 필요」)으로 둔다.
//   - 형식이 맞지 않는 값(예: "제1502초")은 고치지 않고 uncertain으로 둔다.
// 주소·지분·거래가액은 뽑지 않는다. 근저당권자·양수인의 등록번호는 앞 6자리만 뽑는다(뒷자리는 버림, 2026-11-05).

import type { OcrValue, RegistryMortgage, RegistryRead, RegistryTransfer } from "./registryOcr";

export interface ParseLine {
  text: string;
  words: { text: string; confidence: number }[];
}

/** 확신도가 이보다 낮은 글자가 섞인 값은 불확실로 둔다 (0~100) */
export const DEFAULT_CONF_MIN = 60;

const compact = (s: string) => s.replace(/\s+/g, "");
/** 구역 찾기용: 글자만 남긴다 */
const letters = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "");

/** needle과 같은 길이의 부분 문자열 중 다른 글자가 maxDiff개 이하인 것이 있는지 (제목 글자 오독 대비) */
export function fuzzyIncludes(hay: string, needle: string, maxDiff = 1): boolean {
  if (hay.includes(needle)) return true;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let diff = 0;
    for (let j = 0; j < needle.length && diff <= maxDiff; j++) if (hay[i + j] !== needle[j]) diff++;
    if (diff <= maxDiff) return true;
  }
  return false;
}

/** 줄 안에서 value가 차지하는 글자들의 확신도 최솟값 (찾지 못하면 0) */
export function valueConfidence(line: ParseLine, value: string): number {
  const chars: number[] = [];
  let joined = "";
  for (const w of line.words) {
    for (const ch of compact(w.text)) {
      joined += ch;
      chars.push(w.confidence);
    }
  }
  const target = compact(value);
  const at = joined.indexOf(target);
  if (!target || at === -1) return 0;
  return Math.min(...chars.slice(at, at + target.length));
}

type Section = "none" | "building" | "land" | "unit" | "landRight" | "gap" | "eul";

function sectionOf(line: ParseLine): Section | null {
  const t = letters(line.text);
  if (fuzzyIncludes(t, "1동의건물의표시")) return "building";
  if (fuzzyIncludes(t, "대지권의목적인토지")) return "land";
  if (fuzzyIncludes(t, "전유부분의건물의표시")) return "unit";
  if (fuzzyIncludes(t, "대지권의표시")) return "landRight";
  if (fuzzyIncludes(t, "소유권이외의권리")) return "eul";
  if (fuzzyIncludes(t, "소유권에관한사항")) return "gap";
  return null;
}

const DATE_RE = /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/;
const RECEIPT_RE = /제\s*([\d/ ]{3,})\s*호/;
// 주민·법인등록번호 (읽기 오류로 숫자가 '/'가 되기도 한다). 이 번호부터 줄 끝까지는 이름이 아니다.
const ID_RE = /[\d/]{6}\s*-\s*[\d*/]{5,}/;
const ADDRESS_LOT_RE = /(\S*(?:특별시|광역시|특별자치시|특별자치도|도)\s+(?:\S+\s+){0,3}?\S+[동리가])\s+(\d+(?:-\d+)?)(?=\s|$)/;
const UNIT_RE = /(제\s*\d+\s*층\s*제\s*\d+\s*)(\S)/;
// 칸 제목: 글자 하나가 잘못 읽혀도 찾는다 (예: 근저탕권자, 재무자)
const HOLDER_KW = /근\s*저\s*[가-힣]\s*권\s*자\s*/;
const DEBTOR_KW = /[채재처]\s*무\s*자\s*/;

const v = (text: string | null, uncertain: boolean): OcrValue => ({ text, uncertain });

/** 줄에서 값을 뽑고 확신도로 불확실 여부를 정한다 */
function valueFrom(line: ParseLine | undefined, raw: string | undefined, confMin: number, extraUncertain = false): OcrValue {
  if (!line || raw === undefined) return v(null, false);
  const clean = raw.trim();
  return v(clean, extraUncertain || valueConfidence(line, clean) < confMin);
}

/**
 * 이름 정리: 앞의 숫자·기호(예: "0이시험"), 뒤에 떨어져 붙은 자모·기호(예: "장견본 ㆍ")를 뗀다.
 * 이름 글자 자체는 고치지 않는다.
 */
const tidyName = (s: string) =>
  s
    .replace(/^[^\p{L}(]+/u, "")
    .replace(/(\s+[ㄱ-ㆎ])+\s*$/u, "")
    .replace(/[^\p{L}\p{N})]+$/u, "")
    .trim();

/** "근저당권자 주식회사 가나다은행 110111-…" → "주식회사 가나다은행" */
function nameAfter(lineText: string, keyword: RegExp): string | undefined {
  const m = keyword.exec(lineText);
  if (!m) return undefined;
  let rest = lineText.slice(m.index + m[0].length);
  const id = ID_RE.exec(rest);
  if (id) rest = rest.slice(0, id.index);
  const name = tidyName(rest.replace(/\s{2,}.*$/, ""));
  return name || undefined;
}

/**
 * "근저당권자 주식회사 가나다은행 110111-1087115" → 등록번호 앞 6자리 "110111".
 * 뒷자리는 돌려주지 않는다. 앞자리에 숫자가 아닌 글자(예: '/')가 섞이면 고치지 않고 불확실.
 */
function idFrontAfter(line: ParseLine, keyword: RegExp, confMin: number): OcrValue {
  const k = keyword.exec(line.text);
  if (!k) return v(null, false);
  const id = ID_RE.exec(line.text.slice(k.index + k[0].length));
  if (!id) return v(null, false);
  const front = id[0].split("-")[0].replace(/\s+/g, "").slice(0, 6);
  return v(front, !/^\d{6}$/.test(front) || valueConfidence(line, front) < confMin);
}

/** 칸 사이 넓은 띄어쓰기로 나눈 마지막 덩어리 (오른쪽 「권리자 및 기타사항」 칸) */
const lastCell = (s: string) => s.split(/\s{2,}/).filter((x) => x.trim()).pop() ?? "";

/** 줄 묶음 나누기: start(line)가 참인 줄에서 새 묶음 시작 */
function blocks(lines: ParseLine[], start: (l: ParseLine) => boolean): ParseLine[][] {
  const out: ParseLine[][] = [];
  for (const l of lines) {
    if (start(l)) out.push([l]);
    else if (out.length) out[out.length - 1].push(l);
  }
  return out;
}

/** 묶음에서 처음 나오는 패턴 값과 그 줄 */
function firstMatch(block: ParseLine[], re: RegExp): { line: ParseLine; m: RegExpExecArray } | undefined {
  for (const line of block) {
    const m = re.exec(line.text);
    if (m) return { line, m };
  }
  return undefined;
}

function receiptValue(block: ParseLine[], confMin: number): OcrValue {
  const hit = firstMatch(block, RECEIPT_RE);
  if (!hit) return v(null, false);
  const digits = hit.m[1].replace(/\s+/g, "");
  // 숫자가 아닌 글자가 섞이면(예: '/') 고치지 않고 불확실
  return valueFrom(hit.line, hit.m[0], confMin, !/^\d+$/.test(digits));
}

function dateValue(block: ParseLine[], confMin: number): OcrValue {
  const hit = firstMatch(block, DATE_RE);
  return hit ? valueFrom(hit.line, hit.m[0], confMin) : v(null, false);
}

/** 갑구: 맨 마지막 소유권 등기 줄 묶음의 소유자·공유자 이름 */
function parseOwners(lines: ParseLine[], confMin: number): OcrValue[] {
  const rows = blocks(lines, (l) => fuzzyIncludes(letters(l.text), "소유권이전") || fuzzyIncludes(letters(l.text), "소유권보존"));
  const last = rows[rows.length - 1];
  if (!last) return [];
  const owners: OcrValue[] = [];
  for (const line of last) {
    const id = ID_RE.exec(line.text);
    if (!id) continue;
    // 번호 바로 앞 칸의 글자가 이름. "소유자 홍길동" / "홍길동" 모두 처리
    const before = lastCell(line.text.slice(0, id.index));
    const name = tidyName(before.replace(/^(소유자|공유자)\s*/, ""));
    if (name && !/지분/.test(name)) owners.push(valueFrom(line, name, confMin));
  }
  return owners;
}

/** 금액: "금 174,000.000원"처럼 쉼표를 점으로 읽은 경우는 쉼표로 본다 (원 단위 금액에 소수점은 없다) */
function amountValue(block: ParseLine[], confMin: number): OcrValue {
  const hit = firstMatch(block, /[채재]\s*권\s*최\s*고\s*액\s*(금\s*[\d,.\s]+원)/);
  if (!hit) return v(null, false);
  const raw = hit.m[1];
  const fixed = raw.replace(/(\d)\.(\d{3})(?!\d)/g, "$1,$2").replace(/\s+/g, " ");
  const base = valueFrom(hit.line, raw, confMin);
  return { text: fixed.replace(/금\s*/, "금 ").replace(/\s+원$/, "원"), uncertain: base.uncertain || fixed !== raw.replace(/\s+/g, " ") };
}

function parseMortgageBlock(block: ParseLine[], confMin: number): RegistryMortgage {
  const rank = /^\s*(\d+)\s/.exec(block[0].text)?.[1] ?? "";
  const debtors: OcrValue[] = [];
  let mortgagee: OcrValue = v(null, false);
  let mortgageeIdFront: OcrValue = v(null, false);
  for (const line of block) {
    const d = nameAfter(line.text, DEBTOR_KW);
    if (d) debtors.push(valueFrom(line, d, confMin));
    const m = nameAfter(line.text, HOLDER_KW);
    if (m && mortgagee.text === null) {
      mortgagee = valueFrom(line, m, confMin);
      mortgageeIdFront = idFrontAfter(line, HOLDER_KW, confMin);
    }
  }
  return {
    rank,
    receiptNumber: receiptValue(block, confMin),
    registrationDate: dateValue(block, confMin),
    maxClaimAmount: amountValue(block, confMin),
    debtors,
    mortgagee,
    mortgageeIdFront,
    transfers: [],
  };
}

function parseTransferBlock(block: ParseLine[], confMin: number): RegistryTransfer {
  const rank = /^\s*(\d+\s*-\s*\d+)/.exec(block[0].text)?.[1]?.replace(/\s+/g, "") ?? "";
  let assignee: OcrValue = v(null, false);
  let assigneeIdFront: OcrValue = v(null, false);
  for (const line of block) {
    const a = nameAfter(line.text, HOLDER_KW);
    if (a) {
      assignee = valueFrom(line, a, confMin);
      assigneeIdFront = idFrontAfter(line, HOLDER_KW, confMin);
      break;
    }
  }
  return { rank, receiptNumber: receiptValue(block, confMin), registrationDate: dateValue(block, confMin), assignee, assigneeIdFront };
}

/** 을구: 근저당권설정(주등기)과 그 아래 근저당권이전(부기등기) */
function parseMortgages(lines: ParseLine[], confMin: number): RegistryMortgage[] {
  const isTransfer = (l: ParseLine) => fuzzyIncludes(letters(l.text), "근저당권이전");
  const isMortgage = (l: ParseLine) => fuzzyIncludes(letters(l.text), "근저당권설정");
  const mortgages: RegistryMortgage[] = [];
  for (const block of blocks(lines, (l) => isTransfer(l) || isMortgage(l))) {
    if (isTransfer(block[0])) {
      const owner = mortgages[mortgages.length - 1];
      if (owner) owner.transfers.push(parseTransferBlock(block, confMin));
    } else {
      mortgages.push(parseMortgageBlock(block, confMin));
    }
  }
  return mortgages;
}

/** 표제부: 1동 건물의 소재지번, 전유부분의 건물번호·면적 */
function parseProperties(header: ParseLine | undefined, building: ParseLine[], unit: ParseLine[], confMin: number): RegistryRead["properties"] {
  // 1동의 건물: 소재·지번 (건물명칭·도로명주소 빼기)
  const lots = building.flatMap((line) => {
    const m = ADDRESS_LOT_RE.exec(line.text);
    return m ? [{ location: valueFrom(line, m[1], confMin), lotNumber: valueFrom(line, m[2], confMin) }] : [];
  });
  // 전유부분: 건물번호와 면적
  const units = unit.flatMap((line) => {
    const u = UNIT_RE.exec(line.text);
    if (!u) return [];
    const area = /구조\s*([\d,]+(?:\.\d+)?)\s*([^\s\d]{0,3})/.exec(line.text);
    const unitText = compact(u[1]).replace(/층제/, "층 제") + "호";
    const unitOk = u[2] === "호";
    const areaUnitOk = !!area && /^(㎡|m²|m2|ㅁ|ㅠ|ㅁㅠ|rf|nf)?$/.test(area[2]);
    return [
      {
        unitNumber: unitOk ? valueFrom(line, unitText, confMin) : v(unitText, true),
        // 면적 단위 기호(㎡)는 'ㅁ', 'ㅠ'로 잘못 읽히기 쉬워 숫자만 쓰고 단위는 ㎡로 적는다
        area: area ? { text: `${area[1]}㎡`, uncertain: !areaUnitOk || valueConfidence(line, area[1]) < confMin } : v(null, false),
      },
    ];
  });

  // 표의 호수를 깨끗이 읽지 못했으면, 같은 등기부 머리줄([집합건물] …)의 호수를 쓴다
  const headerUnit = header ? UNIT_RE.exec(header.text) : null;
  const n = Math.max(lots.length, units.length);
  const out: RegistryRead["properties"] = [];
  for (let i = 0; i < n; i++) {
    let unitNumber = units[i]?.unitNumber ?? v(null, false);
    if (unitNumber.uncertain && n === 1 && headerUnit && headerUnit[2] === "호") {
      const h = compact(headerUnit[1]).replace(/층제/, "층 제") + "호";
      if (valueConfidence(header!, h) >= confMin) unitNumber = v(h, false);
    }
    out.push({
      location: lots[i]?.location ?? v(null, false),
      lotNumber: lots[i]?.lotNumber ?? v(null, false),
      unitNumber,
      area: units[i]?.area ?? v(null, false),
    });
  }
  return out;
}

/** Tesseract가 읽은 한 페이지(또는 여러 페이지를 이은) 줄들 → 등기부 내용 */
export function parseRegistryLines(lines: ParseLine[], confMin = DEFAULT_CONF_MIN): RegistryRead {
  const bySection: Record<Section, ParseLine[]> = { none: [], building: [], land: [], unit: [], landRight: [], gap: [], eul: [] };
  let current: Section = "none";
  for (const line of lines) {
    const s = sectionOf(line);
    if (s) {
      current = s;
      continue;
    }
    bySection[current].push(line);
  }
  const header = bySection.none.find((l) => /집합건물\]/.test(l.text) && UNIT_RE.test(l.text));
  return {
    properties: parseProperties(header, bySection.building, bySection.unit, confMin),
    owners: parseOwners(bySection.gap, confMin),
    mortgages: parseMortgages(bySection.eul, confMin),
  };
}
