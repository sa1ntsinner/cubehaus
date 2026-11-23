import { applyTwo, SOLVED, sameTwo, type Two } from "./two";

/**
 * The 2×2 trainer's cases, counted from our model (two.ts), not from memory.
 *
 * - `two-oll`: the bottom face one colour, the top's twists to fix. A case is the top's
 *   twists up to a turn of the top before the algorithm; the pieces' places do not matter
 *   (a twist moves with its place whatever piece is there).
 * - `two-pbl`: both faces one colour, both layers' pieces to put in place. A case is a
 *   state up to turns of the top and the bottom before and after, and to the cube held
 *   another way (turned about the vertical, or upside down).
 * - `two-cll`: the bottom layer whole, the top to solve in one go. A case is a state up to
 *   a turn of the top before and after; holding the cube another way about the vertical
 *   is one of those (with the bottom whole, a y turn moves the top as a U turn does).
 * - `two-adj`, `two-diag`: the bottom one colour, its pieces needing a swap of two side by
 *   side (one bar on the bottom's sides) or across (no bar), the top to solve with it in
 *   one go. A case is a state up to a turn of the top before and after, a turn of the
 *   bottom after, and the cube held another way about the vertical (which is how the
 *   bottom's bar is put where the algorithm wants it).
 */

export type TwoSet = "two-oll" | "two-pbl" | "two-cll" | "two-adj" | "two-diag";

/** The sets whose bottom is one colour but needs its pieces swapped. */
export const BOTTOM_SWAP = ["two-adj", "two-diag"] as const;
const isSwap = (set: TwoSet) => set === "two-adj" || set === "two-diag";

/** a then b: the state after a's turns, then b's. */
export function composeTwo(a: Two, b: Two): Two {
  return {
    cp: b.cp.map((from) => a.cp[from] as number),
    co: b.cp.map(
      (from, i) => ((a.co[from] as number) + (b.co[i] as number)) % 3,
    ),
  };
}

export function inverseTwo(s: Two): Two {
  const cp = new Array<number>(8);
  const co = new Array<number>(8);
  s.cp.forEach((from, i) => {
    cp[from] = i;
    co[from] = (3 - (s.co[i] as number)) % 3;
  });
  return { cp, co };
}

const turn = (alg: string) => applyTwo(SOLVED, alg);
const U = turn("U");
const D = turn("D");
/** Whole-cube turns as the two layers turned together (a 2×2 has no middle). */
const Y = turn("U D'");
const X2 = turn("R2 L2");

/** The 24 ways to hold the cube, as whole-cube turns. */
const HOLDS: readonly Two[] = (() => {
  const out: Two[] = [SOLVED];
  for (let i = 0; i < out.length; i++)
    for (const r of [Y, turn("R L'"), turn("F B'")]) {
      const next = composeTwo(out[i] as Two, r);
      if (!out.some((o) => sameTwo(o, next))) out.push(next);
    }
  return out;
})();
export const HOLD_COUNT = HOLDS.length;

/** The same position held with the DBL corner home and upright: our states' frame. */
export function upright(s: Two): Two {
  for (const r of HOLDS) {
    const held = composeTwo(s, r);
    if (held.cp[6] === 6 && held.co[6] === 0) return held;
  }
  throw new RangeError("No hold puts the DBL corner home");
}

const keyOf = (s: Two) => `${s.cp.join("")}${s.co.join("")}`;
export const stateKey = keyOf;
export function stateFromKey(key: string): Two {
  if (!/^[0-7]{8}[0-2]{8}$/.test(key)) throw new RangeError(`No state ${key}`);
  return {
    cp: [...key.slice(0, 8)].map(Number),
    co: [...key.slice(8)].map(Number),
  };
}

/** The bottom's pieces in order round the bottom: 4 bars on its sides, one, or none. */
export function bottomBars(s: Two): 0 | 1 | 4 {
  const places = [4, 5, 6, 7];
  let bars = 0;
  for (let i = 0; i < 4; i++) {
    const a = (s.cp[places[i] as number] as number) - 4;
    const b = (s.cp[places[(i + 1) % 4] as number] as number) - 4;
    if ((((b - a) % 4) + 4) % 4 === 1) bars++;
  }
  return bars as 0 | 1 | 4;
}

const bottomWhole = (s: Two) =>
  [4, 5, 6, 7].every((p) => s.cp[p] === p && s.co[p] === 0);
const bottomOneColour = (s: Two) =>
  [4, 5, 6, 7].every((p) => (s.cp[p] as number) >= 4 && s.co[p] === 0);
const facesOneColour = (s: Two) =>
  bottomOneColour(s) && [0, 1, 2, 3].every((p) => s.co[p] === 0);

/** The states a set's cases are made of, every one of them. */
export function membersOf(set: TwoSet): Two[] {
  const out: Two[] = [];
  const perms = (items: number[]): number[][] =>
    items.length <= 1
      ? [items]
      : items.flatMap((x, i) =>
          perms([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [
            x,
            ...rest,
          ]),
        );
  const twists: number[][] = [];
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 3; b++)
      for (let c = 0; c < 3; c++) twists.push([a, b, c, (6 - a - b - c) % 3]);
  if (set === "two-pbl") {
    for (const top of perms([0, 1, 2, 3]))
      for (const low of perms([4, 5, 7]))
        out.push({
          cp: [...top, low[0], low[1], 6, low[2]] as number[],
          co: [0, 0, 0, 0, 0, 0, 0, 0],
        });
    return out;
  }
  if (isSwap(set)) {
    // The bottom's pieces with DBL home (our frame), one bar or none on its sides.
    const want = set === "two-adj" ? 1 : 0;
    const lows = perms([4, 5, 7])
      .map((low) => [low[0], low[1], 6, low[2]] as number[])
      .filter(
        (low) => bottomBars({ cp: [0, 1, 2, 3, ...low], co: [] }) === want,
      );
    for (const low of lows)
      for (const top of perms([0, 1, 2, 3]))
        for (const co of twists)
          out.push({ cp: [...top, ...low], co: [...co, 0, 0, 0, 0] });
    return out;
  }
  for (const top of set === "two-cll" ? perms([0, 1, 2, 3]) : [[0, 1, 2, 3]])
    for (const co of twists)
      out.push({ cp: [...top, 4, 5, 6, 7], co: [...co, 0, 0, 0, 0] });
  return out;
}

/** The states one move of the set's equivalence leads to (before or after the algorithm). */
function neighbours(set: TwoSet, s: Two): Two[] {
  if (set === "two-oll") return [composeTwo(s, U)];
  const out = [composeTwo(s, U), composeTwo(U, s)];
  if (isSwap(set))
    out.push(
      upright(composeTwo(s, D)),
      upright(composeTwo(composeTwo(inverseTwo(Y), s), Y)),
    );
  if (set === "two-pbl")
    out.push(
      upright(composeTwo(s, D)),
      upright(composeTwo(D, s)),
      upright(composeTwo(composeTwo(inverseTwo(Y), s), Y)),
      upright(composeTwo(composeTwo(X2, s), X2)),
    );
  return out;
}

/** The orientation the set cares about: OLL only sees the top's twists. */
const seen = (set: TwoSet, s: Two) =>
  set === "two-oll" ? s.co.slice(0, 4).join("") : keyOf(s);

/**
 * The classes of a set's states: each a list of the states it holds (as the set sees
 * them), the class holding the solved goal first.
 */
export function classesOf(set: TwoSet): string[][] {
  const members = membersOf(set);
  const index = new Map<string, number>();
  for (const m of members)
    if (!index.has(seen(set, m))) index.set(seen(set, m), -1);
  const classes: string[][] = [];
  for (const m of members) {
    const first = seen(set, m);
    if ((index.get(first) as number) >= 0) continue;
    const id = classes.length;
    const found: string[] = [];
    const queue: Two[] = [m];
    index.set(first, id);
    while (queue.length > 0) {
      const s = queue.pop() as Two;
      found.push(seen(set, s));
      for (const n of neighbours(set, s)) {
        const k = seen(set, n);
        if (!index.has(k))
          throw new RangeError(`${set}: ${keyOf(s)} leads out of the set`);
        if (index.get(k) === -1) {
          index.set(k, id);
          queue.push(n);
        }
      }
    }
    classes.push(found.sort());
  }
  const goal = seen(set, SOLVED);
  classes.sort((a, b) => Number(b.includes(goal)) - Number(a.includes(goal)));
  return classes;
}

export const inSet = (set: TwoSet, s: Two) =>
  set === "two-oll"
    ? bottomOneColour(s)
    : set === "two-pbl"
      ? facesOneColour(s)
      : set === "two-adj"
        ? bottomOneColour(s) && bottomBars(s) === 1
        : set === "two-diag"
          ? bottomOneColour(s) && bottomBars(s) === 0
          : bottomWhole(s);

/** What the set sees of a state, the key its class is found by. */
export const seenKey = seen;
