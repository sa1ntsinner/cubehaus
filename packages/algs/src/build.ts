import {
  F2L_CASES,
  f2lState,
  f2lTurned,
  mirrorAlg,
} from "@cubehaus/scramble/f2l-state";
import { lastLayerCases, stickersOf } from "@cubehaus/scramble/last-layer";
import {
  fromKey,
  type LastLayer,
  llKey,
  turnAfter,
} from "@cubehaus/scramble/last-layer-state";
import { COLL_WRITTEN } from "./candidates/coll";
import SEARCHED from "./candidates/coll-search.json";
import { OLL } from "./candidates/oll";
import { PLL } from "./candidates/pll";
import type { CaseSource } from "./candidates/types";
import { collCases } from "./coll";
import { collWords } from "./collwords";
import { type Metrics, metricsOf, tidy } from "./metrics";
import { noteFor } from "./notes";
import { caseOf, memberState, type SetId, verify, verifyF2l } from "./verify";

/**
 * Builds a set's shipped data from its candidates: each is verified (verify.ts), the
 * failures are dropped with their reason, the rest are ranked by score, then moves, then
 * text, and the best three kept. Test and build time only.
 */
export type BuiltAlg = { moves: string; auf: number; metrics: Metrics };
export type BuiltCase = {
  id: string;
  label: string;
  group: string;
  /** The case's member as its main algorithm expects it (llKey digits). */
  state: string;
  algs: BuiltAlg[];
  recognise: { en: string; ru: string } | null;
  subsets: string[];
};
export type BuiltSet = {
  set: SetId | "f2l" | "f2l-left" | "f2l-back" | "f2l-back-left";
  candidates: number;
  rejected: { label: string; alg: string; reason: string }[];
  cases: BuiltCase[];
};

type Entry = {
  id: string;
  key: string;
  label: string;
  group: string;
  subsets: string[];
};

const PLL_GROUPS: Record<string, string> = {
  Ua: "edges",
  Ub: "edges",
  H: "edges",
  Z: "edges",
  Aa: "corners",
  Ab: "corners",
  E: "corners",
  T: "adjacent",
  F: "adjacent",
  Ja: "adjacent",
  Jb: "adjacent",
  Ra: "adjacent",
  Rb: "adjacent",
  Ga: "g",
  Gb: "g",
  Gc: "g",
  Gd: "g",
  Na: "diagonal",
  Nb: "diagonal",
  V: "diagonal",
  Y: "diagonal",
};

/**
 * 2-look OLL: the three edge cases learnt first (a dot, a line, an L: OLL 2, 45 and 44, the
 * usual first-look algorithms), then the seven corner cases with a cross (21 to 27).
 */
const TWO_LOOK = [2, 44, 45, 21, 22, 23, 24, 25, 26, 27].map((n) => `OLL ${n}`);
/**
 * 2-look PLL: the corners first with T (two corners side by side) or Y (two across), then
 * the edges with Ua, Ub, H or Z.
 */
const TWO_LOOK_PLL = ["T", "Y", "Ua", "Ub", "H", "Z"];

function entriesOf(set: SetId): Entry[] {
  const { oll, pll } = lastLayerCases();
  if (set === "oll")
    return oll
      .filter((c) => c.label !== "OLL skip")
      .map((c) => ({
        id: c.id,
        key: c.id.slice(4),
        label: c.label,
        group: c.group,
        subsets: TWO_LOOK.includes(c.label) ? ["2-look"] : [],
      }));
  if (set === "coll")
    return collCases().map((c) => ({
      id: `coll-${c.key}`,
      key: c.key,
      label: c.label,
      group: c.group,
      subsets: [],
    }));
  if (set === "pll")
    return pll
      .filter((c) => c.label !== "PLL skip")
      .map((c) => ({
        id: c.id,
        key: c.id.slice(4),
        label: c.label,
        group: PLL_GROUPS[c.label] as string,
        subsets: TWO_LOOK_PLL.includes(c.label) ? ["2-look"] : [],
      }));
  throw new Error(`No entries for ${set} yet`);
}

const SOURCES: Record<SetId, readonly CaseSource[]> = {
  pll: PLL,
  oll: OLL,
  coll: [],
};

/**
 * COLL's candidates by case: what our search found (keyed by the case's key) and each
 * written algorithm under the case its inverse makes.
 */
async function collCandidates(
  rejected: BuiltSet["rejected"],
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const c of collCases())
    out[c.label] = [...((SEARCHED as Record<string, string[]>)[c.key] ?? [])];
  for (const alg of COLL_WRITTEN) {
    const key = await caseOf("coll", alg);
    const c = collCases().find((x) => x.key === key);
    if (c) out[c.label]?.unshift(tidy(alg));
    else
      rejected.push({
        label: "COLL",
        alg,
        reason: "solves no COLL case",
      });
  }
  return out;
}

/** `state` after `k` U turns before an algorithm: the state the algorithm then solves. */
export function turned(state: LastLayer, k: number): LastLayer {
  let s = state;
  for (let i = 0; i < k; i++) s = turnAfter(s);
  return s;
}

export async function buildSet(
  set: SetId,
  more: Readonly<Record<string, readonly string[]>> = {},
): Promise<BuiltSet> {
  let extra = more;
  const sources = SOURCES[set];
  const rejected: BuiltSet["rejected"] = [];
  let candidates = 0;
  if (set === "coll") {
    extra = { ...(await collCandidates(rejected)), ...extra };
    candidates += rejected.length;
  }
  const entries = entriesOf(set);
  const cases: BuiltCase[] = [];
  const failing: string[] = [];
  for (const entry of entries) {
    const source = sources.find((s) => s.label === entry.label);
    const written = (source?.algs ?? []).map(tidy);
    const all = [...new Set([...written, ...(extra[entry.label] ?? [])])];
    const kept: BuiltAlg[] = [];
    for (const alg of all) {
      candidates++;
      const verdict = await verify(set, entry.key, alg);
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
    const member = memberState(set, entry.key);
    const main = best[0];
    // Shown as the main algorithm expects it; every other algorithm's AUF is counted from
    // there.
    const base = main ? main.auf : 0;
    const shown = turned(member, base);
    const recognise =
      set === "coll" && main
        ? collWords(
            entry.group as Parameters<typeof collWords>[0],
            stickersOf(shown),
          )
        : source?.recognise && main
          ? { en: source.recognise.en, ru: source.recognise.ru }
          : null;
    if (source?.recognise && main && !source.recognise.check(stickersOf(shown)))
      failing.push(`${entry.label} (${stickersOf(shown)})`);
    cases.push({
      id: entry.id,
      label: entry.label,
      group: entry.group,
      state: llKey(shown),
      algs: best.map((a) => ({ ...a, auf: (a.auf - base + 4) % 4 })),
      recognise,
      subsets: entry.subsets,
    });
  }
  // Two cases of one shape whose words read the same are told apart by one pair of
  // corner stickers that match on one and on no twin; without such a pair, neither gets
  // words.
  if (set === "coll") {
    const pictures = new Map(
      cases.map((c) => [c, stickersOf(fromKey(c.state))] as const),
    );
    const first = new Map(cases.map((c) => [c, c.recognise?.en] as const));
    for (const c of cases) {
      const twins = cases.filter(
        (o) => o !== c && o.group === c.group && first.get(o) === first.get(c),
      );
      if (twins.length > 0)
        c.recognise = collWords(
          c.group as Parameters<typeof collWords>[0],
          pictures.get(c) as string,
          twins.map((o) => pictures.get(o) as string),
        );
    }
  }
  // PLL and OLL: one line of facts from the sticker model that tells the case from every
  // other case of the set met from any side (notes.ts).
  if (set === "pll" || set === "oll") {
    const pictures = new Map(
      cases.map((c) => {
        const state = fromKey(c.state);
        return [
          c,
          [0, 1, 2, 3].map((k) => stickersOf(turned(state, k))),
        ] as const;
      }),
    );
    for (const c of cases) {
      const others = cases
        .filter((o) => o !== c)
        .flatMap((o) => pictures.get(o) ?? []);
      const note = noteFor(set, pictures.get(c)?.[0] as string, others);
      c.recognise = note ? { en: note.en, ru: note.ru } : null;
    }
  }
  if (failing.length > 0)
    throw new Error(
      `${set}: explanations whose checks fail: ${failing.join(", ")}`,
    );
  return { set, candidates, rejected, cases };
}

/** The data file's text: a header with the counts, then the cases. */
export function render(built: BuiltSet): string {
  const lines = [
    "// Generated by packages/algs/src/algs.test.ts (ALGS_WRITE=1). Do not edit.",
    `// ${built.candidates} candidates, ${built.rejected.length} rejected:`,
    ...built.rejected.map((r) => `//   ${r.label}: ${r.alg} (${r.reason})`),
    'import type { TrainerCaseData } from "../types";',
    "",
    `export const ${built.set.replaceAll("-", "_").toUpperCase()}: readonly TrainerCaseData[] = ${JSON.stringify(
      built.cases,
      null,
      2,
    )};`,
    "",
  ];
  return lines.join("\n");
}

/**
 * F2L's shipped data for the front right slot (or, with slot `br`, the back right slot):
 * every case's searched candidates verified (verifyF2l), ranked as the other sets are,
 * the best three kept. The member is shown as the main algorithm expects it; a back case
 * keeps the front right state it stands for, a U turn being the same turn there.
 */
export async function buildF2l(
  searched: Readonly<Record<string, readonly string[]>>,
  slot: "fr" | "br" = "fr",
): Promise<BuiltSet> {
  const rejected: BuiltSet["rejected"] = [];
  let candidates = 0;
  const cases: BuiltCase[] = [];
  const prefix = slot === "br" ? "f2l-back-" : "f2l-";
  for (const c of F2L_CASES) {
    const kept: BuiltAlg[] = [];
    for (const alg of [...new Set((searched[c.key] ?? []).map(tidy))]) {
      candidates++;
      const verdict = await verifyF2l(c.key, alg, slot);
      if (verdict.ok)
        kept.push({ moves: alg, auf: verdict.auf, metrics: metricsOf(alg) });
      else rejected.push({ label: c.label, alg, reason: verdict.reason });
    }
    kept.sort(
      (a, b) =>
        a.metrics.score - b.metrics.score ||
        a.metrics.moves - b.metrics.moves ||
        (a.moves < b.moves ? -1 : a.moves > b.moves ? 1 : 0),
    );
    const best = kept.slice(0, 3);
    const base = best[0]?.auf ?? 0;
    const shown = f2lTurned(f2lState(c.key), base);
    cases.push({
      id: `${prefix}${c.key}`,
      label: c.label,
      group: c.group,
      state: `${shown.corner}${shown.twist}${shown.edge}${shown.flip}`,
      algs: best.map((a) => ({ ...a, auf: (a.auf - base + 4) % 4 })),
      recognise: null,
      subsets: [],
    });
  }
  return {
    set: slot === "br" ? "f2l-back" : "f2l",
    candidates,
    rejected,
    cases,
  };
}

/** The back right slot: buildF2l over the candidates our search found in R, U and B. */
export const buildF2lBack = (
  searched: Readonly<Record<string, readonly string[]>>,
) => buildF2l(searched, "br");

/**
 * A left slot's data from the right slot beside it (front left from front right, back
 * left from back right): each algorithm in the mirror (mirrorAlg), each verified on the
 * left slot (verifyF2l), in the same order and with the same picture turn, so case n
 * there is case n here. A left case keeps the state of the right case it mirrors; a U
 * turn in the mirror is U', so an algorithm's turn before it becomes 4 - auf. Its metrics
 * are the right one's: the same work for the other hand.
 */
export async function buildF2lLeft(right: BuiltSet): Promise<BuiltSet> {
  const back = right.set === "f2l-back";
  const from = back ? "f2l-back-" : "f2l-";
  const to = back ? "f2l-back-left-" : "f2l-left-";
  const rejected: BuiltSet["rejected"] = [];
  let candidates = 0;
  const cases: BuiltCase[] = [];
  for (const c of right.cases) {
    const key = c.id.slice(from.length);
    const algs: BuiltAlg[] = [];
    for (const alg of c.algs) {
      candidates++;
      const moves = mirrorAlg(alg.moves);
      const verdict = await verifyF2l(key, moves, back ? "bl" : "fl");
      if (verdict.ok)
        algs.push({ moves, auf: (4 - alg.auf) % 4, metrics: alg.metrics });
      else
        rejected.push({ label: c.label, alg: moves, reason: verdict.reason });
    }
    cases.push({ ...c, id: `${to}${key}`, algs });
  }
  return {
    set: back ? "f2l-back-left" : "f2l-left",
    candidates,
    rejected,
    cases,
  };
}
