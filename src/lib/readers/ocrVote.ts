// Design Ref: DESIGN.md §4.4 — 같은 등기부를 여러 번 읽어 값마다 다수결로 정한다.
// 글자 읽기 결과가 읽을 때마다 조금씩 다를 수 있어서(무작위 실수), 과반이 같게 읽은 값만 쓴다.
// 과반이 없거나, 과반이 "불확실"이라고 한 값은 불확실로 둔다 → 대조에서 「확인 필요」.
// 외부 서비스를 부르지 않는 순수 함수다.

import type { OcrValue, RegistryMortgage, RegistryRead, RegistryTransfer } from "./registryOcr";

/** 다수결 비교용: 띄어쓰기만 무시하고 글자 그대로 비교 */
const voteKey = (v: OcrValue) => (v.text === null ? "\u0000null" : v.text.replace(/\s+/g, ""));

/** 값 하나를 다수결로 정한다 */
export function voteValue(values: OcrValue[]): OcrValue {
  const n = values.length;
  if (n === 1) return values[0];
  const groups = new Map<string, OcrValue[]>();
  for (const v of values) {
    const k = voteKey(v);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(v);
  }
  const [best] = [...groups.values()].sort((a, b) => b.length - a.length);
  const majority = best.length * 2 > n;
  const flagged = best.filter((v) => v.uncertain).length;
  return {
    text: best[0].text,
    uncertain: !majority || flagged * 2 >= best.length,
  };
}

/** 목록 여러 개를 맞춰 다수결: 가장 많이 나온 길이의 목록들만 위치대로 비교 */
function voteList<T>(lists: T[][], merge: (items: T[]) => T, markUncertain: (item: T) => T): T[] {
  const n = lists.length;
  const byLen = new Map<number, T[][]>();
  for (const l of lists) {
    if (!byLen.has(l.length)) byLen.set(l.length, []);
    byLen.get(l.length)!.push(l);
  }
  const [same] = [...byLen.values()].sort((a, b) => b.length - a.length);
  const majority = same.length * 2 > n;
  const len = same[0].length;
  const out: T[] = [];
  for (let i = 0; i < len; i++) {
    const merged = merge(same.map((l) => l[i]));
    // 목록 길이부터 과반이 없으면 무엇이 맞는지 모르므로 모두 불확실
    out.push(majority ? merged : markUncertain(merged));
  }
  return out;
}

const unsure = (v: OcrValue): OcrValue => ({ ...v, uncertain: true });

function voteTransfer(items: RegistryTransfer[]): RegistryTransfer {
  return {
    rank: items[0].rank,
    receiptNumber: voteValue(items.map((t) => t.receiptNumber)),
    registrationDate: voteValue(items.map((t) => t.registrationDate)),
    assignee: voteValue(items.map((t) => t.assignee)),
  };
}
const unsureTransfer = (t: RegistryTransfer): RegistryTransfer => ({
  ...t,
  receiptNumber: unsure(t.receiptNumber),
  registrationDate: unsure(t.registrationDate),
  assignee: unsure(t.assignee),
});

function voteMortgage(items: RegistryMortgage[]): RegistryMortgage {
  return {
    rank: items[0].rank,
    receiptNumber: voteValue(items.map((m) => m.receiptNumber)),
    registrationDate: voteValue(items.map((m) => m.registrationDate)),
    maxClaimAmount: voteValue(items.map((m) => m.maxClaimAmount)),
    mortgagee: voteValue(items.map((m) => m.mortgagee)),
    debtors: voteList(items.map((m) => m.debtors), voteValue, unsure),
    transfers: voteList(items.map((m) => m.transfers), voteTransfer, unsureTransfer),
  };
}
const unsureMortgage = (m: RegistryMortgage): RegistryMortgage => ({
  ...m,
  receiptNumber: unsure(m.receiptNumber),
  registrationDate: unsure(m.registrationDate),
  maxClaimAmount: unsure(m.maxClaimAmount),
  mortgagee: unsure(m.mortgagee),
  debtors: m.debtors.map(unsure),
  transfers: m.transfers.map(unsureTransfer),
});

type Prop = RegistryRead["properties"][number];
const voteProp = (items: Prop[]): Prop => ({
  location: voteValue(items.map((p) => p.location)),
  lotNumber: voteValue(items.map((p) => p.lotNumber)),
  unitNumber: voteValue(items.map((p) => p.unitNumber)),
  area: voteValue(items.map((p) => p.area)),
});
const unsureProp = (p: Prop): Prop => ({
  location: unsure(p.location),
  lotNumber: unsure(p.lotNumber),
  unitNumber: unsure(p.unitNumber),
  area: unsure(p.area),
});

/** 여러 번 읽은 결과를 하나로 합친다 */
export function voteRegistryReads(reads: RegistryRead[]): RegistryRead {
  if (reads.length === 0) throw new Error("읽은 결과가 없습니다.");
  if (reads.length === 1) return reads[0];
  return {
    properties: voteList(reads.map((r) => r.properties), voteProp, unsureProp),
    owners: voteList(reads.map((r) => r.owners), voteValue, unsure),
    mortgages: voteList(reads.map((r) => r.mortgages), voteMortgage, unsureMortgage),
  };
}
