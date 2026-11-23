import { metricsOf } from "./metrics";
import { applyTwo, SOLVED, type Two } from "./two";
import {
  classesOf,
  composeTwo,
  membersOf,
  stateFromKey,
  stateKey,
  type TwoSet,
  upright,
} from "./two-cases";
import { layerKind, twoNoteRaw } from "./two-notes";
import { distances, SOLVED_UP_TO_U, scrambleTo, solveTwo } from "./two-search";
import type { TrainerCaseData } from "./types";

/**
 * The 2×2 sets' shipped data, every algorithm and scramble from our own search
 * (two-search.ts) on our own model (two.ts). Build and test time only.
 *
 * For each case (two-cases.ts) every state of it that a turn of the top before the
 * algorithm can show is searched, for the shortest algorithms in R, U and F and those a
 * turn longer; they are ranked by the same score as the 3×3 sets (metrics.ts) and the
 * best three kept. The picture shows the case as its best algorithm expects it. Eight
 * drill scrambles lead to states of the case from a solved cube, each the reverse of a
 * shortest way back, drawn at random (a fixed seed, so the build is the same every time).
 */

const U_TURNS = ["", "U", "U2", "U'"] as const;
const turnU = (k: number) => applyTwo(SOLVED, U_TURNS[k] as string);
const turnD = (k: number) =>
  applyTwo(SOLVED, ["", "D", "D2", "D'"][k] as string);

/** The goal an algorithm of the set reaches: both faces one colour, or solved. */
export function goalOf(set: TwoSet): readonly Two[] {
  return set === "two-oll" ? membersOf("two-pbl") : SOLVED_UP_TO_U;
}

const LABEL: Record<TwoSet, string> = {
  "two-oll": "OLL",
  "two-pbl": "PBL",
  "two-cll": "CLL",
};

function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

/** A class's states as full states (OLL classes are the top's twists alone). */
const statesOf = (set: TwoSet, keys: readonly string[]) =>
  keys.map((k) =>
    set === "two-oll"
      ? {
          cp: [0, 1, 2, 3, 4, 5, 6, 7],
          co: [...k].map(Number).concat([0, 0, 0, 0]),
        }
      : stateFromKey(k),
  );

type Ranked = {
  moves: string;
  auf: number;
  metrics: ReturnType<typeof metricsOf>;
};
const byScore = (a: Ranked, b: Ranked) =>
  a.metrics.score - b.metrics.score ||
  a.metrics.moves - b.metrics.moves ||
  (a.moves < b.moves ? -1 : a.moves > b.moves ? 1 : 0);

/** A state of the case drawn at random, as a drill shows it. */
function drawMember(set: TwoSet, shown: Two, rng: () => number): Two {
  const pick = (n: number) => Math.floor(rng() * n);
  let s = composeTwo(shown, turnU(pick(4)));
  if (set === "two-oll") {
    // Any places for the pieces: the twists alone make the case.
    const shuffle = (items: number[]) => {
      for (let i = items.length - 1; i > 0; i--) {
        const j = pick(i + 1);
        [items[i], items[j]] = [items[j] as number, items[i] as number];
      }
      return items;
    };
    const top = shuffle([0, 1, 2, 3]);
    const low = shuffle([4, 5, 7]);
    s = {
      cp: [...top, low[0], low[1], 6, low[2]] as number[],
      co: [...s.co],
    };
    return s;
  }
  s = composeTwo(turnU(pick(4)), s);
  if (set === "two-pbl")
    s = upright(composeTwo(composeTwo(turnD(pick(4)), s), turnD(pick(4))));
  return s;
}

export type BuiltTwo = {
  set: TwoSet;
  candidates: number;
  cases: (TrainerCaseData & { scrambles: string[] })[];
};

export function buildTwo(
  set: TwoSet,
  tables?: { goal: Uint8Array; exact: Uint8Array },
): BuiltTwo {
  const goal = tables?.goal ?? distances(goalOf(set));
  const exact = tables?.exact ?? distances([SOLVED]);
  const classes = classesOf(set).slice(1);
  let candidates = 0;
  const built = classes.map((keys) => {
    // Every state of the case, each with its best algorithms from it as it stands.
    let best: { shown: Two; algs: Ranked[] } | null = null;
    for (const s of statesOf(set, keys)) {
      const algs = solveTwo(goal, s, { extra: 1, limit: 60 }).map((moves) => ({
        moves,
        auf: 0,
        metrics: metricsOf(moves),
      }));
      algs.sort(byScore);
      const top = algs[0];
      if (!top) continue;
      if (
        !best ||
        byScore(top, best.algs[0] as Ranked) < 0 ||
        (byScore(top, best.algs[0] as Ranked) === 0 &&
          stateKey(s) < stateKey(best.shown))
      )
        best = { shown: s, algs };
    }
    if (!best) throw new RangeError(`${set}: a case with no algorithm`);
    // The case as its best algorithm expects it, and the others from each turn of the top.
    const ranked: Ranked[] = [];
    for (let k = 0; k < 4; k++) {
      const from = composeTwo(best.shown, turnU(k));
      for (const moves of solveTwo(goal, from, { extra: 1, limit: 60 })) {
        candidates++;
        ranked.push({ moves, auf: k, metrics: metricsOf(moves) });
      }
    }
    ranked.sort(byScore);
    const kept: Ranked[] = [];
    for (const a of ranked)
      if (!kept.some((k) => k.moves === a.moves) && kept.length < 3)
        kept.push(a);
    return { shown: best.shown, keys, algs: kept };
  });
  // Our own order: fewer turns first, then the state.
  built.sort(
    (a, b) =>
      byScore(a.algs[0] as Ranked, b.algs[0] as Ranked) ||
      (stateKey(a.shown) < stateKey(b.shown) ? -1 : 1),
  );
  // A note is kept only where no other case shows the same words from any side.
  const seenNotes = built.map(
    (c) => new Set(statesOf(set, c.keys).map((s) => twoNoteRaw(set, s).en)),
  );
  const noteOf = (i: number, shown: Two) => {
    const note = twoNoteRaw(set, shown);
    return seenNotes.some((notes, j) => j !== i && notes.has(note.en))
      ? null
      : note;
  };
  const rng = seeded(set.length * 7919);
  const cases = built.map((c, i) => {
    const label = `${LABEL[set]} ${i + 1}`;
    const scrambles: string[] = [];
    for (let n = 0; n < 8; n++)
      scrambles.push(scrambleTo(exact, drawMember(set, c.shown, rng), rng()));
    return {
      id: `${set}-${stateKey(c.shown)}`,
      label,
      group: groupOf(set, c.shown),
      state: stateKey(c.shown),
      algs: c.algs,
      recognise: noteOf(i, c.shown),
      subsets: [],
      scrambles,
    };
  });
  return { set, candidates, cases };
}

/** The case's group: how many top stickers face up (OLL), each layer's kind (PBL). */
export function groupOf(set: TwoSet, s: Two): string {
  const up = s.co.slice(0, 4).filter((o) => o === 0).length;
  if (set === "two-oll") return `${up} up`;
  if (set === "two-cll") return up === 4 ? "oriented" : `${up} up`;
  const kind = (layer: "top" | "bottom") =>
    ({ 4: "whole", 1: "bar", 0: "none" })[layerKind(s, layer)];
  return `${kind("top")}-${kind("bottom")}`;
}

/** The data file's text. */
export function renderTwo(built: BuiltTwo): string {
  const name = built.set.replaceAll("-", "_").toUpperCase();
  return [
    "// Generated by packages/algs/src/two-build.test.ts (ALGS_WRITE=1). Do not edit.",
    `// ${built.candidates} candidates from our own search.`,
    'import type { TrainerCaseData } from "../types";',
    "",
    `export const ${name}: readonly (TrainerCaseData & { scrambles: readonly string[] })[] = ${JSON.stringify(
      built.cases,
      null,
      2,
    )};`,
    "",
  ].join("\n");
}
