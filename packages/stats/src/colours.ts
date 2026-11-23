import { statOf } from "./average";

/**
 * Colour neutrality: which colour the next cross is built on, and how far each colour is
 * behind the best one. Pure and seeded, so the same history and scramble always give the
 * same colour (a reload shows what was shown).
 *
 * A colour's average is the app's own trimmed average (ao, `statOf`) over its last 24
 * solves, or over all of them from 12 to 23. The trimmed average, not the mean: a single
 * DNF or pop would swing a mean of 24 by several per cent and make a colour flip between
 * "there" and "not there"; the ao drops it, the same way every other average in the app
 * does, so the gap reads like the numbers the person already knows.
 */
export const ASSIGN = {
  /** Solves of one colour in a row while blocks are on. */
  block: 12,
  /** Solves of a colour its average reads at most. */
  window: 24,
  /** Solves of a colour before it has an average. */
  least: 12,
  /** Blocks give way to a mix once every colour is within this of the best. */
  mixWithin: 0.25,
  /** A colour within this of the best counts as there: the base weight in the mix. */
  thereWithin: 0.1,
  /** In the mix, never one colour more times in a row than this. */
  maxRun: 3,
  /** Weight in the mix: 1, plus this for each 1.0 of gap beyond `thereWithin`. */
  gapWeight: 10,
} as const;

/** One solve: its cross colour and its result in ms (a DNF is Infinity). */
export type ColourEntry<C extends string> = { colour: C; value: number };

/** The ao over a colour's last 24 results, or all of 12–23; NaN under 12. */
export function colourAverage(values: readonly number[]): number {
  const n = Math.min(values.length, ASSIGN.window);
  if (n < ASSIGN.least) return Number.NaN;
  return statOf(values.slice(-n), { kind: "ao", n });
}

/**
 * Each colour's average over the best colour's, less one (0.22 is 22 % slower). A colour
 * with no finite average, or when no colour has one, is infinitely far.
 */
export function colourGaps<C extends string>(
  averages: ReadonlyMap<C, number>,
): Map<C, number> {
  let best = Infinity;
  for (const value of averages.values())
    if (Number.isFinite(value) && value < best) best = value;
  const gaps = new Map<C, number>();
  for (const [colour, value] of averages)
    gaps.set(
      colour,
      Number.isFinite(value) && Number.isFinite(best)
        ? value / best - 1
        : Infinity,
    );
  return gaps;
}

function averagesOf<C extends string>(
  history: readonly ColourEntry<C>[],
  colours: readonly C[],
): Map<C, number> {
  const values = new Map<C, number[]>(colours.map((colour) => [colour, []]));
  for (const { colour, value } of history) values.get(colour)?.push(value);
  return new Map(
    colours.map((colour) => [colour, colourAverage(values.get(colour) ?? [])]),
  );
}

/** A small seeded generator (mulberry32): one number in [0, 1) per seed. */
function unit(seed: number): number {
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
}

/** A stable 32-bit seed for a text (FNV-1a), such as the scramble on screen. */
export function seedOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The colour for the next solve. `colours` are the colours in play, the main one first;
 * `history` the session's solves with a colour, oldest first (others are ignored).
 *
 * Blocks: a run of one colour goes on to 12; then the colour furthest behind takes the
 * next block, never the one just done (with nothing known, the first colour in play).
 * Mixed, once every colour is within 25 % of the best: a weighted pick, weight 1 within
 * 10 % of the best and 1 + 10 × (gap − 0.10) beyond, never a colour more than 3 times in
 * a row.
 */
export function assignColour<C extends string>({
  colours,
  history,
  seed,
}: {
  colours: readonly C[];
  history: readonly ColourEntry<C>[];
  seed: number;
}): { colour: C; stage: "block" | "mixed" } {
  const first = colours[0];
  if (first === undefined) throw new RangeError("No colour in play");
  if (colours.length === 1) return { colour: first, stage: "block" };
  const inPlay = history.filter((entry) => colours.includes(entry.colour));
  const gaps = colourGaps(averagesOf(inPlay, colours));
  const last = inPlay.at(-1)?.colour;
  let runLength = 0;
  for (let i = inPlay.length - 1; i >= 0 && inPlay[i]?.colour === last; i--)
    runLength++;
  const gap = (colour: C) => gaps.get(colour) ?? Infinity;
  const mixed = colours.every((colour) => gap(colour) <= ASSIGN.mixWithin);

  if (!mixed) {
    if (last !== undefined && runLength < ASSIGN.block)
      return { colour: last, stage: "block" };
    let next = first;
    let furthest = -1;
    for (const colour of colours) {
      if (colour === last) continue;
      if (gap(colour) > furthest) {
        furthest = gap(colour);
        next = colour;
      }
    }
    return { colour: next, stage: "block" };
  }

  const open = colours.filter(
    (colour) => !(colour === last && runLength >= ASSIGN.maxRun),
  );
  const weights = open.map((colour) =>
    gap(colour) <= ASSIGN.thereWithin
      ? 1
      : 1 + ASSIGN.gapWeight * (gap(colour) - ASSIGN.thereWithin),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let pick = unit(seed) * total;
  for (const [index, colour] of open.entries()) {
    pick -= weights[index] as number;
    if (pick < 0) return { colour, stage: "mixed" };
  }
  return { colour: open.at(-1) as C, stage: "mixed" };
}

export type ColourStanding<C extends string> = {
  colour: C;
  /** Solves of this colour. */
  count: number;
  /** How many of the latest its average reads (0: none yet). */
  n: number;
  average: number;
  gap: number;
};

/** Each colour asked for, with its count, average and gap to the best colour. */
export function colourSummary<C extends string>(
  history: readonly ColourEntry<C>[],
  colours: readonly C[],
): ColourStanding<C>[] {
  const averages = averagesOf(history, colours);
  const gaps = colourGaps(averages);
  return colours.map((colour) => {
    const count = history.filter((entry) => entry.colour === colour).length;
    const n = Math.min(count, ASSIGN.window);
    return {
      colour,
      count,
      n: n >= ASSIGN.least ? n : 0,
      average: averages.get(colour) ?? Number.NaN,
      gap: gaps.get(colour) ?? Infinity,
    };
  });
}

/**
 * Each colour's gap to the best colour after every solve (`index` in `history`), from the
 * first solve at which two colours have an average.
 */
export function gapTrend<C extends string>(
  history: readonly ColourEntry<C>[],
  colours: readonly C[],
): Map<C, { index: number; gap: number }[]> {
  const values = new Map<C, number[]>(colours.map((colour) => [colour, []]));
  const averages = new Map<C, number>(
    colours.map((colour) => [colour, Number.NaN]),
  );
  const trend = new Map<C, { index: number; gap: number }[]>(
    colours.map((colour) => [colour, []]),
  );
  for (const [index, { colour, value }] of history.entries()) {
    const list = values.get(colour);
    if (!list) continue;
    list.push(value);
    averages.set(colour, colourAverage(list));
    let known = 0;
    for (const average of averages.values())
      if (Number.isFinite(average)) known++;
    if (known < 2) continue;
    for (const [each, gap] of colourGaps(averages))
      if (Number.isFinite(gap)) trend.get(each)?.push({ index, gap });
  }
  return trend;
}
