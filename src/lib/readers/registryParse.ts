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

// plainBuilding·plainLand: 일반건물·토지 등기부의 표제부 ( 건물의 표시 ) · ( 토지의 표시 ) (2026-11-09 사용자 결정으로 자동 대조)
type Section = "none" | "building" | "land" | "unit" | "landRight" | "plainBuilding" | "plainLand" | "gap" | "eul";
/** 등기부 하나의 맨 앞 표제부 */
const TITLE_SECTIONS: Section[] = ["building", "plainBuilding", "plainLand"];

function sectionOf(line: ParseLine): Section | null {
  const t = letters(line.text);
  if (fuzzyIncludes(t, "1동의건물의표시")) return "building";
  if (fuzzyIncludes(t, "대지권의목적인토지")) return "land";
  if (fuzzyIncludes(t, "전유부분의건물의표시")) return "unit";
  if (fuzzyIncludes(t, "대지권의표시")) return "landRight";
  // 짧은 제목이라 오독 허용 없이 찾는다 (1동의·전유부분의 건물의 표시는 위에서 이미 걸러짐)
  if (t.includes("건물의표시") && t.length <= 14) return "plainBuilding";
  if (t.includes("토지의표시") && t.length <= 14) return "plainLand";
  if (fuzzyIncludes(t, "소유권이외의권리")) return "eul";
  if (fuzzyIncludes(t, "소유권에관한사항")) return "gap";
  // 갑구·을구 표의 머리줄. 구 제목을 잘못 읽어도 표제부에서 벗어났음을 안다 (표제부 표는 「표시번호」로 시작)
  if (/^순위번호/.test(t) || fuzzyIncludes(t.slice(0, 6), "순위번호")) return "gap";
  // 스캔본은 순위번호 칸을 숫자로만 읽어 머리줄에 「순위번호」가 없다. 갑구·을구 표에만 있는 「권리자 및 기타사항」으로 안다
  // (표제부 표는 「등기원인 및 기타사항」. 「열람용」 글자가 구 제목을 덮어 제목을 못 읽은 일이 있었다, 2026-11-13 실제 스캔본)
  if (fuzzyIncludes(t, "권리자및기타사항") && t.length <= 30) return "gap";
  return null;
}

const DATE_RE = /(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/;
const RECEIPT_RE = /제\s*([\d/ ]{3,})\s*호/;
// 주민·법인등록번호 (읽기 오류로 숫자가 '/'가 되기도 한다). 이 번호부터 줄 끝까지는 이름이 아니다.
const ID_RE = /[\d/]{6}\s*-\s*[\d*/]{5,}/;
const ADDRESS_LOT_RE = /(\S*(?:특별시|광역시|특별자치시|특별자치도|도)\s+(?:\S+\s+){0,3}?\S+[동리가])\s+(\d+(?:-\d+)?)(?=\s|$)/;
// "층"은 "충·중·증"으로 잘못 읽히기 쉽다. 숫자 뒤 "층" 자리 글자이므로 같은 것으로 보고 "층"으로 적는다
// 호수 숫자 앞에 글자가 붙기도 한다 (예: "제8층 제씨-809호", 2026-11-13 실제 서류)
const UNIT_RE = /(제\s*\d+\s*[층충중증]\s*제\s*(?:[가-힣A-Za-z]{1,3}\s*-\s*)?\d+\s*)(\S)/;
const fixFloor = (s: string) => s.replace(/(\d\s*)[충중증]/g, "$1층");
// 칸 제목: 글자 하나가 잘못 읽혀도 찾는다 (예: 근저탕권자, 재무자)
// (근저당권자의 '근'이 '그'로 읽히거나 빠지는 경우도 있다. 값이 아니라 칸 제목만 느슨하게 찾는다)
const HOLDER_KW = /(?:근\s*)?[저지처]\s*[가-힣]\s*권\s*자\s*/;
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
    .replace(/(\s+[ㄱ-ㆎ]+)+\s*$/u, "") // 이름 뒤 떨어진 자모(체크 표시 자국 등 "ㄱㄱ")
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
function idFrontAfter(line: ParseLine, keyword: RegExp, confMin: number, next?: ParseLine): OcrValue {
  const k = keyword.exec(line.text);
  if (!k) return v(null, false);
  let id = ID_RE.exec(line.text.slice(k.index + k[0].length));
  // 이름이 길면 등록번호가 다음 줄 맨 앞으로 넘어간다 (실제 스캔본, 2026-11-06)
  if (!id && next && /^\s*[\d/]{6}\s*-/.test(next.text)) {
    id = ID_RE.exec(next.text);
    line = next;
  }
  if (!id) return v(null, false);
  const front = id[0].split("-")[0].replace(/\s+/g, "").slice(0, 6);
  return v(front, !/^\d{6}$/.test(front) || valueConfidence(line, front) < confMin);
}

/**
 * 공동 채무자 이름 줄: 오른쪽 칸 글자가 띄어쓰기 없는 한글 이름(회사 이름 포함) 하나뿐인 줄.
 * 주소 줄(숫자·띄어쓰기·괄호가 있음)은 이름이 아니다. 이름 글자는 고치지 않는다.
 */
function coDebtorName(lineText: string): string | undefined {
  const cell = lastCell(lineText).trim();
  return /^[가-힣]{2,20}$/.test(cell) ? cell : undefined;
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
  const hit = firstMatch(block, /권\s*최\s*[고그]\s*액\s*(금\s*[\d,.\s]+원)/);
  if (!hit) return v(null, false);
  const raw = hit.m[1];
  const fixed = raw.replace(/(\d)\.(\d{3})(?!\d)/g, "$1,$2").replace(/\s+/g, " ");
  const base = valueFrom(hit.line, raw, confMin);
  return { text: fixed.replace(/금\s*/, "금 ").replace(/\s+원$/, "원"), uncertain: base.uncertain || fixed !== raw.replace(/\s+/g, " ") };
}

function parseMortgageBlock(block: ParseLine[], confMin: number): RegistryMortgage {
  const rawRank = /^\s*(\d+)\s/.exec(block[0].text)?.[1] ?? "";
  // 순위번호도 확신도가 낮으면 쓰지 않는다 (빈 값 → 「읽지 못함」)
  const rank = rawRank && valueConfidence(block[0], rawRank) >= confMin ? rawRank : "";
  const debtors: OcrValue[] = [];
  let mortgagee: OcrValue = v(null, false);
  let mortgageeIdFront: OcrValue = v(null, false);
  // 채무자 칸 이름 줄 다음부터 근저당권자 줄 전까지: 공동 채무자는 칸 이름 없이 이름 줄·주소 줄이 이어진다 (2026-11-07)
  let inDebtors = false;
  block.forEach((line, i) => {
    const d = nameAfter(line.text, DEBTOR_KW);
    const m = nameAfter(line.text, HOLDER_KW);
    if (d) {
      debtors.push(valueFrom(line, d, confMin));
      inDebtors = true;
    } else if (inDebtors && !m) {
      const name = coDebtorName(line.text);
      if (name) debtors.push(valueFrom(line, name, confMin));
    }
    if (m) inDebtors = false;
    if (m && mortgagee.text === null) {
      mortgagee = valueFrom(line, m, confMin);
      mortgageeIdFront = idFrontAfter(line, HOLDER_KW, confMin, block[i + 1]);
    }
  });
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
  for (let i = 0; i < block.length; i++) {
    const a = nameAfter(block[i].text, HOLDER_KW);
    if (a) {
      assignee = valueFrom(block[i], a, confMin);
      assigneeIdFront = idFrontAfter(block[i], HOLDER_KW, confMin, block[i + 1]);
      break;
    }
  }
  return { rank, receiptNumber: receiptValue(block, confMin), registrationDate: dateValue(block, confMin), assignee, assigneeIdFront };
}

/**
 * 을구: 근저당권설정(주등기)과 그 아래 근저당권이전(부기등기).
 * 말소사항 포함 등기부에는 말소·변경 등기도 있다 (2026-11-05 보완):
 *   - "N번근저당권설정등기말소" → N번 근저당권은 말소된 것이므로 대조 후보에서 뺀다.
 *   - "N번근저당권변경"(부기등기 N-M)에 채권최고액이 있으면 → 그 근저당권의 채권최고액을 변경 후 금액으로 바꾼다.
 * 부기등기(이전·변경)는 순위번호 앞부분(N-)으로 주등기를 찾고, 못 찾으면 바로 앞 주등기에 붙인다.
 */
/** 다른 등기를 가리키는 "N번근…" / "N번(n)근…" */
const REF_RE = /(\d+)\s*번\s*(?:\(\s*\d+\s*\)\s*)?근/g;
const REF_SETUP_RE = /\d+\s*번\s*(?:\(\s*\d+\s*\)\s*)?근\s*저\s*당\s*권\s*설\s*정/;

function parseMortgages(lines: ParseLine[], confMin: number): RegistryMortgage[] {
  const has = (l: ParseLine, word: string) => fuzzyIncludes(letters(l.text), word);
  // '말소'는 짧은 낱말이라 오독 허용 없이 그대로 찾는다 (예: '주소'를 말소로 잘못 보지 않게)
  // "N번근저당권설정등기말소"는 칸이 좁아 "말소"가 다음 줄로 넘어가기도 한다 (2026-11-09 실제 글자 PDF).
  // 다른 등기를 "N번"으로 가리키는 "N번근저당권설정…"은 그 설정등기를 지우는 말소 줄이다 (변경·이전은 "N번근저당권변경/이전")
  // 공동담보 등기부는 "1번(1)근저당권설정"처럼 번호 뒤에 괄호 번호가 붙는다 (2026-11-09 실제 스캔본)
  const isCancel = (l: ParseLine) => (letters(l.text).includes("말소") && has(l, "근저당권")) || REF_SETUP_RE.test(l.text);
  const isChange = (l: ParseLine) => !isCancel(l) && has(l, "근저당권변경");
  const isTransfer = (l: ParseLine) => !isCancel(l) && has(l, "근저당권이전");
  const isMortgage = (l: ParseLine) => !isCancel(l) && has(l, "근저당권설정");
  const mortgages: RegistryMortgage[] = [];
  const cancelled = new Set<string>();
  const parentOf = (rank: string) => {
    const head = /^(\d+)-/.exec(rank)?.[1];
    return (head && mortgages.find((m) => m.rank === head)) || mortgages[mortgages.length - 1];
  };
  // 그 밖의 등기 줄(질권·가압류 등)의 첫 줄: 칸 사이 두 칸 띄움 + 접수 날짜·번호. 앞 근저당권 묶음에 섞이지 않게 끊는다
  const isOtherRow = (l: ParseLine) => /\s{2}/.test(l.text) && DATE_RE.test(l.text) && RECEIPT_RE.test(l.text);
  // 「근저당권자 경…」처럼 권리자 칸 줄은 등기목적 줄이 아니다: 오독 허용 때문에 "근저당권자경"을 "근저당권변경"으로 보지 않게 (2026-11-09 실제 스캔본)
  const isLabelLine = (l: ParseLine) => new RegExp(`^\\s*(?:${HOLDER_KW.source}|${DEBTOR_KW.source})`).test(l.text);
  const isKnown = (l: ParseLine) => !isLabelLine(l) && (isCancel(l) || isChange(l) || isTransfer(l) || isMortgage(l));
  for (const block of blocks(lines, (l) => isKnown(l) || isOtherRow(l))) {
    const first = block[0];
    // 손으로 그린 동그라미가 「근」을 가려 "저당권설정"만 읽히기도 한다 (2026-11-13 실제 스캔본).
    // 저당권(채권액)과 달리 근저당권에만 있는 「채권최고액」이 같은 묶음에 있을 때만 근저당권설정으로 본다
    const hiddenGeun = !isKnown(first) && !isLabelLine(first) && letters(first.text).includes("저당권설정") && !/\d\s*번/.test(first.text) && amountValue(block, confMin).text !== null;
    if (hiddenGeun) {
      mortgages.push(parseMortgageBlock(block, confMin));
      continue;
    }
    if (!isKnown(first)) continue;
    if (isCancel(first)) {
      // 한 줄에 여러 근저당권을 말소하기도 한다 ("1번(1)근저당권설정, 2번(2)근저당권설정 등기말소")
      for (const t of first.text.matchAll(REF_RE)) cancelled.add(t[1]);
      continue;
    }
    const subRank = /^\s*(\d+\s*-\s*\d+)/.exec(first.text)?.[1]?.replace(/\s+/g, "") ?? "";
    if (isChange(first)) {
      const owner = parentOf(subRank);
      const amount = amountValue(block, confMin);
      if (owner && amount.text) owner.maxClaimAmount = amount; // 나중 변경이 앞의 금액을 대신한다
      continue;
    }
    if (isTransfer(first)) {
      const owner = parentOf(subRank);
      if (owner) owner.transfers.push(parseTransferBlock(block, confMin));
    } else {
      mortgages.push(parseMortgageBlock(block, confMin));
    }
  }
  return mortgages.filter((m) => !cancelled.has(m.rank));
}

/**
 * 페이지 머리줄 "[집합건물] … 가람한빛타운 제110동 제13층 제1301호"에서 호수 바로 앞 낱말이 "…동"이면 그 동 (2026-11-09).
 * 1동의 건물 이름 끝의 동이다. 소재지의 동(예: 가람동)은 지번 앞이라 호수 바로 앞에 오지 않는다.
 */
function headerDong(header: ParseLine, confMin: number): { unit: string; dong: OcrValue } | null {
  const u = UNIT_RE.exec(header.text);
  if (!u || u[2] !== "호") return null;
  const before = header.text.slice(0, u.index).trim().split(/\s+/).pop() ?? "";
  if (!/^[\p{L}\d-]*동$/u.test(before) || before.length < 2) return null;
  return { unit: fixFloor(compact(u[1])), dong: valueFrom(header, before, confMin) };
}

/** 표제부: 1동 건물의 소재지번, 전유부분의 건물번호·면적 */
function parseProperties(header: ParseLine | undefined, building: ParseLine[], unit: ParseLine[], confMin: number, headers: ParseLine[] = []): RegistryRead["properties"] {
  // 1동의 건물: 소재·지번 (건물명칭·도로명주소 빼기)
  // 페이지마다 위에 찍힌 "[집합건물] …" 머리줄은 표 내용이 아니다
  const allLots = building.filter((line) => !/집합건물/.test(line.text)).flatMap((line) => {
    const m = ADDRESS_LOT_RE.exec(line.text);
    return m ? [{ location: valueFrom(line, m[1], confMin), lotNumber: valueFrom(line, m[2], confMin) }] : [];
  });
  // 전유부분: 건물번호와 면적
  const allUnits = unit.flatMap((line) => {
    const u = UNIT_RE.exec(line.text);
    if (!u) return [];
    // 구조 이름(「…구조」「…라멘조」「벽돌조」 등) 바로 뒤의 숫자가 전유 면적
    const area = /조\s*([\d,]+(?:\s*\.\s*\d+)?)\s*([^\s\d]{0,3})/.exec(line.text);
    const unitText = fixFloor(compact(u[1])).replace(/층제/, "층 제") + "호";
    const unitOk = u[2] === "호";
    // 단위 기호(㎡)를 못 읽었으면 숫자 끝에 단위가 숫자로 잘못 붙었을 수 있다 (예: 49.98㎡ → "49.9811"). 그때는 확신하지 않는다
    const areaUnitOk = !!area && /^(㎡|m²|m2|ㅁ|ㅠ|ㅁㅠ|rf|nf)$/.test(area[2]);
    return [
      {
        unitNumber: unitOk ? v(unitText, valueConfidence(line, compact(u[1])) < confMin) : v(unitText, true),
        // 면적 단위 기호(㎡)는 'ㅁ', 'ㅠ'로 잘못 읽히기 쉬워 숫자만 쓰고 단위는 ㎡로 적는다
        // 소수 셋째 자리가 있으면 ㎡의 m을 숫자 1로 읽어 붙였을 수 있다 (예: 114.62㎡ → "114.621"). 고치지 않고 확신하지 않는다
        // 소수 넷째 자리까지 적는 면적도 있다 (예: 84.9457㎡, 2026-11-13 실제 스캔본): 단위 기호까지 읽었으면 넷째 자리는 그대로 믿는다
        area: area ? { text: `${area[1]}㎡`, uncertain: !areaUnitOk || /\.\s*\d{3}(?!\d)/.test(area[1]) || /\.\s*\d{5,}/.test(area[1]) || valueConfidence(line, area[1]) < confMin } : v(null, false),
      },
    ];
  });

  // 등기부 하나에 전유부분은 하나다. 표시가 바뀌어 줄이 여러 개면(글자 PDF는 취소선을 알 수 없음) 마지막이 지금 표시다 (2026-11-09)
  const units = allUnits.slice(-1);
  const lots = allLots.slice(-1);
  // 표의 호수를 깨끗이 읽지 못했으면, 같은 등기부 머리줄([집합건물] …)의 호수를 쓴다
  const headerUnit = header ? UNIT_RE.exec(header.text) : null;
  const n = Math.max(lots.length, units.length);
  const out: RegistryRead["properties"] = [];
  for (let i = 0; i < n; i++) {
    let unitNumber = units[i]?.unitNumber ?? v(null, false);
    if (unitNumber.uncertain && n === 1 && headerUnit && headerUnit[2] === "호") {
      const h = fixFloor(compact(headerUnit[1])).replace(/층제/, "층 제") + "호";
      if (valueConfidence(header!, compact(headerUnit[1])) >= confMin) unitNumber = v(h, false);
    }
    // 동: 이 호수가 적힌 머리줄에서 (등기부 여러 개를 이어 붙였으면 호수로 머리줄을 찾는다)
    const dongs = headers.map((h) => headerDong(h, confMin)).filter((d): d is NonNullable<typeof d> => !!d);
    const unitKey = unitNumber.text ? compact(unitNumber.text).replace(/호$/, "") : null;
    const mine = dongs.filter((d) => unitKey !== null && d.unit === unitKey);
    const dong = (mine.find((d) => !d.dong.uncertain) ?? mine[0])?.dong;
    if (dong?.text && unitNumber.text) unitNumber = v(`${dong.text} ${unitNumber.text}`, unitNumber.uncertain || dong.uncertain);
    out.push({
      location: lots[i]?.location ?? v(null, false),
      lotNumber: lots[i]?.lotNumber ?? v(null, false),
      unitNumber,
      area: units[i]?.area ?? v(null, false),
    });
  }
  return out;
}

// ── 토지·일반건물 표제부 (2026-11-09) ──────────────────────────────
const LOT_CELL_RE = /^(산\s*)?\d+(?:-\d+)?(?:번지)?$/;
const AREA_UNIT = "㎡|m²|m2|ㅁ|ㅠ|ㅁㅠ|rf|nf";
const LAND_AREA_RE = new RegExp(`^([\\d,]+(?:\\.\\d+)?)\\s*(${AREA_UNIT})$`);
// 건물내역의 층별 면적 칸: "1층 51.36㎡", "지하1층 30.5㎡", "옥탑1층 12㎡"
const FLOOR_AREA_RE = new RegExp(`^((?:지하|지|옥탑)?\\s*\\d*\\s*층)\\s*([\\d,]+(?:\\.\\d+)?)\\s*(${AREA_UNIT})$`);
// 스캔본은 건물내역 칸의 줄들이 한 칸 글자로 이어져 온다("…구조 2층 단독주택 지1층 122.83㎡ 1층 72.74㎡"): 칸 안에서 층별 면적을 모두 찾는다 (2026-11-10).
// 단위를 못 읽은 층("1층 72.741")도 빠뜨리지 않고 확신 없음으로 넣는다 (층이 빠진 채 비교되지 않도록)
const FLOOR_AREAS_RE = new RegExp(`(?<![가-힣\\d])((?:지하|지|옥탑)?\\s*\\d*\\s*층|(?:지하|지|옥탑)?\\s*\\d+\\s*[가-힣])\\s*([\\d,]+(?:\\.\\d+)?)\\s*(${AREA_UNIT})?(?=\\s|$)`, "g");
const cells = (text: string) => text.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);

/**
 * 표제부 표의 줄들 → 표시 줄 묶음들. 맨 마지막 표시 줄이 지금 표시다
 * (앞 표시는 말소된 것. 글자 PDF는 취소선을 알 수 없으므로 마지막 것을 쓴다).
 */
function displayRows(section: ParseLine[]): ParseLine[][] {
  const body = section.filter((l) => !/^\s*표\s*시\s*번\s*호/.test(l.text) && !/^\s*\[(집합건물|건물|토지)\]/.test(l.text));
  // 표시 줄 첫 줄: 첫 칸이 표시번호(숫자만)이고 다음 칸이 접수 날짜나 소재지. (지번만 있는 다음 줄과 헷갈리지 않게)
  const isAddress = (c: string) => /(특별시|광역시|특별자치시|특별자치도|도)\s/.test(c) || /[시군구]\s+\S+[동리가읍면]/.test(c);
  const rows = blocks(body, (l) => {
    const [no, next] = cells(l.text);
    return /^\d+$/.test(no ?? "") && !!next && (DATE_RE.test(next) || isAddress(next));
  });
  if (rows.length) return rows;
  // 스캔본에서 표시번호·접수 칸을 잘못 읽으면(예: "ㅁ") 첫 칸 규칙으로 못 찾는다: 소재지 칸이 있는 줄을 표시 줄 첫 줄로 본다 (2026-11-09)
  return blocks(body, (l) => cells(l.text).some(isAddress));
}

/** 표시 줄 첫 줄의 소재지 칸: 표시번호·접수 날짜를 뺀 첫 주소 칸 */
function plainLocation(row: ParseLine[], confMin: number): { location: OcrValue; lotNumber: OcrValue } {
  const first = row[0];
  const rest = first.text.replace(/^\s*\d+\s+/, "");
  const cell0 = cells(rest).find((c) => /(특별시|광역시|특별자치시|특별자치도|도)\s/.test(c) || /[시군구]\s+\S+[동리가읍면]/.test(c));
  if (!cell0) return { location: v(null, false), lotNumber: v(null, false) };
  // 스캔본 건물 표제부는 소재지번 칸에 "[도로명주소] …"가 이어져 온다: 대괄호부터는 뺀다 (2026-11-10)
  const cell = cell0.replace(/\s*\[.*$/, "").trim() || cell0;
  // 소재지와 지번이 한 칸에 있으면 나누고, 아니면 다음 줄들의 첫 칸에서 지번을 찾는다
  const same = /^(.*[동리가읍면로])\s+((?:산\s*)?\d+(?:-\d+)?)(?:번지)?$/.exec(cell);
  if (same) return { location: valueFrom(first, same[1], confMin), lotNumber: valueFrom(first, same[2], confMin) };
  for (const line of row.slice(1)) {
    const lot = cells(line.text).map((c) => c.split(/\s+/)[0]).find((c) => LOT_CELL_RE.test(c));
    if (lot) return { location: valueFrom(first, cell, confMin), lotNumber: valueFrom(line, lot.replace(/번지$/, ""), confMin) };
  }
  return { location: valueFrom(first, cell, confMin), lotNumber: v(null, false) };
}

/**
 * 쪽마다 맨 위에 되풀이되는 머리줄 "[토지] 경기도 가상시 나라동 123-4"에서 소재지·지번을 찾는다 (2026-11-10 실제 스캔본).
 * 확신 있게 읽은 머리줄 가운데 똑같은 것이 2번 이상이고 다른 것보다 많을 때만 쓴다.
 */
function headerAddress(lines: ParseLine[], confMin: number): { location: string; lot: string } | null {
  const count = new Map<string, number>();
  for (const l of lines) {
    const m = /^\s*\[\S{1,4}\]\s*(.*[동리가읍면로])\s+((?:산\s*)?\d+(?:-\d+)?)(?=\s|$)/.exec(l.text);
    if (!m || !/(특별시|광역시|특별자치시|특별자치도|도|시|군|구)\s/.test(m[1])) continue;
    if (valueConfidence(l, m[1].trim()) < confMin || valueConfidence(l, m[2]) < confMin) continue;
    const key = `${m[1].trim().replace(/\s+/g, " ")}\u0000${compact(m[2])}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  const [top, second] = [...count.entries()].sort((a, b) => b[1] - a[1]);
  if (!top || top[1] < 2 || (second && second[1] === top[1])) return null;
  const [location, lot] = top[0].split("\u0000");
  return { location, lot };
}

/** 토지: 소재지·지번·면적. 건물: 소재지·지번·층별 면적 전부. 호수는 없다(빈 값) */
function parsePlainProperty(kind: "plainBuilding" | "plainLand", section: ParseLine[], confMin: number, header: { location: string; lot: string } | null = null): RegistryRead["properties"][number] | null {
  const rows = displayRows(section);
  const row = rows[rows.length - 1];
  if (!row) return null;
  let { location, lotNumber } = plainLocation(row, confMin);
  // 표제부 줄의 지번이 머리줄 지번과 같으면 같은 부동산이다: 소재지를 못 믿거나 머리줄과 다르게 읽었으면 여러 쪽에서 똑같이 읽은 머리줄 것을 쓴다
  const same = (a: string | null, b: string) => a !== null && compact(a) === compact(b);
  if (header && same(lotNumber.text, header.lot) && !lotNumber.uncertain && (location.uncertain || !same(location.text, header.location))) location = v(header.location, false);
  // 소재지는 확실히 같은데 지번을 못 읽었거나 못 믿으면 머리줄 지번을 쓴다
  else if (header && same(location.text, header.location) && !location.uncertain && (lotNumber.text === null || lotNumber.uncertain)) lotNumber = v(header.lot, false);
  let area: OcrValue = v(null, false);
  if (kind === "plainLand") {
    for (const line of row) {
      const hit = cells(line.text).map((c) => LAND_AREA_RE.exec(c)).find(Boolean);
      if (hit) {
        area = { text: `${hit[1]}㎡`, uncertain: hit[2] !== "㎡" || valueConfidence(line, hit[1]) < confMin };
        break;
      }
    }
  } else {
    const floors: { text: string; uncertain: boolean }[] = [];
    for (const line of row) {
      for (const c of cells(line.text)) {
        const f = FLOOR_AREA_RE.exec(c);
        if (f) {
          floors.push({ text: `${compact(f[1])} ${f[2]}㎡`, uncertain: f[3] !== "㎡" || valueConfidence(line, f[2]) < confMin });
          continue;
        }
        for (const g of fixFloor(c).matchAll(FLOOR_AREAS_RE)) {
          // "층"을 다른 글자로 읽은 층("2흥 76.47㎡")도 층으로 넣되 확신 없음으로 둔다
          const label = compact(g[1]);
          floors.push({ text: `${label.replace(/[가-힣]$/, "층")} ${g[2]}㎡`, uncertain: !label.endsWith("층") || g[3] !== "㎡" || valueConfidence(line, g[2]) < confMin });
        }
      }
    }
    if (floors.length) area = { text: floors.map((f) => f.text).join(", "), uncertain: floors.some((f) => f.uncertain) };
  }
  return { location, lotNumber, unitNumber: v("", false), area };
}

/**
 * 등기부 여러 개를 한 파일로 이어 붙였으면(공동담보·토지+건물) 등기부마다 나눈다.
 * 갑구·을구 다음에 다시 표제부 제목이 나오면 새 등기부다. 그 바로 앞의 머리줄([토지] … 등)도 새 등기부로 옮긴다.
 */
function splitRegistries(lines: ParseLine[]): ParseLine[][] {
  const out: ParseLine[][] = [[]];
  let seenRights = false;
  const isHead = (l: ParseLine) => /^\s*\[(집합건물|건물|토지)\]|고유번호|등기사항전부증명서|^\s*-\s*(집합건물|건물|토지)\s*-\s*$/.test(l.text);
  for (const line of lines) {
    const s = sectionOf(line);
    if (s && TITLE_SECTIONS.includes(s) && seenRights) {
      const prev = out[out.length - 1];
      const moved: ParseLine[] = [];
      while (prev.length && isHead(prev[prev.length - 1])) moved.unshift(prev.pop()!);
      out.push(moved);
      seenRights = false;
    }
    if (s === "gap" || s === "eul") seenRights = true;
    out[out.length - 1].push(line);
  }
  return out.filter((c) => c.length);
}

/** Tesseract가 읽은 한 페이지(또는 여러 페이지를 이은) 줄들 → 등기부 내용 */
export function parseRegistryLines(lines: ParseLine[], confMin = DEFAULT_CONF_MIN): RegistryRead {
  const chunks = splitRegistries(lines);
  if (chunks.length > 1) {
    // 부동산은 등기부마다, 소유자·근저당권은 모든 줄에서 (같은 근저당권이 여러 등기부에 나오면 대조에서 한 건으로 본다)
    const reads = chunks.map((c) => parseOneRegistry(c, confMin));
    return { properties: reads.flatMap((r) => r.properties), owners: reads.flatMap((r) => r.owners), mortgages: reads.flatMap((r) => r.mortgages) };
  }
  return parseOneRegistry(lines, confMin);
}

/** 등기부 하나의 줄들 → 내용 */
function parseOneRegistry(lines: ParseLine[], confMin: number): RegistryRead {
  const bySection: Record<Section, ParseLine[]> = { none: [], building: [], land: [], unit: [], landRight: [], plainBuilding: [], plainLand: [], gap: [], eul: [] };
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
  // 갑구·을구 제목 글자를 잘못 읽으면 줄이 엉뚱한 구역에 들어가므로, 근저당권은 표제부를 뺀 모든 줄에서 순서대로 찾는다
  const titles = new Set([...bySection.building, ...bySection.land, ...bySection.unit, ...bySection.landRight, ...bySection.plainBuilding, ...bySection.plainLand]);
  const rest = lines.filter((l) => !titles.has(l));
  // 토지·일반건물 등기부: 표제부 하나 = 부동산 하나
  const plain = (["plainBuilding", "plainLand"] as const).flatMap((k) => (bySection[k].length ? [parsePlainProperty(k, bySection[k], confMin, headerAddress(lines, confMin))] : [])).filter((p) => p !== null);
  if (plain.length && !bySection.unit.length) {
    return { properties: plain, owners: parseOwners(bySection.gap, confMin), mortgages: parseMortgages(rest, confMin) };
  }
  return {
    // 전유부분 제목을 잘못 읽으면 건물번호 줄이 다른 표제부 구역에 들어간다. 머리줄을 뺀 표제부 줄 전체에서 찾는다
    properties: parseProperties(
      header,
      bySection.building,
      [...bySection.unit, ...bySection.land, ...bySection.landRight].filter((l) => !/집합건물/.test(l.text)),
      confMin,
      lines.filter((l) => /집합건물\]/.test(l.text)),
    ),
    owners: parseOwners(bySection.gap, confMin),
    mortgages: parseMortgages(rest, confMin),
  };
}
