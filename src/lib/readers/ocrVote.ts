// Design Ref: DESIGN.md §4.4 — 같은 등기부를 여러 번 읽어 값마다 다수결로 정한다.
// 글자 읽기 결과가 읽을 때마다 조금씩 다를 수 있어서(무작위 실수), 과반이 같게 읽은 값만 쓴다.
// 과반이 없거나, 과반이 "불확실"이라고 한 값은 불확실로 둔다 → 대조에서 「확인 필요」.
// 외부 서비스를 부르지 않는 순수 함수다.

import type { OcrValue, RegistryMortgage, RegistryRead, RegistryTransfer } from "./registryOcr";

/**
 * 다수결 비교용: 띄어쓰기·쉼표와 낱개 기호(', |, _ 등 스캔 얼룩이 글자로 읽힌 것)만 무시하고 글자·숫자·점·붙임표·㎡는 그대로 비교한다.
 * 글자는 하나도 고치지 않는다. (예: "주식회사'차카타은행"과 "주식회사 차카타은행"은 같은 표기로 센다)
 * 한자는 어차피 대조 전에 지워지므로 여기서도 글자로 세지 않는다.
 */
const voteKey = (v: OcrValue) => (v.text === null ? "\u0000null" : v.text.replace(/[^\p{Script=Hangul}\p{N}a-zA-Z.\-㎡]/gu, ""));

/** 기호 같은 군더더기 글자 수 (적을수록 깨끗하게 읽힌 표기) */
const strayCount = (text: string | null) => (text === null ? 0 : (text.match(/[^\p{L}\p{N}\s,.()㎡-]/gu) ?? []).length);

/** 같은 표기로 센 읽기들 중 대표 하나: 불확실 표시 없는 것 → 군더더기 적은 것 → 먼저 읽은 것 */
function representative(group: OcrValue[]): OcrValue {
  return [...group].sort((a, b) => Number(a.uncertain) - Number(b.uncertain) || strayCount(a.text) - strayCount(b.text))[0];
}

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
    text: representative(best).text,
    // 과반이 같게 읽었고, 그 읽기 중 "절반 초과"가 확신 낮음일 때만 불확실 (정확히 절반이면 같게 읽은 쪽을 믿는다, 2026-11-05 사용자 결정)
    uncertain: !majority || flagged * 2 > best.length,
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

/** 글자 하나 차이(같은 길이에서 한 글자만 다름)인지: 같은 이름을 잘못 읽은 것으로 본다 (예: 조모의/소모의) */
function oneCharApart(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 1) return false;
  return true;
}

/**
 * 이름 목록(소유자·채무자) 다수결: 이름마다 따로 센다.
 * 읽을 때마다 한 명씩 빠뜨리기도 해서, 목록 길이 대신 "그 이름이 나온 읽기 횟수"로 정한다.
 * - 한 글자만 다른 표기는 같은 이름의 오독으로 묶고, 가장 많이 나온 표기를 쓴다.
 * - 과반의 읽기에 나온 이름만 넣는다. 그 표기 자체가 과반이 아니면(오독과 갈림) 불확실.
 * - 과반은 아니지만 2번 이상 나온 이름은 불확실로 넣는다 → 그 역할 전체가 「확인 필요」 (빠뜨려서 「불일치」로 단정하지 않게).
 */
export function voteNameList(lists: OcrValue[][]): OcrValue[] {
  const n = lists.length;
  if (n === 1) return lists[0];
  type Cluster = { spellings: Map<string, { value: OcrValue; reads: Set<number>; flagged: number }>; reads: Set<number>; firstPos: number };
  const clusters: Cluster[] = [];
  lists.forEach((list, readIdx) => {
    list.forEach((value, pos) => {
      if (value.text === null) return;
      const key = voteKey(value);
      let c = clusters.find((cl) => [...cl.spellings.keys()].some((k) => k === key || oneCharApart(k, key)));
      if (!c) {
        c = { spellings: new Map(), reads: new Set(), firstPos: pos };
        clusters.push(c);
      }
      c.firstPos = Math.min(c.firstPos, pos);
      c.reads.add(readIdx);
      if (!c.spellings.has(key)) c.spellings.set(key, { value, reads: new Set(), flagged: 0 });
      const sp = c.spellings.get(key)!;
      sp.reads.add(readIdx);
      if (value.uncertain) sp.flagged++;
    });
  });
  return clusters
    .filter((c) => c.reads.size >= 2)
    .sort((a, b) => a.firstPos - b.firstPos)
    .map((c) => {
      const [best] = [...c.spellings.values()].sort((a, b) => b.reads.size - a.reads.size);
      const clusterMajority = c.reads.size * 2 > n;
      const spellingMajority = best.reads.size * 2 > n;
      return { text: best.value.text, uncertain: !clusterMajority || !spellingMajority || best.flagged * 2 > best.reads.size };
    });
}

function voteTransfer(items: RegistryTransfer[]): RegistryTransfer {
  return {
    rank: items[0].rank,
    receiptNumber: voteValue(items.map((t) => t.receiptNumber)),
    registrationDate: voteValue(items.map((t) => t.registrationDate)),
    assignee: voteValue(items.map((t) => t.assignee)),
    assigneeIdFront: voteValue(items.map((t) => t.assigneeIdFront)),
  };
}
const unsureTransfer = (t: RegistryTransfer): RegistryTransfer => ({
  ...t,
  receiptNumber: unsure(t.receiptNumber),
  registrationDate: unsure(t.registrationDate),
  assignee: unsure(t.assignee),
  assigneeIdFront: unsure(t.assigneeIdFront),
});

function voteMortgage(items: RegistryMortgage[]): RegistryMortgage {
  return {
    rank: items[0].rank,
    receiptNumber: voteValue(items.map((m) => m.receiptNumber)),
    registrationDate: voteValue(items.map((m) => m.registrationDate)),
    maxClaimAmount: voteValue(items.map((m) => m.maxClaimAmount)),
    mortgagee: voteValue(items.map((m) => m.mortgagee)),
    mortgageeIdFront: voteValue(items.map((m) => m.mortgageeIdFront)),
    debtors: voteNameList(items.map((m) => m.debtors)),
    transfers: voteList(items.map((m) => m.transfers), voteTransfer, unsureTransfer),
  };
}
const unsureMortgage = (m: RegistryMortgage): RegistryMortgage => ({
  ...m,
  receiptNumber: unsure(m.receiptNumber),
  registrationDate: unsure(m.registrationDate),
  maxClaimAmount: unsure(m.maxClaimAmount),
  mortgagee: unsure(m.mortgagee),
  mortgageeIdFront: unsure(m.mortgageeIdFront),
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
    owners: voteNameList(reads.map((r) => r.owners)),
    mortgages: voteList(reads.map((r) => r.mortgages), voteMortgage, unsureMortgage),
  };
}
