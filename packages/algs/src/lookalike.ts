import { cornerPairs } from "./collwords";
import { pictureOf, trainerSet } from "./index";
import { recolour } from "./show";
import type { SetId, TrainerCaseData } from "./types";

/**
 * Cases a person can take for one another, from our own sticker model, nearest first.
 *
 * - PLL is recognised from two sides. Every way the case can be met (four U turns, four
 *   colours in front) shows six side stickers on the front and right; two cases look alike
 *   by how many of those views are one sticker away from a view of the other.
 * - OLL: cases with the same top (which stickers face up, up to a U turn) and different
 *   sides, nearest by how many side stickers differ.
 * - COLL: cases of the same corner shape, nearest by how many sides read differently by
 *   their two corner stickers (headlights, two opposite or two neighbouring colours, as the
 *   recognition words read them), up to a U turn; twins the words cannot tell apart are 0.
 * - F2L: none (the pair's place says which case it is).
 *
 * The relation is symmetric: B is among A's look-alikes exactly when A is among B's.
 */
const cache = new Map<SetId, ReadonlyMap<string, readonly string[]>>();

export function lookalikes(set: SetId): ReadonlyMap<string, readonly string[]> {
  const known = cache.get(set);
  if (known) return known;
  const cases = trainerSet(set);
  const near =
    set === "pll"
      ? pllNear(cases)
      : set === "oll" || set === "coll"
        ? sideNear(set)
        : () => null;
  const map = new Map<string, string[]>();
  cases.forEach((a, i) => {
    const found: [number, number, string][] = [];
    cases.forEach((b, j) => {
      if (i === j) return;
      const score = near(a, b);
      if (score !== null) found.push([score, j, b.id]);
    });
    map.set(
      a.id,
      found.sort((x, y) => x[0] - y[0] || x[1] - y[1]).map((x) => x[2]),
    );
  });
  cache.set(set, map);
  return map;
}

const turns = [0, 1, 2, 3];
const SIDES = ["F", "R", "B", "L"] as const;
/** The sides whose two corner stickers read differently (`cornerPairs`). */
const readsApart = (a: string, b: string) => {
  const pa = cornerPairs(a);
  const pb = cornerPairs(b);
  return SIDES.filter((side) => pa[side] !== pb[side]).length;
};
const differ = (a: string, b: string, from: number, to: number) => {
  let d = 0;
  for (let i = from; i < to; i++) if (a[i] !== b[i]) d++;
  return d;
};

/** Lower is nearer: minus the number of two-side views one sticker apart. */
function pllNear(cases: readonly TrainerCaseData[]) {
  const views = new Map(
    cases.map((c) => {
      const seen = new Set<string>();
      for (const t of turns)
        for (const k of turns)
          seen.add(recolour(pictureOf(c, t), k).slice(9, 15));
      return [c.id, [...seen]] as const;
    }),
  );
  return (a: TrainerCaseData, b: TrainerCaseData) => {
    let n = 0;
    for (const v of views.get(a.id) ?? [])
      for (const w of views.get(b.id) ?? []) if (differ(v, w, 0, 6) === 1) n++;
    return n > 0 ? -n : null;
  };
}

/** The side stickers that differ, for a case with the same top; null for another top. */
function sideNear(set: "oll" | "coll") {
  const up = (p: string) => [...p].map((c) => (c === "U" ? "U" : "x")).join("");
  const shown = (p: string) => (set === "oll" ? up(p) : p);
  return (a: TrainerCaseData, b: TrainerCaseData) => {
    if (set === "coll" && a.group !== b.group) return null;
    const pa = shown(pictureOf(a));
    let best: number | null = null;
    for (const t of turns) {
      const pb = shown(pictureOf(b, t));
      if (up(pa).slice(0, 9) !== up(pb).slice(0, 9)) continue;
      const d = set === "oll" ? differ(pa, pb, 9, 21) : readsApart(pa, pb);
      if (best === null || d < best) best = d;
    }
    return best;
  };
}
