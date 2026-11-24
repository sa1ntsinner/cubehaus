import { cubeState } from "@cubehaus/cube";
import {
  type F2lSlot,
  f2lKey,
  f2lOf,
  f2lReady,
  f2lSolved,
  f2lState,
  placePair,
  slotMirrored,
  slotPattern,
  slotStickers,
  unslotPattern,
} from "@cubehaus/scramble/f2l";
import {
  lastLayerCases,
  lastLayerOf,
  stickersOf,
} from "@cubehaus/scramble/last-layer";
import {
  isOriented,
  type LastLayer,
  ollKey,
  pllKey,
  turnAfter,
} from "@cubehaus/scramble/last-layer-state";
import { Alg } from "cubing/alg";
import { KPattern, type KPuzzle } from "cubing/kpuzzle";
import { puzzles } from "cubing/puzzles";
import { collKey, collState, isCollState } from "./coll";
import type { LastLayerSet } from "./types";

/** The last-layer sets; F2L has its own check below. */
export type SetId = LastLayerSet;

/**
 * Checks an algorithm against a case on two models of the cube. Used by the tests and the
 * data build, never at run time (it needs cubing).
 *
 * 1. Forward, on cubing's model: the case's member, turned by U 0 to 3 times, then the
 *    algorithm. The first two layers must stay whole and the set's goal must hold, up to
 *    a U turn after: PLL all solved, OLL all oriented, COLL corners solved and edges
 *    oriented. The U turns needed before are the algorithm's `auf`.
 * 2. Backward, on cubing's model: the algorithm's inverse on a solved cube must make a
 *    state of the very same case (the case is what an algorithm solves).
 * 3. The same backward state on our own sticker model must show the same top stickers.
 *
 * Rotations in an algorithm are allowed; the result is turned back to white on top and
 * green in front before it is read.
 */
export type Verdict = { ok: true; auf: number } | { ok: false; reason: string };

let loaded: Promise<KPuzzle> | undefined;
export function kpuzzle(): Promise<KPuzzle> {
  loaded ??= (
    puzzles["3x3x3"] as NonNullable<(typeof puzzles)["3x3x3"]>
  ).kpuzzle();
  return loaded;
}

const ROTATIONS = ["", "x", "x2", "x'", "z", "z'"].flatMap((a) =>
  ["", "y", "y2", "y'"].map((b) => `${a} ${b}`.trim()),
);

/** The rotation that puts the centres home, and the pattern after it. */
function upright(pattern: KPattern): { pattern: KPattern; rotation: string } {
  for (const rotation of ROTATIONS) {
    const turned = rotation ? pattern.applyAlg(rotation) : pattern;
    const centres = turned.patternData.CENTERS?.pieces;
    if (centres?.every((piece, place) => piece === place))
      return { pattern: turned, rotation };
  }
  throw new Error("No rotation puts the centres home");
}

/** A cube with the top layer as given and the first two layers solved. */
export function patternOf(puzzle: KPuzzle, top: LastLayer): KPattern {
  const solved = puzzle.defaultPattern().patternData;
  return new KPattern(puzzle, {
    ...solved,
    EDGES: {
      pieces: [...top.ep, 4, 5, 6, 7, 8, 9, 10, 11],
      orientation: [...top.eo, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    CORNERS: {
      pieces: [...top.cp, 4, 5, 6, 7],
      orientation: [...top.co, 0, 0, 0, 0],
    },
  });
}

const identity = (p: readonly number[]) => p.every((v, i) => v === i);

function goalHolds(set: SetId, state: LastLayer): boolean {
  if (set === "oll") return isOriented(state);
  let turned = state;
  for (let k = 0; k < 4; k++) {
    if (set === "pll" && isOriented(turned) && identity(turned.ep))
      if (identity(turned.cp)) return true;
    if (set === "coll" && isOriented(turned) && identity(turned.cp))
      return true;
    turned = turnAfter(turned);
  }
  return false;
}

/** The class key of a state in a set, or null when the state is not one of its cases. */
export function keyIn(set: SetId, state: LastLayer): string | null {
  if (set === "oll") return isOriented(state) ? null : ollKey(state);
  if (set === "pll") return isOriented(state) ? pllKey(state) : null;
  return isCollState(state) ? collKey(state) : null;
}

/** A member of a case of the set, by its class key. */
export function memberState(set: SetId, key: string): LastLayer {
  if (set === "coll") return collState(key);
  const { oll, pll } = lastLayerCases();
  const found = (set === "oll" ? oll : pll).find(
    (c) => c.id === `${set}-${key}`,
  );
  if (!found) throw new RangeError(`No ${set} case ${key}`);
  return found.state;
}

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

/** The case of a set an algorithm solves (its inverse's state), or null. */
export async function caseOf(set: SetId, alg: string): Promise<string | null> {
  const puzzle = await kpuzzle();
  const { pattern } = upright(
    puzzle.defaultPattern().applyAlg(new Alg(alg).invert()),
  );
  try {
    return keyIn(set, lastLayerOf(pattern));
  } catch {
    return null;
  }
}

export async function verify(
  set: SetId,
  key: string,
  alg: string,
): Promise<Verdict> {
  const puzzle = await kpuzzle();
  let parsed: Alg;
  try {
    parsed = new Alg(alg);
  } catch {
    return { ok: false, reason: "does not parse" };
  }
  // 1. Forward.
  const start = patternOf(puzzle, memberState(set, key));
  let auf = -1;
  for (let k = 0; k < 4 && auf < 0; k++) {
    const pre = ["", "U", "U2", "U'"][k] as string;
    const after = upright(
      (pre ? start.applyAlg(pre) : start).applyAlg(parsed),
    ).pattern;
    let top: LastLayer;
    try {
      top = lastLayerOf(after);
    } catch {
      continue;
    }
    if (goalHolds(set, top)) auf = k;
  }
  if (auf < 0)
    return { ok: false, reason: "does not reach the goal from the case" };
  // 2. Backward.
  const inverse = parsed.invert().toString();
  const { pattern, rotation } = upright(
    puzzle.defaultPattern().applyAlg(inverse),
  );
  let made: LastLayer;
  try {
    made = lastLayerOf(pattern);
  } catch {
    return { ok: false, reason: "its inverse breaks the first two layers" };
  }
  const got = keyIn(set, made);
  if (got !== key)
    return { ok: false, reason: `its inverse makes ${set} ${got ?? "none"}` };
  // 3. Our own sticker model agrees on what the inverse makes.
  const ours = stickerTop(`${inverse} ${rotation}`.trim());
  if (ours !== stickersOf(made))
    return { ok: false, reason: "the two cube models disagree" };
  return { ok: true, auf };
}

/**
 * Checks an F2L algorithm against a case, the same three ways: forward from the case with U
 * 0 to 3 times before, the cross and four slots whole after; backward, the inverse on a
 * solved cube keeps the cross and the other three slots and makes this very case; and our
 * own sticker model shows the picture's stickers after the inverse. Another slot's case is
 * the front right one seen from that slot (f2l-state.ts): its cube is the front right cube
 * turned (y for the back right) or mirrored (the left slots), and what an inverse makes
 * there is read back the same way; the picture is checked against our model turned so the
 * slot stands at the front, a left slot's rows read the other way.
 */
export async function verifyF2l(
  key: string,
  alg: string,
  slot: F2lSlot | "right" | "left" = "fr",
): Promise<Verdict> {
  const puzzle = await kpuzzle();
  const at: F2lSlot = slot === "right" ? "fr" : slot === "left" ? "fl" : slot;
  const mirrored = slotMirrored(at);
  let parsed: Alg;
  try {
    parsed = new Alg(alg);
  } catch {
    return { ok: false, reason: "does not parse" };
  }
  const start = slotPattern(
    placePair(puzzle.defaultPattern(), f2lState(key)),
    at,
  );
  let auf = -1;
  for (let k = 0; k < 4 && auf < 0; k++) {
    const pre = ["", "U", "U2", "U'"][k] as string;
    const after = upright(
      (pre ? start.applyAlg(pre) : start).applyAlg(parsed),
    ).pattern;
    if (f2lSolved(after)) auf = k;
  }
  if (auf < 0)
    return { ok: false, reason: "does not solve the slot from the case" };
  const inverse = parsed.invert().toString();
  const { pattern, rotation } = upright(
    puzzle.defaultPattern().applyAlg(inverse),
  );
  const seen = unslotPattern(pattern, at);
  if (!f2lReady(seen))
    return { ok: false, reason: "its inverse breaks the cross or a slot" };
  const made = f2lOf(seen);
  const got = f2lKey(made);
  if (got !== key) return { ok: false, reason: `its inverse makes f2l ${got}` };
  // Our model turned so the slot stands at the front right, or in the mirror front left.
  const view = SLOT_VIEW[at];
  const s = cubeState(3, `${inverse} ${rotation} ${view}`.trim());
  const picture = slotStickers(made, at);
  const faces = [s.U, s.F, mirrored ? s.L : s.R];
  for (let place = 0; place < 27; place++) {
    if (picture[place] === "x") continue;
    const i = place % 9;
    const face = faces[Math.floor(place / 9)] as readonly string[];
    const sticker = face[mirrored ? Math.floor(i / 3) * 3 + (2 - (i % 3)) : i];
    if (picture[place] !== sticker)
      return { ok: false, reason: "the two cube models disagree" };
  }
  return { ok: true, auf };
}

/** The whole-cube turn that brings a slot to the front (y: back right to front right). */
const SLOT_VIEW: Record<F2lSlot, string> = {
  fr: "",
  fl: "",
  br: "y",
  bl: "y'",
};
