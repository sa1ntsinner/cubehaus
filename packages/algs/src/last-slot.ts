import { cubeState } from "@cubehaus/cube";
import {
  LAST_SLOT_KEYS,
  type LastSlotSet,
  lastSlotDone,
  lastSlotDrawn,
  lastSlotKey,
  lastSlotMember,
} from "@cubehaus/scramble/last-slot";
import { Alg } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { faceColours, faceletPieces } from "./facelets";
import { type Metrics, metricsOf, tidy } from "./metrics";
import type { Full } from "./search";
import type { TrainerCaseData } from "./types";

/**
 * Last-slot sets: the last F2L pair joined on top, standing where a three-turn insert puts
 * it in the front right slot, every last-layer edge oriented; the algorithm inserts the
 * pair and orients every last-layer corner too. The model (f2l-order.test.ts) shows exactly
 * two joined pairs on top that a three-turn insert solves: the one `R U' R'` inserts and
 * the one `F' U F` inserts; each gives a set.
 *
 * A member is a last layer X (the first two layers whole, edges oriented, corners twisted
 * anyhow and placed anyhow) with the insert undone after it: X then insert⁻¹. Playing the
 * insert gives X back, and an algorithm's effect on twists does not depend on which piece
 * is where, so a case is the twists of X's four top places: 27, the sum a multiple of 3;
 * the one with no twist is the insert alone and is left out, 26 a set. The pair stays
 * where the case puts it, so no U turn comes before. Build and test time (it needs cubing).
 */

export {
  LAST_SLOT,
  LAST_SLOT_KEYS,
  type LastSlotSet,
  lastLayerPattern,
  lastSlotDone,
  lastSlotKey,
  lastSlotMember,
  lastSlotOf,
} from "@cubehaus/scramble/last-slot";

type Orbit = { pieces: number[]; orientation: number[] };
const dataOf = (p: KPattern) =>
  p.patternData as unknown as { CORNERS: Orbit; EDGES: Orbit };

export function fullOf(pattern: KPattern): Full {
  const d = dataOf(pattern);
  return {
    corners: {
      pieces: [...d.CORNERS.pieces],
      orientation: [...d.CORNERS.orientation],
    },
    edges: {
      pieces: [...d.EDGES.pieces],
      orientation: [...d.EDGES.orientation],
    },
  };
}

/**
 * The pictures of a cube in the set's position. `top`: 21 letters as the OLL pictures
 * (U row by row from the back left, then the top rows of F, R, B and L as seen from
 * outside), each the colour on that sticker. `slot`: 27 letters as the F2L pictures (U,
 * then F and R row by row from the top left), a last-layer piece's sticker `U` where it
 * shows the top colour and `x` where it says nothing; the pair and the first two layers in
 * their colours.
 */
export function lastSlotPictures(pattern: KPattern): {
  top: string;
  slot: string;
} {
  const d = dataOf(pattern);
  const f = faceColours(d.CORNERS, d.EDGES);
  const who = faceletPieces(d.CORNERS, d.EDGES);
  const row = (face: string) => (f[face] as string[]).slice(0, 3).join("");
  const top = [(f.U as string[]).join(""), ..."FRBL".split("").map(row)].join(
    "",
  );
  // A last-layer piece is a corner or an edge numbered 0 to 3.
  const lastLayer = (piece: string | null) =>
    piece !== null && Number(piece.slice(1)) < 4;
  const slot = ["U", "F", "R"]
    .map((face) =>
      (f[face] as string[])
        .map((colour, i) =>
          lastLayer((who[face] as (string | null)[])[i] ?? null)
            ? colour === "U"
              ? "U"
              : "x"
            : colour,
        )
        .join(""),
    )
    .join("");
  return { top, slot };
}

export const invert = (alg: string) => new Alg(alg).invert().toString();

/**
 * Checks an algorithm against a case on two models: forward from the member (no U turn
 * before: the pair stands where the case puts it), the first two layers whole and every
 * last-layer piece oriented after; backward, the inverse on a solved cube makes a cube of
 * this very case; and our own sticker model shows the same top colour and cross colour
 * stickers after the inverse as cubing does.
 */
export async function verifyLastSlot(
  puzzle: KPuzzle,
  set: LastSlotSet,
  key: string,
  alg: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!lastSlotDone(lastSlotMember(puzzle, set, key).applyAlg(alg)))
    return { ok: false, reason: "does not insert and orient from the case" };
  const inverse = invert(alg);
  const made = puzzle.defaultPattern().applyAlg(inverse);
  const got = lastSlotKey(set, made);
  if (got !== key) return { ok: false, reason: `its inverse makes ${got}` };
  const s = cubeState(3, inverse);
  const ours = [
    s.U.join(""),
    ...(["F", "R", "B", "L"] as const).map((f) => s[f].slice(0, 3).join("")),
  ].join("");
  const mask = (p: string) => p.replace(/[^UD]/g, "x");
  if (mask(ours) !== mask(lastSlotPictures(made).top))
    return { ok: false, reason: "the two cube models disagree" };
  return { ok: true };
}

export type LastSlotCase = TrainerCaseData & {
  scrambles: string[];
  pictures: { top: string; slot: string };
};

export type BuiltLastSlot = {
  set: LastSlotSet;
  candidates: number;
  rejected: { label: string; alg: string; reason: string }[];
  cases: LastSlotCase[];
};

/**
 * A set's data from the candidates our search found and the drill scrambles: each
 * candidate verified, ranked by score, then turns, then text, the best three kept; cases
 * in our own order (the main algorithm's turns, then score, then key), grouped by how many
 * last-layer corners show the top colour up in the picture.
 */
export async function buildLastSlot(
  puzzle: KPuzzle,
  set: LastSlotSet,
  searched: Readonly<Record<string, readonly string[]>>,
  scrambles: Readonly<Record<string, readonly string[]>>,
): Promise<BuiltLastSlot> {
  const rejected: BuiltLastSlot["rejected"] = [];
  let candidates = 0;
  const built: (Omit<LastSlotCase, "label"> & { key: string })[] = [];
  for (const key of LAST_SLOT_KEYS) {
    const kept: { moves: string; auf: number; metrics: Metrics }[] = [];
    for (const alg of [...new Set((searched[key] ?? []).map(tidy))]) {
      candidates++;
      const verdict = await verifyLastSlot(puzzle, set, key, alg);
      if (verdict.ok)
        kept.push({ moves: alg, auf: 0, metrics: metricsOf(alg) });
      else rejected.push({ label: key, alg, reason: verdict.reason });
    }
    kept.sort(
      (a, b) =>
        a.metrics.score - b.metrics.score ||
        a.metrics.moves - b.metrics.moves ||
        (a.moves < b.moves ? -1 : a.moves > b.moves ? 1 : 0),
    );
    const pictures = lastSlotPictures(lastSlotMember(puzzle, set, key));
    const up = [0, 2, 6, 8].filter((i) => pictures.top[i] === "U").length;
    built.push({
      key,
      id: `${set}-${key}`,
      group: `${up} up`,
      state: key,
      algs: kept.slice(0, 3),
      recognise: null,
      subsets: [],
      scrambles: [...(scrambles[key] ?? [])],
      pictures,
    });
  }
  built.sort((a, b) => {
    const ma = a.algs[0]?.metrics;
    const mb = b.algs[0]?.metrics;
    return (
      (ma?.moves ?? 99) - (mb?.moves ?? 99) ||
      (ma?.score ?? 99) - (mb?.score ?? 99) ||
      a.key.localeCompare(b.key)
    );
  });
  const short = set === "ls-right" ? "LS-R" : "LS-F";
  return {
    set,
    candidates,
    rejected,
    cases: built.map(({ key: _, ...c }, i) => ({
      ...c,
      label: `${short} ${i + 1}`,
    })),
  };
}

export function renderLastSlot(built: BuiltLastSlot): string {
  const name = built.set.replaceAll("-", "_").toUpperCase();
  return [
    "// Generated by packages/algs/src/last-slot.test.ts (ALGS_WRITE=1). Do not edit.",
    `// ${built.candidates} candidates from our own search, ${built.rejected.length} rejected:`,
    ...built.rejected.map((r) => `//   ${r.label}: ${r.alg} (${r.reason})`),
    'import type { TrainerCaseData } from "../types";',
    "",
    `export const ${name}: readonly (TrainerCaseData & { scrambles: readonly string[]; pictures: { top: string; slot: string } })[] = ${JSON.stringify(
      built.cases,
      null,
      2,
    )};`,
    "",
  ].join("\n");
}

/**
 * A drill scramble for a case: a member with its last layer's pieces placed at random
 * (corner and edge swaps of one parity, so a cube can reach it) and the top turned at
 * random, so a U turn may be needed to bring the pair over its slot; cubing's solver finds
 * a way back, and its inverse is the scramble. Build time only.
 */
export async function lastSlotScramble(
  puzzle: KPuzzle,
  set: LastSlotSet,
  key: string,
  rng: () => number,
  solve: (p: KPattern) => Promise<Alg>,
): Promise<string> {
  const target = lastSlotDrawn(puzzle, set, key, rng);
  const way = await solve(target);
  const scramble = way
    .invert()
    .toString()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace("2'", "2"))
    .join(" ");
  if (!puzzle.defaultPattern().applyAlg(scramble).isIdentical(target))
    throw new Error("The scramble does not reach the drawn cube");
  return scramble;
}
