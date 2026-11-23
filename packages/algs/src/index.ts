import {
  type F2lSlot,
  f2lState,
  f2lTurned,
  slotMirrored,
  slotStickers,
} from "@cubehaus/scramble/f2l-state";
import { stickersOf } from "@cubehaus/scramble/last-layer";
import { fromKey, turnAfter } from "@cubehaus/scramble/last-layer-state";
import { COLL } from "./data/coll";
import { F2L } from "./data/f2l";
import { F2L_BACK } from "./data/f2l-back";
import { F2L_BACK_LEFT } from "./data/f2l-back-left";
import { F2L_LEFT } from "./data/f2l-left";
import { OLL } from "./data/oll";
import { PLL } from "./data/pll";
import { TWO_CLL } from "./data/two-cll";
import { TWO_OLL } from "./data/two-oll";
import { TWO_PBL } from "./data/two-pbl";
import { applyTwo, twoStickers } from "./two";
import { stateFromKey } from "./two-cases";
import type { SetId, TrainerCaseData } from "./types";

/**
 * The trainer's sets at run time: verified algorithms, pictures and explanations, with no
 * cube library behind them.
 */
export type { Metrics } from "./metrics";
export type { SetId, TrainerCaseData, TwoSetId } from "./types";

const SETS: Record<SetId, readonly TrainerCaseData[]> = {
  pll: PLL,
  oll: OLL,
  coll: COLL,
  f2l: F2L,
  "f2l-left": F2L_LEFT,
  "f2l-back": F2L_BACK,
  "f2l-back-left": F2L_BACK_LEFT,
  "two-oll": TWO_OLL,
  "two-pbl": TWO_PBL,
  "two-cll": TWO_CLL,
};

/** The puzzle a set is for. */
export const puzzleOf = (set: SetId): "333" | "222" =>
  set.startsWith("two-") ? "222" : "333";

/** The F2L slot a case or set id stands for, or null for a last-layer one. */
export function slotOf(id: string): F2lSlot | null {
  if (id.startsWith("f2l-back-left")) return "bl";
  if (id.startsWith("f2l-back")) return "br";
  if (id.startsWith("f2l-left")) return "fl";
  if (id.startsWith("f2l")) return "fr";
  return null;
}

export function trainerSet(id: SetId): readonly TrainerCaseData[] {
  return SETS[id];
}

/**
 * The case's picture after `turns` U turns (an AUF before the algorithm): 21 letters for a
 * last-layer case (last-layer-cases.ts), 27 for an F2L case (f2l-state.ts), drawn from
 * above its slot's corner. A left slot's case is drawn mirrored, where a U turn is the
 * right case's U'.
 */
export function pictureOf(c: TrainerCaseData, turns = 0): string {
  if (c.id.startsWith("two-")) {
    const n = ((turns % 4) + 4) % 4;
    // PBL shows both layers' sides; the others the top layer's.
    return twoStickers(
      applyTwo(stateFromKey(c.state), ["", "U", "U2", "U'"][n] as string),
      c.id.startsWith("two-pbl-"),
    );
  }
  const slot = slotOf(c.id);
  if (slot)
    return slotStickers(
      f2lTurned(f2lState(c.state), slotMirrored(slot) ? -turns : turns),
      slot,
    );
  let state = fromKey(c.state);
  const n = ((turns % 4) + 4) % 4;
  for (let k = 0; k < n; k++) state = turnAfter(state);
  return stickersOf(state);
}
export {
  type F2lSlot,
  mirrorAlg,
  slotAlg,
  slotMirrored,
} from "@cubehaus/scramble/f2l-state";
export { type Arrow, pllArrows } from "./arrows";
export { lookalikes } from "./lookalike";
export {
  type ReviewCounts,
  type ReviewQueue,
  reviewQueue,
  seededOrder,
} from "./review";
export {
  type AttemptLike,
  caseMedian,
  type Grade,
  gradeOf,
  newCard,
  nextCase,
  recall,
  recogMedian,
  review,
  roundOf,
  weakCases,
} from "./schedule";
export {
  type AlgPiece,
  algGroups,
  algUnits,
  groupMoves,
  recolour,
  turnScramble,
} from "./show";
