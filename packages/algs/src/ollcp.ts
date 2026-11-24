import { cubeState } from "@cubehaus/cube";
import {
  lastLayerCases,
  lastLayerOf,
  stickersOf,
} from "@cubehaus/scramble/last-layer";
import {
  aufVariants,
  fromKey,
  isOriented,
  type LastLayer,
  llKey,
  ollKey,
  parityOf,
} from "@cubehaus/scramble/last-layer-state";
import { Alg } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { turned } from "./build";
import { type Metrics, metricsOf, tidy } from "./metrics";
import { searchLL, type Tables } from "./search";
import type { OllcpCaseData } from "./types";
import { patternOf, type Verdict } from "./verify";

/**
 * OLLCP: the last layer oriented and its corners put in place by one algorithm, so only
 * an edge cycle (U, H, Z or none) is left. A case is the edges' flips with the corners'
 * places and twists, taken up to a U turn before and after the algorithm; where the edges
 * stand does not count.
 *
 * The cases come from the group: 8 flips × 24 corner places × 27 twists are 5184 states
 * (the edges' places follow the corners' parity and are left out), which fall into 332
 * classes under the 16 pairs of U turns. The solved one is no case; 331 are left. In 329
 * of them something is twisted or flipped: each OLL case splits by its corners' places
 * into six, or into four when a half turn of the top leaves its pattern as it was (OLL 1,
 * 21, 55, 56, 57), or into three when a quarter turn does (OLL 20). The other two have
 * nothing to orient, only two corners swapped, side by side or across: the OLL skip's
 * two. The cases with a cross (OLL 21 to 27) are COLL's 40, under the same corner keys.
 * Build and test time only.
 */
const digits = (values: readonly number[]) => values.join("");

/** The class key: flips, corner places and twists in their least form over the 16 AUFs. */
export function ollcpKey(state: LastLayer): string {
  let best = "";
  for (const v of aufVariants(state)) {
    const key = `${digits(v.eo)}${digits(v.cp)}${digits(v.co)}`;
    if (best === "" || key < best) best = key;
  }
  return best;
}

const cyclic = (cp: readonly number[]) =>
  [0, 1, 2, 3].some((k) => cp.every((piece, i) => piece === (i + k) % 4));

/** The goal: everything oriented and every corner in place after some U turn. */
export const ollcpDone = (state: LastLayer) =>
  isOriented(state) && cyclic(state.cp);

/** A case: any last layer that is not at the goal already. */
export const isOllcpState = (state: LastLayer) => !ollcpDone(state);

/** A member of a case: its flips and corners, the edges home or two swapped by parity. */
export function ollcpState(key: string): LastLayer {
  const at = (from: number) => [...key.slice(from, from + 4)].map(Number);
  const cp = at(4);
  return {
    ep: parityOf(cp) === 0 ? [0, 1, 2, 3] : [1, 0, 2, 3],
    eo: at(0),
    cp,
    co: at(8),
  };
}

const PERMS: number[][] = [];
const build = (prefix: number[]) => {
  if (prefix.length === 4) PERMS.push(prefix);
  else
    for (let p = 0; p < 4; p++) if (!prefix.includes(p)) build([...prefix, p]);
};
build([]);

/** Every class key, the solved one among them. */
export function ollcpClasses(): string[] {
  const keys = new Set<string>();
  for (let bits = 0; bits < 16; bits++) {
    const eo = [8, 4, 2, 1].map((b) => (bits & b ? 1 : 0));
    if (eo.reduce((a: number, b) => a + b, 0) % 2 !== 0) continue;
    for (let t = 0; t < 81; t++) {
      const co = [27, 9, 3, 1].map((d) => Math.floor(t / d) % 3);
      if (co.reduce((a, b) => a + b, 0) % 3 !== 0) continue;
      for (const cp of PERMS)
        keys.add(ollcpKey({ ep: [0, 1, 2, 3], eo, cp, co }));
    }
  }
  return [...keys].sort();
}

export type OllcpCase = {
  key: string;
  /** `OLL 27-1`: the OLL case, then our own order of its corners' places (by key). */
  label: string;
  /** The OLL case it belongs to, 1 to 57 in this repository's numbering; 0: the skip. */
  oll: number;
  /** The OLL case's label, `OLL 27` or `OLL skip`: the group for a list. */
  group: string;
};

let cases: OllcpCase[] | undefined;

/**
 * The 331 cases by OLL number (the skip's two last), then by key. The OLL case is read
 * from the existing OLL cases by the orientation pattern; the number after it is our own
 * order, which for the cross cases is COLL's (the key's corner part is COLL's key).
 */
export function ollcpCases(): OllcpCase[] {
  if (cases) return cases;
  const groups = new Map(
    lastLayerCases().oll.map((c) => {
      const number = /^OLL (\d+)$/.exec(c.label)?.[1];
      return [
        c.id.slice(4),
        { oll: number ? Number(number) : 0, group: c.label },
      ] as const;
    }),
  );
  const last = (oll: number) => (oll === 0 ? 58 : oll);
  const found = ollcpClasses()
    .filter((key) => isOllcpState(ollcpState(key)))
    .map((key) => {
      const group = groups.get(ollKey(ollcpState(key)));
      if (!group) throw new Error(`No OLL case for ${key}`);
      return { key, ...group };
    })
    .sort((a, b) => last(a.oll) - last(b.oll) || (a.key < b.key ? -1 : 1));
  const counts = new Map<number, number>();
  cases = found.map((c) => {
    const n = (counts.get(c.oll) ?? 0) + 1;
    counts.set(c.oll, n);
    return { ...c, label: `${c.group}-${n}` };
  });
  return cases;
}

/** The edges elsewhere (three of them cycled), to show an algorithm does not lean on them. */
const mixed = (s: LastLayer): LastLayer => ({
  ...s,
  ep: [
    s.ep[1] as number,
    s.ep[2] as number,
    s.ep[0] as number,
    s.ep[3] as number,
  ],
});

function stickerTop(alg: string): string {
  const s = cubeState(3, alg);
  return [
    ...s.U,
    ...s.F.slice(0, 3),
    ...s.R.slice(0, 3),
    ...s.B.slice(0, 3),
    ...s.L.slice(0, 3),
  ].join("");
}

/**
 * Checks an algorithm against a case on two models. Forward, on cubing's: the case's
 * member, U turned 0 to 3 times (the algorithm's `auf`), then the algorithm: the first two
 * layers whole, everything oriented and the corners in place up to a U turn, with the
 * edges as the member has them and with three of them cycled. Backward: the inverse on a
 * solved cube keeps the first two layers and makes this very case. And our own sticker
 * model shows the same top stickers after the inverse as cubing does.
 */
export function verifyOllcp(
  puzzle: KPuzzle,
  key: string,
  alg: string,
): Verdict {
  let parsed: Alg;
  try {
    parsed = new Alg(alg);
  } catch {
    return { ok: false, reason: "does not parse" };
  }
  const member = ollcpState(key);
  const reaches = (start: LastLayer, pre: string) => {
    const from = patternOf(puzzle, start);
    try {
      return ollcpDone(
        lastLayerOf((pre ? from.applyAlg(pre) : from).applyAlg(parsed)),
      );
    } catch {
      return false;
    }
  };
  let auf = -1;
  for (let k = 0; k < 4 && auf < 0; k++) {
    const pre = ["", "U", "U2", "U'"][k] as string;
    if (reaches(member, pre) && reaches(mixed(member), pre)) auf = k;
  }
  if (auf < 0)
    return { ok: false, reason: "does not reach the goal from the case" };
  const inverse = parsed.invert().toString();
  let made: LastLayer;
  try {
    made = lastLayerOf(puzzle.defaultPattern().applyAlg(inverse));
  } catch {
    return { ok: false, reason: "its inverse breaks the first two layers" };
  }
  const got = isOllcpState(made) ? ollcpKey(made) : null;
  if (got !== key)
    return { ok: false, reason: `its inverse makes ${got ?? "no case"}` };
  if (stickerTop(inverse) !== stickersOf(made))
    return { ok: false, reason: "the two cube models disagree" };
  return { ok: true, auf };
}

const byRank = (
  a: { moves: string; metrics: Metrics },
  b: { moves: string; metrics: Metrics },
) =>
  a.metrics.score - b.metrics.score ||
  a.metrics.moves - b.metrics.moves ||
  (a.moves < b.moves ? -1 : a.moves > b.moves ? 1 : 0);

/**
 * The search, as CMLL's and with COLL's goal (search.ts, `corners: "solved"`): each of a
 * case's four angles, the shortest algorithms in R, U and F and those up to two turns
 * longer, up to 60 an angle. The set has 331 cases, so of what is found only the best
 * twelve by score are kept as candidates; `found` is how many there were.
 */
export const OLLCP_SEARCH = { maxDepth: 16, extra: 2, limit: 60 };
export const OLLCP_KEPT = 12;
export function searchCase(
  t: Tables,
  key: string,
): { found: number; algs: string[] } {
  const found = new Set<string>();
  for (let k = 0; k < 4; k++)
    for (const alg of searchLL(t, turned(ollcpState(key), k), OLLCP_SEARCH))
      found.add(tidy(alg));
  const ranked = [...found]
    .map((moves) => ({ moves, metrics: metricsOf(moves) }))
    .sort(byRank);
  return {
    found: found.size,
    algs: ranked.slice(0, OLLCP_KEPT).map((a) => a.moves),
  };
}

/**
 * A drill cube for a case: any member of the class (a U turn before and after), the four
 * top edges placed at random with the corners' parity, their flips the case's.
 */
export function ollcpDrawn(
  puzzle: KPuzzle,
  key: string,
  rng: () => number,
): KPattern {
  const variants = aufVariants(ollcpState(key));
  const top = variants[Math.floor(rng() * variants.length)] as LastLayer;
  const ep = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ep[i], ep[j]] = [ep[j] as number, ep[i] as number];
  }
  if (parityOf(ep) !== parityOf(top.cp))
    [ep[0], ep[1]] = [ep[1] as number, ep[0] as number];
  return patternOf(puzzle, { ...top, ep });
}

/** The case a cube shows (first two layers whole, the top edges anywhere), or null. */
export function ollcpOf(pattern: KPattern): string | null {
  let top: LastLayer;
  try {
    top = lastLayerOf(pattern);
  } catch {
    return null;
  }
  return isOllcpState(top) ? ollcpKey(top) : null;
}

/** A scramble that reaches a drawn cube: cubing's solution of it, inverted. */
export async function ollcpScramble(
  puzzle: KPuzzle,
  key: string,
  rng: () => number,
  solve: (p: KPattern) => Promise<Alg>,
): Promise<string> {
  const target = ollcpDrawn(puzzle, key, rng);
  const scramble = tidy((await solve(target)).invert().toString());
  if (!puzzle.defaultPattern().applyAlg(scramble).isIdentical(target))
    throw new Error("The scramble does not reach the drawn cube");
  return scramble;
}

export type BuiltOllcp = {
  candidates: number;
  rejected: { label: string; alg: string; reason: string }[];
  cases: OllcpCaseData[];
};

/**
 * The set's data from the candidates our search found and the drill scrambles: each
 * candidate verified, ranked by score, then turns, then text, the best three kept.
 *
 * A case is shown with its top as its OLL case's own picture shows it (`olls`, the OLL
 * set as shipped), so the cases of a group differ by their corners' stickers alone. Every
 * algorithm's U turns before it (`auf`) are counted from that picture, as in every set;
 * here the main algorithm may have some too, where it was found from another angle. Where
 * a turn of the top leaves the pattern as it was, the angle the main algorithm expects is
 * taken if it is one of them, else the least. The skip has no OLL case: its two are shown
 * as their main algorithms expect them.
 */
export function buildOllcp(
  puzzle: KPuzzle,
  searched: Readonly<Record<string, readonly string[]>>,
  scrambles: Readonly<Record<string, readonly string[]>>,
  olls: readonly { id: string; state: string }[],
): BuiltOllcp {
  const tops = new Map(olls.map((c) => [c.id, fromKey(c.state)]));
  const sameTop = (a: LastLayer, b: LastLayer) =>
    digits(a.eo) === digits(b.eo) && digits(a.co) === digits(b.co);
  const rejected: BuiltOllcp["rejected"] = [];
  let candidates = 0;
  const built: OllcpCaseData[] = [];
  for (const entry of ollcpCases()) {
    const kept: { moves: string; auf: number; metrics: Metrics }[] = [];
    for (const alg of [...new Set((searched[entry.key] ?? []).map(tidy))]) {
      candidates++;
      const verdict = verifyOllcp(puzzle, entry.key, alg);
      if (verdict.ok)
        kept.push({ moves: alg, auf: verdict.auf, metrics: metricsOf(alg) });
      else rejected.push({ label: entry.label, alg, reason: verdict.reason });
    }
    kept.sort(byRank);
    const best = kept.slice(0, 3);
    const member = ollcpState(entry.key);
    const top = tops.get(`oll-${ollKey(member)}`);
    const angles = top
      ? [0, 1, 2, 3].filter((k) => sameTop(turned(member, k), top))
      : [0, 1, 2, 3];
    if (angles.length === 0)
      throw new Error(`${entry.label} never stands as ${entry.group} is shown`);
    const main = best[0]?.auf ?? 0;
    const base = angles.includes(main) ? main : (angles[0] as number);
    built.push({
      id: `ollcp-${entry.key}`,
      label: entry.label,
      group: entry.group,
      oll: entry.oll,
      state: llKey(turned(member, base)),
      algs: best.map((a) => ({ ...a, auf: (a.auf - base + 4) % 4 })),
      recognise: null,
      subsets: [],
      scrambles: [...(scrambles[entry.key] ?? [])],
    });
  }
  return { candidates, rejected, cases: built };
}

/**
 * The data is cut into files of three OLL cases each (at most 18 cases, the size of the
 * other sets' files), the skip's two in a file of their own, so a list can load a group
 * at a time; `index.ts` lists every case without its algorithms and says which file
 * holds which OLL case.
 */
export const OLLCP_PER_FILE = 3;
const two = (n: number) => String(n).padStart(2, "0");
export function ollcpFile(oll: number): { file: string; name: string } {
  if (oll === 0) return { file: "oll-skip", name: "OLLCP_SKIP" };
  const from = oll - ((oll - 1) % OLLCP_PER_FILE);
  const to = Math.min(57, from + OLLCP_PER_FILE - 1);
  return {
    file: `oll-${two(from)}-${two(to)}`,
    name: `OLLCP_${two(from)}_${two(to)}`,
  };
}

/** The data files' text by file name (without `.ts`), `index` among them. */
export function renderOllcp(built: BuiltOllcp): Map<string, string> {
  const header =
    "// Generated by packages/algs/src/algs.test.ts (ALGS_WRITE=1). Do not edit.";
  const files = new Map<string, { name: string; cases: OllcpCaseData[] }>();
  for (const c of built.cases) {
    const { file, name } = ollcpFile(c.oll);
    const at = files.get(file) ?? { name, cases: [] };
    at.cases.push(c);
    files.set(file, at);
  }
  const out = new Map<string, string>();
  for (const [file, { name, cases }] of files)
    out.set(
      file,
      [
        header,
        'import type { OllcpCaseData } from "../../types";',
        "",
        `export const ${name}: readonly OllcpCaseData[] = ${JSON.stringify(
          cases,
          null,
          2,
        )};`,
        "",
      ].join("\n"),
    );
  out.set(
    "index",
    [
      header,
      `// ${built.candidates} candidates from our own search, ${built.rejected.length} rejected:`,
      ...built.rejected.map((r) => `//   ${r.label}: ${r.alg} (${r.reason})`),
      'import type { OllcpCaseData, OllcpEntry } from "../../types";',
      "",
      "export const OLLCP_INDEX: readonly OllcpEntry[] = [",
      ...built.cases.map(
        (c) =>
          `  ${JSON.stringify({ id: c.id, label: c.label, group: c.group, oll: c.oll, state: c.state })},`,
      ),
      "];",
      "",
      "export const OLLCP_FILES: readonly {",
      "  olls: readonly number[];",
      "  load: () => Promise<readonly OllcpCaseData[]>;",
      "}[] = [",
      ...[...files].map(
        ([file, { name, cases }]) =>
          `  { olls: ${JSON.stringify([...new Set(cases.map((c) => c.oll))])}, load: () => import("./${file}").then((m) => m.${name}) },`,
      ),
      "];",
      "",
    ].join("\n"),
  );
  return out;
}
