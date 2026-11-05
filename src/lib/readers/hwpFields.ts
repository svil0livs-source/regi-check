// Design Ref: DESIGN.md §4.2 — 한글 신청서 글자에서 대조 항목 15개를 뽑는다. (PLAN 7번)
// 양식: 사용자가 준 「근저당권변경등기신청」 양식(2026-11-05)의 틀을 이전등기에 맞춘 것.
//   맨 위 「접수」 칸: 이전등기 접수일·접수번호
//   ① 부동산의 표시: 1동의 건물의 표시(소재·지번·건물명칭) / 전유부분의 건물의 표시(건물의 번호·구조·면적) / 대지권의 표시
//   ④ 이전할 근저당권: "…접수 제…호로 등기한 순위 제1번 근저당권", 채권최고액, 채무자, 근저당권설정자(소유자)
//   ⑤ 등기의무자(근저당권자, 양도인) / ⑥ 등기권리자(양수인): 성명 칸만 읽는다
// 찾지 못한 항목은 추측하지 않고 null(읽지 못함). 대조 항목이 아닌 정보는 읽지 않는다.
// 주민등록번호(등기용등록번호) 칸은 앞 6자리만 읽고 뒷자리는 버린다 (2026-11-05).
// ⚠ 실제 이전등기 신청서 몇 건으로 칸 이름·위치를 꼭 다시 확인할 것.

import type { DocumentFields, ExtractedValue, PropertyEntry } from "@/types/verification";

const read = (value: string | undefined | null): ExtractedValue => ({ value: value ?? null });

/** 칸 이름 비교용: ①~⑳ 번호와 띄어쓰기를 뗀다 */
const labelOf = (p: string) => p.replace(/^[①-⑳]\s*/u, "").replace(/\s+/g, "");

/** "①" 같은 번호로 시작하는 칸 제목 줄인지 */
const isNumberedLabel = (p: string) => /^[①-⑳]/u.test(p.trim());

/**
 * 이름 칸: 쉼표로 여러 명.
 * 칸이나 줄 자체를 찾지 못했으면 빈 목록이 아니라 「읽지 못함」 1개를 돌려준다.
 * (빈 목록이면 대조에서 "한글 서류에 없음"(불일치)으로 단정되기 때문. 2026-11-05 보완)
 */
const splitNames = (s: string | undefined): ExtractedValue[] => {
  const names = (s ?? "").split(/\s*,\s*/).map((n) => n.trim()).filter(Boolean).map((n) => read(n));
  return names.length ? names : [read(null)];
};

/** 부동산 표시를 찾지 못했을 때: 네 칸 모두 「읽지 못함」인 부동산 하나 */
const UNREAD_PROPERTY = (): PropertyEntry => ({ location: read(null), lotNumber: read(null), unitNumber: read(null), area: read(null) });

/** 번호 칸(①…) 별로 아래 줄들을 모은다 */
function numberedSections(paras: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string | null = null;
  for (const raw of paras) {
    const p = raw.trim();
    if (isNumberedLabel(p)) {
      current = labelOf(p);
      if (!out.has(current)) out.set(current, []);
      continue;
    }
    if (current && p) out.get(current)!.push(p);
  }
  return out;
}

/** 맨 위 접수 칸: "접 수" 다음, "① 부동산의 표시" 전의 날짜와 "제…호" */
function topReceipt(paras: string[]): { date: string | null; receipt: string | null } {
  const start = paras.findIndex((p) => labelOf(p) === "접수");
  const end = paras.findIndex((p) => labelOf(p) === "부동산의표시");
  if (start === -1 || end === -1 || end < start) return { date: null, receipt: null };
  const box = paras.slice(start + 1, end).map((p) => p.trim());
  const date = box.find((p) => /^\d{4}\s*[년.\-/]\s*\d{1,2}\s*[월.\-/]\s*\d{1,2}\s*일?\.?$/.test(p)) ?? null;
  const receipt = box.find((p) => /^제\s*[\d-]+\s*호$/.test(p))?.replace(/\s+/g, "") ?? null;
  return { date, receipt };
}

/** ① 부동산의 표시: "1동의 건물의 표시"마다 부동산 하나 */
function parseProperties(lines: string[]): PropertyEntry[] {
  const blocks: string[][] = [];
  for (const line of lines) {
    if (/^(\d+\.\s*)?1동의\s*건물의\s*표시$/.test(line)) blocks.push([]);
    else if (blocks.length) blocks[blocks.length - 1].push(line);
  }
  return blocks.map((b) => {
    // 1동의 건물의 표시 바로 아래 줄: "소재 지번 건물명칭"
    const m = /^(.+?[동리가로])\s+(\d+(?:-\d+)?)(?:번지)?(?:\s+.*)?$/.exec(b[0] ?? "");
    const unit = b.find((l) => /^건물의\s*번호/.test(l))?.replace(/^건물의\s*번호\s*/, "");
    // 전유부분 면적. "면 적 1층 101호 86.03㎡"처럼 앞말이 붙어도 끝의 숫자㎡만 쓴다. 대지권 토지 면적은 쓰지 않는다.
    const areaLine = b.find((l) => /^면\s*적/.test(l));
    const area = areaLine ? /([\d.,]+\s*(?:㎡|m²|m2|제곱미터))\s*$/.exec(areaLine)?.[1] : undefined;
    return {
      location: read(m?.[1]),
      lotNumber: read(m?.[2]),
      unitNumber: read(unit !== undefined ? unit.trim() : null),
      area: read(area),
    };
  });
}

/** "2021년 7월 4일 접수 제57514호로 등기한 …" → 날짜, 번호 */
function dateAndReceipt(line: string | undefined): { date: string | null; receipt: string | null } {
  const m = line ? /^(.+?)\s*접수\s*(제\s*[\d-]+\s*호)/.exec(line) : null;
  return m ? { date: m[1].trim(), receipt: m[2].replace(/\s+/g, "") } : { date: null, receipt: null };
}

/** "채권최고액 금 1원" 같은 줄에서 앞말을 뗀 값 */
function after(lines: string[], prefix: RegExp): string | undefined {
  const line = lines.find((l) => prefix.test(l));
  return line?.replace(prefix, "").trim();
}

/** 한글 신청서 문단들 → 대조 항목 */
export function extractHwpFields(paragraphs: string[]): DocumentFields {
  const paras = paragraphs.map((p) => p.replace(/\s+/g, " ").trim());
  const s = numberedSections(paras);
  const transfer = topReceipt(paras);
  const original = s.get("이전할근저당권") ?? [];
  const head = dateAndReceipt(original[0]);
  // ⑤·⑥ 칸: 칸 제목 바로 다음 줄이 성명(상호·명칭). 역할 표시·주소는 읽지 않는다.
  const firstLine = (label: string) => (s.get(label) ?? [])[0];
  // 등록번호는 앞 6자리만 꺼낸다. 뒷자리는 이 자리에서 버린다 (2026-11-05 사용자 요청: 앞자리만 대조)
  const idFront = (label: string) => {
    for (const line of s.get(label) ?? []) {
      const m = /(?:^|\s)(\d{6})\s*-\s*[\d*]{7}(?:\s|$)/.exec(line);
      if (m) return m[1];
    }
    return null;
  };

  return {
    parties: {
      mortgagee: splitNames(firstLine("등기의무자")),
      assignee: splitNames(firstLine("등기권리자")),
      debtor: splitNames(after(original, /^채무자\s*/)),
      owner: splitNames(after(original, /^(근저당권설정자\s*\(\s*소유자\s*\)|소유자)\s*/)),
    },
    properties: (() => {
      const list = parseProperties(s.get("부동산의표시") ?? []);
      return list.length ? list : [UNREAD_PROPERTY()];
    })(),
    maxClaimAmount: read(after(original, /^채권최고액\s*/)),
    receiptNumber: read(head.receipt),
    transferReceiptNumber: read(transfer.receipt),
    registrationDate: read(head.date),
    transferRegistrationDate: read(transfer.date),
    mortgageeIdFront: read(idFront("등기의무자")),
    assigneeIdFront: read(idFront("등기권리자")),
  };
}
