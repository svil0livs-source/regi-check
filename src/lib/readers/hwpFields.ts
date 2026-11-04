// Design Ref: DESIGN.md §4.2 — 한글 신청서 글자에서 대조 항목 13개를 뽑는다. (PLAN 7번)
// 칸 제목(라벨) 바로 아래 문단들을 그 칸의 값으로 본다. 찾지 못한 항목은 추측하지 않고 null(읽지 못함).
// 주민등록번호 등 대조 항목이 아닌 정보는 뽑지 않는다.
// ⚠ 지금 라벨은 시험용 가짜 서류(scripts/fixtures) 형식에 맞춘 것이다. 실제 신청서로 꼭 다시 맞춰야 한다.

import type { DocumentFields, ExtractedValue, PropertyEntry } from "@/types/verification";

/** 칸 제목 → 내부 이름 */
const LABELS: Record<string, string> = {
  "이전등기 접수": "transfer",
  "부동산의 표시": "properties",
  "등기의 목적": "purpose",
  "이전할 근저당권": "original",
  "채권최고액": "maxClaimAmount",
  "채무자": "debtor",
  "소유자": "owner",
  "등기의무자 (양도인, 근저당권자)": "mortgagee",
  "등기권리자 (양수인)": "assignee",
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** 라벨별로 아래 문단들을 모은다. 다음 라벨이 나오면 끊는다. */
function sections(paragraphs: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string | null = null;
  for (const p of paragraphs.map(norm)) {
    if (p in LABELS) {
      current = LABELS[p];
      out.set(current, []);
      continue;
    }
    if (p.startsWith("건 번호:")) {
      current = null;
      continue;
    }
    if (current && p) out.get(current)!.push(p);
  }
  return out;
}

const read = (value: string | undefined | null): ExtractedValue => ({ value: value ?? null });

/** "2026년 7월 19일 접수 제71426호" → 날짜, 번호 */
function dateAndReceipt(line: string | undefined): { date: string | null; receipt: string | null } {
  if (!line) return { date: null, receipt: null };
  const m = /^(.+?)\s*접수\s*(제\s*[\d-]+\s*호)/.exec(line);
  return m ? { date: m[1].trim(), receipt: m[2].replace(/\s+/g, "") } : { date: null, receipt: null };
}

/** "서울특별시 마포구 공덕동 45-6 제2층 제201호 (면적 59.82㎡)" → 소재지·지번·호수·면적 */
function parseProperty(line: string): PropertyEntry {
  const m = /^(.+?[동리가로])\s+(\d+(?:-\d+)?)(?:\s+(.+?))?\s*\(면적\s*(.+?)\)$/.exec(line);
  if (!m) {
    // 형식을 모르면 칸을 나누지 않는다 (추측 금지) → 모두 읽지 못함
    return { location: read(null), lotNumber: read(null), unitNumber: read(null), area: read(null) };
  }
  return {
    location: read(m[1]),
    lotNumber: read(m[2]),
    unitNumber: read(m[3] ?? ""), // 호수가 없는 토지는 원래 빈칸
    area: read(m[4]),
  };
}

const names = (lines: string[] | undefined): ExtractedValue[] =>
  (lines ?? []).flatMap((l) => l.split(/\s*,\s*/)).filter(Boolean).map((n) => read(n));

/** 한글 신청서 문단들 → 대조 항목 */
export function extractHwpFields(paragraphs: string[]): DocumentFields {
  const s = sections(paragraphs);
  const transfer = dateAndReceipt(s.get("transfer")?.[0]);
  const original = dateAndReceipt(s.get("original")?.[0]);

  return {
    parties: {
      mortgagee: names(s.get("mortgagee")),
      assignee: names(s.get("assignee")),
      debtor: names(s.get("debtor")),
      owner: names(s.get("owner")),
    },
    properties: (s.get("properties") ?? []).map(parseProperty),
    maxClaimAmount: read(s.get("maxClaimAmount")?.[0]),
    receiptNumber: read(original.receipt),
    transferReceiptNumber: read(transfer.receipt),
    registrationDate: read(original.date),
    transferRegistrationDate: read(transfer.date),
  };
}
