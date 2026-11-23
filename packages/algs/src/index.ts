import {
  f2lLeftStickers,
  f2lState,
  f2lStickers,
  f2lTurned,
} from "@cubehaus/scramble/f2l-state";
import { stickersOf } from "@cubehaus/scramble/last-layer";
import { fromKey, turnAfter } from "@cubehaus/scramble/last-layer-state";
import { COLL } from "./data/coll";
import { F2L } from "./data/f2l";
import { F2L_LEFT } from "./data/f2l-left";
import { OLL } from "./data/oll";
import { PLL } from "./data/pll";
import type { SetId, TrainerCaseData } from "./types";

/**
 * The trainer's sets at run time: verified algorithms, pictures and explanations, with no
 * cube library behind them.
 */
export type { Metrics } from "./metrics";
export type { SetId, TrainerCaseData } from "./types";

const SETS: Record<SetId, readonly TrainerCaseData[]> = {
  pll: PLL,
  oll: OLL,
  coll: COLL,
  f2l: F2L,
  "f2l-left": F2L_LEFT,
};

export function trainerSet(id: SetId): readonly TrainerCaseData[] {
  return SETS[id];
}

/**
 * The case's picture after `turns` U turns (an AUF before the algorithm): 21 letters for a
 * last-layer case (last-layer-cases.ts), 27 for an F2L case (f2l-state.ts). A left slot's
 * case is drawn mirrored, where a U turn is the right case's U'.
 */
export function pictureOf(c: TrainerCaseData, turns = 0): string {
  if (c.id.startsWith("f2l-left-"))
    return f2lLeftStickers(f2lTurned(f2lState(c.state), -turns));
  if (c.id.startsWith("f2l-"))
    return f2lStickers(f2lTurned(f2lState(c.state), turns));
  let state = fromKey(c.state);
  const n = ((turns % 4) + 4) % 4;
  for (let k = 0; k < n; k++) state = turnAfter(state);
  return stickersOf(state);
}
export { mirrorAlg } from "@cubehaus/scramble/f2l-state";
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
