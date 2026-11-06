// Design Ref: DESIGN.md §4.2 — 한글 서류 글자에서 대조 항목을 뽑는다. (PLAN 7번)
// 양식 (2026-11-06 사용자가 준 실제 양식): 「위임장」 + 「확정채권 및 근저당권 양도증서」 (한국자산관리공사 양수 건)
//   부동산의 표시: "1. 1동의 건물의 표시" 아래 "소재 지번" 줄, 전유부분 "건물의 번호 : …", "구조 및 면적 : … 80㎡"
//   이전할 근저당권: "2020년03월13일 접수 제14475호 순위 제3번으로 등기한 근저당권설정등기, …" (1~2건)
//                    "(채권최고액 : 금 504,000,000원)" — 여러 건이면 합계 (2026-11-06 사용자 확인)
//   채권 양도인: "삼성화재해상보험주식회사 (110111-0005078)" — 등기부의 근저당권자. 번호는 앞 6자리만 읽는다.
//   채무자: 「채 무 자」 칸 다음 줄
// 한글 서류에 없는 소유자·양수인·이전등기 접수번호·날짜는 읽지 않는다 (2026-11-06 사용자 결정).
// 찾지 못한 항목은 추측하지 않고 null(읽지 못함).

import type { DocumentFields, ExtractedValue, MortgageEntry, PropertyEntry } from "@/types/verification";

const read = (value: string | undefined | null): ExtractedValue => ({ value: value ?? null });

/** 칸 이름 비교용: 번호·괄호·띄어쓰기를 뗀다 ("【부동산의 표시】" → "부동산의표시", "채    무     자" → "채무자") */
const labelOf = (p: string) => p.replace(/^[①-⑳]\s*/u, "").replace(/[【】\s]/g, "");

/** 이름 칸: 쉼표로 여러 명. 찾지 못했으면 「읽지 못함」 1개 (빈 목록이면 "한글 서류에 없음"으로 단정되기 때문) */
const splitNames = (s: string | undefined | null): ExtractedValue[] => {
  const names = (s ?? "").split(/\s*,\s*/).map((n) => n.trim()).filter(Boolean).map((n) => read(n));
  return names.length ? names : [read(null)];
};

const UNREAD_PROPERTY = (): PropertyEntry => ({ location: read(null), lotNumber: read(null), unitNumber: read(null), area: read(null) });
const UNREAD_MORTGAGE = (): MortgageEntry => ({ receiptNumber: read(null), registrationDate: read(null), rank: read(null) });

/** 이 양식의 칸 이름들 (빈 양식에서 다음 칸 이름을 값으로 잘못 읽지 않도록) */
const LABELS = new Set(["채권양도인", "채권양수인", "채무자", "이전할근저당권", "부동산의표시", "등기원인과그연월일", "등기의목적"]);

/** 칸 이름 줄 다음의 첫 글자 줄. 그 줄이 다른 칸 이름이면 값이 비어 있는 것 */
function nextFilled(paras: string[], from: number): string | undefined {
  for (let i = from + 1; i < paras.length; i++) {
    if (!paras[i]) continue;
    return LABELS.has(labelOf(paras[i])) ? undefined : paras[i];
  }
  return undefined;
}

/**
 * 부동산의 표시: "1. 1동의 건물의 표시"마다 부동산 하나.
 * 위임장과 양도증서에 같은 내용이 두 번 나오므로, 위임장(앞쪽) 것을 쓰고 양도증서 쪽은 건너뛴다.
 */
function parseProperties(paras: string[]): PropertyEntry[] {
  const end = paras.findIndex((p) => /^등기원인과/.test(labelOf(p)));
  const area = end === -1 ? paras : paras.slice(0, end);
  const starts = area.map((p, i) => (/^(\d+\.\s*)?1동의\s*건물의\s*표시$/.test(p) ? i : -1)).filter((i) => i >= 0);
  return starts.map((s, n) => {
    const block = area.slice(s + 1, starts[n + 1] ?? area.length).filter(Boolean);
    // 첫 줄: "경기도 성남시 분당구 서현동 255-1" → 소재지 / 지번
    const m = /^(.+?[동리가로])\s+(산?\d+(?:-\d+)?)(?:번지)?(?:\s+.*)?$/.exec(block[0] ?? "");
    // "1. 건물의 번호 : 제8층 제씨-809호[고유번호:…]" → "제8층 제씨-809호"
    const unitLine = block.find((l) => /건물의\s*번호\s*:/.test(l));
    const unit = unitLine?.replace(/^.*건물의\s*번호\s*:\s*/, "").replace(/\[.*$/, "").trim();
    // "구조 및 면적 : 철근콘크리트구조 80㎡" → "80㎡" (대지권 토지 면적은 쓰지 않는다)
    const areaLine = block.find((l) => /구조\s*및\s*면적\s*:/.test(l));
    const areaValue = areaLine ? /([\d.,]+\s*(?:㎡|m²|m2|제곱미터))\s*$/.exec(areaLine)?.[1] : undefined;
    return {
      location: read(m?.[1]),
      lotNumber: read(m?.[2]),
      unitNumber: read(unit || null),
      area: read(areaValue),
    };
  });
}

/** "2020년03월13일 접수 제14475호 순위 제3번으로 등기한 …" → 근저당권마다 접수일·접수번호·순위 */
function parseMortgages(line: string | undefined): MortgageEntry[] {
  if (!line) return [];
  const re = /(\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일)\s*접수\s*(제\s*[\d-]+\s*호)\s*(?:순위\s*제\s*(\d+)\s*번)?/g;
  return [...line.matchAll(re)].map((m) => ({
    registrationDate: read(m[1].replace(/\s+/g, "")),
    receiptNumber: read(m[2].replace(/\s+/g, "")),
    rank: read(m[3] ?? null),
  }));
}

/** 한글 서류 문단들 → 대조 항목 */
export function extractHwpFields(paragraphs: string[]): DocumentFields {
  const paras = paragraphs.map((p) => p.replace(/\s+/g, " ").trim());
  const at = (label: string) => paras.findIndex((p) => labelOf(p) === label);

  // 이전할 근저당권: 칸 이름 다음 줄, 채권최고액은 그다음 "(채권최고액 : 금 …원)" 줄
  const mi = at("이전할근저당권");
  const mortgageLine = mi === -1 ? undefined : nextFilled(paras, mi);
  const mortgages = parseMortgages(mortgageLine);
  const amountLine = mi === -1 ? undefined : paras.slice(mi + 1, mi + 4).find((p) => /채권최고액/.test(p));
  const amount = amountLine ? /채권최고액\s*:?\s*(금\s*[\d,]+\s*원)/.exec(amountLine)?.[1] : undefined;

  // 채권 양도인: 칸 이름 다음 줄 "회사명 (110111-0005078)". 번호는 앞 6자리만 남기고 뒷자리는 여기서 버린다.
  const ai = at("채권양도인");
  const assignorLine = ai === -1 ? undefined : nextFilled(paras, ai);
  const assignorName = assignorLine?.replace(/\(.*$/, "").trim();
  const idFront = assignorLine ? /\(\s*(\d{6})\s*-\s*[\d*]{7}\s*\)/.exec(assignorLine)?.[1] : undefined;

  // 채무자: 칸 이름 다음 줄 (주소 줄은 읽지 않는다)
  const di = at("채무자");
  const debtorLine = di === -1 ? undefined : nextFilled(paras, di);

  const properties = parseProperties(paras);
  return {
    parties: {
      mortgagee: splitNames(assignorName),
      debtor: splitNames(debtorLine && !/^\d{4}\s*년/.test(debtorLine) ? debtorLine : null),
    },
    properties: properties.length ? properties : [UNREAD_PROPERTY()],
    mortgages: mortgages.length ? mortgages : [UNREAD_MORTGAGE()],
    maxClaimAmount: read(amount?.replace(/\s+/g, " ")),
    mortgageeIdFront: read(idFront),
  };
}
