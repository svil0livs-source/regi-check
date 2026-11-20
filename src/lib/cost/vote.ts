// 비용 청구 검증: 스캔 페이지를 손질 방법을 바꿔 여러 번 읽은 결과를 맞춰 본다 (근이전 검증의 다수결과 같은 생각, 2026-11-20).
// - 금액을 하나도 찾지 못한 읽기(표 배치를 잘못 잡아 줄이 끊어진 경우)는 빠진다(기권).
// - 남은 읽기 중 과반수가 같은 (항목 종류, 금액)을 내고 그 수가 2 이상이면 그 결과를 쓴다.
//   금액 불확실 표시는 그 결과를 낸 읽기가 모두 불확실하다고 할 때만 남긴다(같은 값을 다른 읽기가 또렷하게 읽었으면 믿는다).
// - 그렇지 않으면(서로 다르거나 한 번만 읽힘) 첫 읽기를 쓰고 모든 금액을 「확인 필요」로 둔다.
import type { ClaimRead, CostAmount, Receipt } from "./types";

const amountSig = (a: CostAmount | null) => (a ? String(a.value) : "-");

export function receiptsSignature(rs: Receipt[]): string {
  return JSON.stringify(rs.map((r) => [r.items.map((i) => `${i.category}:${amountSig(i.amount)}`), amountSig(r.total)]));
}

export function claimSignature(c: ClaimRead): string {
  return JSON.stringify([c.items.map((i) => `${i.category}:${amountSig(i.amount)}`), amountSig(c.total)]);
}

function pick<T>(reads: T[], sig: (t: T) => string): T[] {
  const groups = new Map<string, T[]>();
  for (const r of reads) groups.set(sig(r), [...(groups.get(sig(r)) ?? []), r]);
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  return best.length >= 2 && best.length * 2 > reads.length ? best : [];
}

/** 같은 자리 금액들의 불확실 표시를 합친다: 같은 값을 낸 읽기가 모두 불확실할 때만 불확실 */
const mergeFlag = (flags: boolean[]) => flags.every(Boolean);

export function voteReceipts(all: Receipt[][]): Receipt[] {
  const reads = all.filter((rs) => rs.some((r) => r.items.length > 0));
  if (reads.length === 0) return all[0] ?? [];
  const best = pick(reads, receiptsSignature);
  if (best.length === 0) {
    return reads[0].map((r) => ({
      ...r,
      uncertain: true,
      items: r.items.map((i) => ({ ...i, amount: { ...i.amount, uncertain: true } })),
      notes: [...r.notes, reads.length === 1 ? "한 번만 읽혀 다른 읽기로 확인하지 못함" : "읽을 때마다 금액이 달라 확인 필요"],
    }));
  }
  const base = best[0];
  return base.map((r, ri) => {
    const items = r.items.map((it, ii) => ({ ...it, amount: { ...it.amount, uncertain: mergeFlag(best.map((b) => b[ri].items[ii].amount.uncertain)) } }));
    const total = r.total ? { ...r.total, uncertain: mergeFlag(best.map((b) => b[ri].total?.uncertain ?? true)) } : null;
    const issuer = majority(best.map((b) => b[ri].issuer));
    const date = majority(best.map((b) => b[ri].date));
    const otherUncertain = best.every((b) => b[ri].notes.length > 0) && r.notes.length > 0;
    return { ...r, items, total, issuer, date, uncertain: items.some((i) => i.amount.uncertain) || !!total?.uncertain || otherUncertain };
  });
}

export function voteClaim(all: ClaimRead[]): ClaimRead {
  const reads = all.filter((c) => c.items.length > 0 || c.total !== null);
  if (reads.length === 0) return all[0] ?? { items: [], total: null };
  const best = pick(reads, claimSignature);
  if (best.length === 0) {
    const r = reads[0];
    return { items: r.items.map((i) => ({ ...i, amount: { ...i.amount, uncertain: true } })), total: r.total ? { ...r.total, uncertain: true } : null };
  }
  const base = best[0];
  return {
    items: base.items.map((it, i) => ({ ...it, amount: { ...it.amount, uncertain: mergeFlag(best.map((b) => b.items[i].amount.uncertain)) } })),
    total: base.total ? { ...base.total, uncertain: mergeFlag(best.map((b) => b.total?.uncertain ?? true)) } : null,
  };
}

function majority<T>(values: T[]): T | null {
  const counts = new Map<string, { v: T; n: number }>();
  for (const v of values) {
    const k = JSON.stringify(v);
    counts.set(k, { v, n: (counts.get(k)?.n ?? 0) + 1 });
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  return best && best.n * 2 > values.length ? best.v : null;
}
