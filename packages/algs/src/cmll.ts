import { cubeState } from "@cubehaus/cube";
import { stickersOf } from "@cubehaus/scramble/last-layer";
import {
  aufVariants,
  collKey,
  type LastLayer,
  llKey,
  parityOf,
} from "@cubehaus/scramble/last-layer-state";
import { Alg } from "cubing/alg";
import { KPattern, type KPuzzle } from "cubing/kpuzzle";
import { turned } from "./build";
import { collCases, collState } from "./coll";
import { collWords } from "./collwords";
import { faceColours } from "./facelets";
import { type Metrics, metricsOf, tidy } from "./metrics";
import {
  cornerIndex,
  type Full,
  fill,
  searchFrom,
  solved,
  type Tables,
  tables,
} from "./search";
import type { TrainerCaseData } from "./types";

/**
 * CMLL: the top layer's corners solved in one algorithm over two whole side blocks (the
 * left and the right 1 × 2 × 3 of the first two layers), as the Roux method leaves them.
 * The four top edges and the two bottom edges of the middle slice (DF, DB) are free: the
 * algorithm may leave them anywhere, flipped anyhow. A case is therefore the top corners'
 * places and twists alone, taken up to a U turn before and after the algorithm.
 *
 * The cases come from the group: 24 places × 27 twists of the four corners fall into 43
 * classes under the 16 pairs of U turns; the solved one is no case, 42 are left. Forty of
 * them are COLL's corner cases (the same keys, so they keep COLL's names); the other two
 * have every corner twisted right and two corners swapped, side by side or across (`O`).
 * Build and test time only (it needs cubing).
 */
export type CmllCase = { key: string; label: string; group: string };

const NO_EDGES = { ep: [0, 1, 2, 3], eo: [0, 0, 0, 0] };
const SOLVED_KEY = "01230000";
const GROUP_ORDER = ["O", "H", "Pi", "U", "T", "L", "S", "AS"];

/** The class key of the top corners, or null when they are solved up to a U turn. */
export function cmllKey(
  cp: readonly number[],
  co: readonly number[],
): string | null {
  const key = collKey({ ...NO_EDGES, cp, co });
  return key === SOLVED_KEY ? null : key;
}

let cases: CmllCase[] | undefined;

/** The 42 cases: `O` first, then COLL's shapes in COLL's order and under COLL's names. */
export function cmllCases(): CmllCase[] {
  if (cases) return cases;
  const perms: number[][] = [];
  const build = (prefix: number[]) => {
    if (prefix.length === 4) perms.push(prefix);
    else
      for (let p = 0; p < 4; p++)
        if (!prefix.includes(p)) build([...prefix, p]);
  };
  build([]);
  const keys = new Set<string>();
  for (const cp of perms)
    for (let t = 0; t < 81; t++) {
      const co = [27, 9, 3, 1].map((d) => Math.floor(t / d) % 3);
      if (co.reduce((a, b) => a + b, 0) % 3 !== 0) continue;
      const key = cmllKey(cp, co);
      if (key) keys.add(key);
    }
  const named = new Map(collCases().map((c) => [c.key, c]));
  const oriented = [...keys].filter((k) => k.endsWith("0000")).sort();
  const found: CmllCase[] = [...keys].map((key) => {
    const coll = named.get(key);
    if (coll) return { key, label: coll.label, group: coll.group };
    const n = oriented.indexOf(key);
    if (n < 0) throw new Error(`No CMLL name for ${key}`);
    return { key, label: `O ${n + 1}`, group: "O" };
  });
  const order = [...named.keys()];
  cases = found.sort(
    (a, b) =>
      GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
      order.indexOf(a.key) - order.indexOf(b.key) ||
      (a.key < b.key ? -1 : 1),
  );
  return cases;
}

/** A case's corners as a top layer (collState: the edges home, of matching parity). */
export const cmllState = (key: string): LastLayer => collState(key);

type Orbit = { pieces: number[]; orientation: number[] };
const dataOf = (p: KPattern) =>
  p.patternData as unknown as {
    CORNERS: Orbit;
    EDGES: Orbit;
    CENTERS?: Orbit;
  };

// cubing's places: edges UF UR UB UL DF DR DB DL FR FL BR BL. The blocks hold DR, DL and
// the four middle-layer edges; UF, UR, UB, UL, DF and DB are free.
const BLOCK_EDGES = [5, 7, 8, 9, 10, 11];
const FREE_EDGES = [0, 1, 2, 3, 4, 6];

/**
 * A cube with the top corners as given and both blocks whole. `free`: the six free edges'
 * pieces and flips, in the order of FREE_EDGES; home when left out.
 */
export function cmllPattern(
  puzzle: KPuzzle,
  top: { cp: readonly number[]; co: readonly number[] },
  free?: { pieces: readonly number[]; flips: readonly number[] },
): KPattern {
  const base = puzzle.defaultPattern().patternData;
  const pieces = [...Array(12).keys()];
  const flips = Array<number>(12).fill(0);
  FREE_EDGES.forEach((place, i) => {
    pieces[place] = free?.pieces[i] ?? place;
    flips[place] = free?.flips[i] ?? 0;
  });
  return new KPattern(puzzle, {
    ...base,
    CORNERS: {
      pieces: [...top.cp, 4, 5, 6, 7],
      orientation: [...top.co, 0, 0, 0, 0],
    },
    EDGES: { pieces, orientation: flips },
  });
}

const home = (o: Orbit, place: number) =>
  o.pieces[place] === place && o.orientation[place] === 0;

/** Both blocks whole and the centres home: only the top corners and free edges may be off. */
export function blocksWhole(pattern: KPattern): boolean {
  const d = dataOf(pattern);
  return (
    (d.CENTERS?.pieces.every((piece, place) => piece === place) ?? true) &&
    [4, 5, 6, 7].every((p) => home(d.CORNERS, p)) &&
    BLOCK_EDGES.every((p) => home(d.EDGES, p))
  );
}

/** The case a cube shows (blocks whole, the free edges anyhow), or null. */
export function cmllOf(pattern: KPattern): string | null {
  if (!blocksWhole(pattern)) return null;
  const d = dataOf(pattern);
  return cmllKey(
    d.CORNERS.pieces.slice(0, 4),
    d.CORNERS.orientation.slice(0, 4),
  );
}

/** The goal: blocks whole and every top corner in place after some U turn. */
export function cmllDone(pattern: KPattern): boolean {
  if (!blocksWhole(pattern)) return false;
  const d = dataOf(pattern);
  const cp = d.CORNERS.pieces.slice(0, 4);
  return (
    d.CORNERS.orientation.slice(0, 4).every((o) => o === 0) &&
    [0, 1, 2, 3].some((k) => cp.every((piece, i) => piece === (i + k) % 4))
  );
}

/** The corner stickers of a 21-letter top picture; every edge and the centre masked. */
const CORNER_STICKERS = [0, 2, 6, 8, 9, 11, 12, 14, 15, 17, 18, 20];
const cornersOnly = (picture: string) =>
  [...picture].map((l, i) => (CORNER_STICKERS.includes(i) ? l : ".")).join("");

/** The free edges mixed, to show an algorithm does not lean on where they are. */
const MIXED = { pieces: [3, 4, 0, 6, 2, 1], flips: [1, 0, 1, 1, 0, 1] };

export type Verdict = { ok: true; auf: number } | { ok: false; reason: string };

/**
 * Checks an algorithm against a case on two models. Forward, on cubing's: the case's
 * member, U turned 0 to 3 times (the algorithm's `auf`), then the algorithm: both blocks
 * whole and the corners solved up to a U turn, with the free edges home and with them
 * mixed. Backward: the inverse on a solved cube keeps the blocks and makes this very
 * case. And our own sticker model shows the same corner stickers after the inverse as
 * cubing does.
 */
export function verifyCmll(puzzle: KPuzzle, key: string, alg: string): Verdict {
  let parsed: Alg;
  try {
    parsed = new Alg(alg);
  } catch {
    return { ok: false, reason: "does not parse" };
  }
  const member = cmllState(key);
  let auf = -1;
  for (let k = 0; k < 4 && auf < 0; k++) {
    const pre = ["", "U", "U2", "U'"][k] as string;
    const from = (p: KPattern) => (pre ? p.applyAlg(pre) : p).applyAlg(parsed);
    if (
      cmllDone(from(cmllPattern(puzzle, member))) &&
      cmllDone(from(cmllPattern(puzzle, member, MIXED)))
    )
      auf = k;
  }
  if (auf < 0)
    return { ok: false, reason: "does not reach the goal from the case" };
  const inverse = parsed.invert().toString();
  const made = puzzle.defaultPattern().applyAlg(inverse);
  if (!blocksWhole(made))
    return { ok: false, reason: "its inverse breaks a block" };
  const got = cmllOf(made);
  if (got !== key)
    return { ok: false, reason: `its inverse makes ${got ?? "no case"}` };
  const s = cubeState(3, inverse);
  const ours = [
    s.U.join(""),
    ...(["F", "R", "B", "L"] as const).map((f) => s[f].slice(0, 3).join("")),
  ].join("");
  const d = dataOf(made);
  const f = faceColours(d.CORNERS, d.EDGES);
  const theirs = [
    (f.U as string[]).join(""),
    ...[..."FRBL"].map((face) => (f[face] as string[]).slice(0, 3).join("")),
  ].join("");
  if (cornersOnly(ours) !== cornersOnly(theirs))
    return { ok: false, reason: "the two cube models disagree" };
  return { ok: true, auf };
}

// The search, in R, U and F as the other sets'. Those turns move nine edges; four of them
// are block edges (DR, FR, FL, BR) and must come home, the other five are free.
const MOVED_EDGES = [0, 1, 2, 3, 4, 5, 8, 9, 10];
const MOVED_BLOCK_EDGES = [5, 8, 9, 10];
const BLOCK_SIZE = 9 * 8 * 7 * 6 * 16;
function blockIndex(s: Full): number {
  let index = 0;
  const used: number[] = [];
  let flips = 0;
  for (const piece of MOVED_BLOCK_EDGES) {
    const place = s.edges.pieces.indexOf(piece);
    const local = MOVED_EDGES.indexOf(place);
    const free = local - used.filter((u) => u < local).length;
    index = index * (9 - used.length) + free;
    used.push(local);
    flips = flips * 2 + (s.edges.orientation[place] as number);
  }
  return index * 16 + flips;
}

export type CmllTables = { base: Tables; block: Uint8Array };

/**
 * The bounds: the corners table of the COLL search (seven corners, solved up to a U turn)
 * and the four block edges' places and flips, filled backwards from the goal.
 */
export function cmllTables(puzzle: KPuzzle): CmllTables {
  const base = tables(puzzle, "solved");
  return {
    base,
    block: fill(BLOCK_SIZE, [solved()], blockIndex, base.moves),
  };
}

/**
 * Every algorithm of the fewest turns in R, U and F (and up to `extra` more) that takes
 * the corners `top` to the goal, up to `limit`. None begins or ends with U.
 */
export function searchCmll(
  t: CmllTables,
  top: LastLayer,
  options: { maxDepth: number; extra: number; limit: number },
): string[] {
  const start = solved();
  start.corners.pieces = [...top.cp, 4, 5, 6, 7];
  start.corners.orientation = [...top.co, 0, 0, 0, 0];
  return searchFrom(t.base, start, {
    ...options,
    bound: (s) =>
      Math.max(
        t.base.corner[cornerIndex(s)] as number,
        t.block[blockIndex(s)] as number,
      ),
  });
}

/** The search as the writer runs it: each of a case's four angles. */
export const CMLL_SEARCH = { maxDepth: 16, extra: 2, limit: 60 };
export function searchCase(t: CmllTables, key: string): string[] {
  const found = new Set<string>();
  for (let k = 0; k < 4; k++)
    for (const alg of searchCmll(t, turned(cmllState(key), k), CMLL_SEARCH))
      found.add(alg);
  return [...found];
}

/**
 * A drill cube for a case: the corners as any member of the class (a U turn before and
 * after), the six free edges placed and flipped at random so that turns can reach the
 * cube (flips even, edges of the corners' parity), the centres home.
 */
export function cmllDrawn(
  puzzle: KPuzzle,
  key: string,
  rng: () => number,
): KPattern {
  const variants = aufVariants(cmllState(key));
  const top = variants[Math.floor(rng() * variants.length)] as LastLayer;
  const order = [0, 1, 2, 3, 4, 5];
  for (let i = 5; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  if (parityOf(order) !== parityOf(top.cp))
    [order[0], order[1]] = [order[1] as number, order[0] as number];
  const flips = order.map(() => Math.floor(rng() * 2));
  if (flips.reduce((a, b) => a + b, 0) % 2 === 1)
    flips[5] = 1 - (flips[5] as number);
  return cmllPattern(puzzle, top, {
    pieces: order.map((i) => FREE_EDGES[i] as number),
    flips,
  });
}

/** A scramble that reaches a drawn cube: cubing's solution of it, inverted. */
export async function cmllScramble(
  puzzle: KPuzzle,
  key: string,
  rng: () => number,
  solve: (p: KPattern) => Promise<Alg>,
): Promise<string> {
  const target = cmllDrawn(puzzle, key, rng);
  const scramble = tidy((await solve(target)).invert().toString());
  if (!puzzle.defaultPattern().applyAlg(scramble).isIdentical(target))
    throw new Error("The scramble does not reach the drawn cube");
  return scramble;
}

export type CmllCaseData = TrainerCaseData & { scrambles: string[] };
export type BuiltCmll = {
  candidates: number;
  rejected: { label: string; alg: string; reason: string }[];
  cases: CmllCaseData[];
};

/**
 * The set's data from the candidates our search found and the drill scrambles: each
 * candidate verified, ranked by score, then turns, then text, the best three kept. A case
 * is shown as its main algorithm expects it; the others' U turns are counted from there.
 * The words are COLL's, read from the corner stickers of the picture.
 */
export function buildCmll(
  puzzle: KPuzzle,
  searched: Readonly<Record<string, readonly string[]>>,
  scrambles: Readonly<Record<string, readonly string[]>>,
): BuiltCmll {
  const rejected: BuiltCmll["rejected"] = [];
  let candidates = 0;
  const built: CmllCaseData[] = [];
  const pictures = new Map<CmllCaseData, string>();
  for (const entry of cmllCases()) {
    const kept: { moves: string; auf: number; metrics: Metrics }[] = [];
    for (const alg of [...new Set((searched[entry.key] ?? []).map(tidy))]) {
      candidates++;
      const verdict = verifyCmll(puzzle, entry.key, alg);
      if (verdict.ok)
        kept.push({ moves: alg, auf: verdict.auf, metrics: metricsOf(alg) });
      else rejected.push({ label: entry.label, alg, reason: verdict.reason });
    }
    kept.sort(
      (a, b) =>
        a.metrics.score - b.metrics.score ||
        a.metrics.moves - b.metrics.moves ||
        (a.moves < b.moves ? -1 : a.moves > b.moves ? 1 : 0),
    );
    const best = kept.slice(0, 3);
    const base = best[0]?.auf ?? 0;
    const shown = turned(cmllState(entry.key), base);
    const data: CmllCaseData = {
      id: `cmll-${entry.key}`,
      label: entry.label,
      group: entry.group,
      state: llKey(shown),
      algs: best.map((a) => ({ ...a, auf: (a.auf - base + 4) % 4 })),
      recognise: collWords(entry.group as "O", stickersOf(shown)),
      subsets: [],
      scrambles: [...(scrambles[entry.key] ?? [])],
    };
    pictures.set(data, stickersOf(shown));
    built.push(data);
  }
  // Two cases of one shape whose words read the same are told apart by a pair of corner
  // stickers of one colour, as in COLL; without such a pair the case gets no words.
  const first = new Map(built.map((c) => [c, c.recognise?.en] as const));
  for (const c of built) {
    const twins = built.filter(
      (o) => o !== c && o.group === c.group && first.get(o) === first.get(c),
    );
    if (twins.length > 0)
      c.recognise = collWords(
        c.group as "O",
        pictures.get(c) as string,
        twins.map((o) => pictures.get(o) as string),
      );
  }
  return { candidates, rejected, cases: built };
}

export function renderCmll(built: BuiltCmll): string {
  return [
    "// Generated by packages/algs/src/algs.test.ts (ALGS_WRITE=1). Do not edit.",
    `// ${built.candidates} candidates from our own search, ${built.rejected.length} rejected:`,
    ...built.rejected.map((r) => `//   ${r.label}: ${r.alg} (${r.reason})`),
    'import type { TrainerCaseData } from "../types";',
    "",
    `export const CMLL: readonly TrainerCaseData[] = ${JSON.stringify(
      built.cases,
      null,
      2,
    )};`,
    "",
  ].join("\n");
}
