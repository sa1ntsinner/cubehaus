import { type AttemptLike, caseMedian, median, WEAK } from "./schedule";

/**
 * What Review holds today, in the order that helps most:
 *
 * 1. Due: cases whose spaced-repetition card is due, earliest first.
 * 2. Slow: cases whose recent times (the last five clean attempts, from three) are far
 *    above the person's own median for the set (the median of the cases' medians, from
 *    three cases), more than 1.25 times; slowest first.
 * 3. Missed: two misses among the case's last five attempts.
 *
 * and each case followed at once by its nearest look-alike in the pool (`lookalikes`), so
 * the two are told apart while both are fresh. Ties follow an order drawn from `seed`,
 * so a given day's Review is the same each time it is opened.
 */
export type ReviewCounts = { due: number; slow: number; missed: number };
export type ReviewQueue = { order: string[]; counts: ReviewCounts };

export function reviewQueue(input: {
  caseIds: readonly string[];
  cards: readonly { caseId: string; dueAt: number }[];
  attempts: readonly AttemptLike[];
  now: number;
  lookalikes: ReadonlyMap<string, readonly string[]>;
  seed: number;
}): ReviewQueue {
  const { caseIds, cards, attempts, now, lookalikes, seed } = input;
  const pool = new Set(caseIds);
  const rank = new Map(seededOrder(caseIds, seed).map((id, i) => [id, i]));
  const tie = (a: string, b: string) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0);

  const due = cards
    .filter((c) => pool.has(c.caseId) && c.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt || tie(a.caseId, b.caseId))
    .map((c) => c.caseId);
  const taken = new Set(due);

  const medians = new Map<string, number>();
  for (const id of caseIds) {
    const m = caseMedian(attempts, id);
    if (m !== null) medians.set(id, m);
  }
  const setMedian = medians.size >= 3 ? median([...medians.values()]) : null;
  const slow: { id: string; ratio: number }[] = [];
  const missed: string[] = [];
  for (const id of caseIds) {
    if (taken.has(id)) continue;
    const mine = attempts.filter((a) => a.caseId === id);
    if (mine.slice(-5).filter((a) => a.missed).length >= 2) {
      missed.push(id);
      continue;
    }
    const recent = mine
      .filter((a) => !a.missed)
      .slice(-5)
      .map((a) => a.execMs);
    if (setMedian && recent.length >= 3) {
      const ratio = (median(recent) as number) / setMedian;
      if (ratio > WEAK) slow.push({ id, ratio });
    }
  }
  slow.sort((a, b) => b.ratio - a.ratio || tie(a.id, b.id));
  missed.sort(tie);

  const order: string[] = [];
  const placed = new Set<string>();
  for (const id of [...due, ...slow.map((s) => s.id), ...missed]) {
    if (placed.has(id)) continue;
    order.push(id);
    placed.add(id);
    const twin = (lookalikes.get(id) ?? []).find(
      (other) => pool.has(other) && !placed.has(other),
    );
    if (twin) {
      order.push(twin);
      placed.add(twin);
    }
  }
  return {
    order,
    counts: { due: due.length, slow: slow.length, missed: missed.length },
  };
}

/** The ids in an order drawn from `seed` (mulberry32), the same for the same seed. */
export function seededOrder(ids: readonly string[], seed: number): string[] {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j] as string, out[i] as string];
  }
  return out;
}
