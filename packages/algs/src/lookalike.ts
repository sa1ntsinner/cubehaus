import { cornerPairs } from "./collwords";
import { lastSlotTop, pictureOf } from "./pictures";
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
 * - Last slot: cases with the same corners up, nearest by how many side stickers differ
 *   (up or not); the pair stands where the case puts it, so no U turn.
 * - The 2×2's top in one go (CLL, and with the bottom swapped side by side or across):
 *   cases with the same top up to a U turn, nearest by how many sides of each layer read
 *   differently by their two stickers (a pair, opposite or neighbouring colours, or which
 *   of them shows the top's colour).
 * - F2L, the 2×2's OLL and PBL: none (the picture alone says which case it is).
 *
 * The relation is symmetric: B is among A's look-alikes exactly when A is among B's.
 */
const cache = new WeakMap<
  readonly TrainerCaseData[],
  ReadonlyMap<string, readonly string[]>
>();

export function lookalikesFor(
  set: SetId,
  cases: readonly TrainerCaseData[],
): ReadonlyMap<string, readonly string[]> {
  const known = cache.get(cases);
  if (known) return known;
  const near =
    set === "pll"
      ? pllNear(cases)
      : set === "oll" || set === "coll" || set === "cmll"
        ? sideNear(set)
        : set === "ls-right" || set === "ls-front"
          ? lastSlotNear
          : set === "two-cll" || set === "two-adj" || set === "two-diag"
            ? twoNear
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
  cache.set(cases, map);
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
function sideNear(set: "oll" | "coll" | "cmll") {
  const up = (p: string) => [...p].map((c) => (c === "U" ? "U" : "x")).join("");
  const shown = (p: string) => (set === "oll" ? up(p) : p);
  return (a: TrainerCaseData, b: TrainerCaseData) => {
    if (set !== "oll" && a.group !== b.group) return null;
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

const upMask = (p: string) =>
  [...p].map((c) => (c === "U" ? "U" : "x")).join("");

/** Last slot: the same corners up on top, then the side stickers that differ. */
function lastSlotNear(a: TrainerCaseData, b: TrainerCaseData): number | null {
  const pa = upMask(lastSlotTop(a));
  const pb = upMask(lastSlotTop(b));
  if (pa.slice(0, 9) !== pb.slice(0, 9)) return null;
  return differ(pa, pb, 9, 21);
}

const OPPOSITE: Record<string, string> = { F: "B", B: "F", R: "L", L: "R" };
/** How a side's two stickers read: which show the top's colour, else their colours. */
function reading(a: string, b: string): string {
  if (a === "U" || b === "U")
    return `${a === "U" ? "U" : "-"}${b === "U" ? "U" : "-"}`;
  return a === b ? "pair" : OPPOSITE[a] === b ? "opposite" : "neighbours";
}
/** Each side's reading, the top layer's four, then the bottom's where drawn. */
function readings(p: string): string[] {
  const out: string[] = [];
  for (let at = 4; at + 1 < p.length; at += 2)
    out.push(reading(p[at] as string, p[at + 1] as string));
  return out;
}

/** The 2×2: the same top up to a U turn, then the sides that read differently. */
function twoNear(a: TrainerCaseData, b: TrainerCaseData): number | null {
  const pa = pictureOf(a);
  const ra = readings(pa);
  let best: number | null = null;
  for (const t of turns) {
    const pb = pictureOf(b, t);
    if (upMask(pa.slice(0, 4)) !== upMask(pb.slice(0, 4))) continue;
    const rb = readings(pb);
    const d = ra.filter((r, i) => r !== rb[i]).length;
    if (best === null || d < best) best = d;
  }
  return best;
}
