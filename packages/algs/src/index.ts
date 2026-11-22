import { stickersOf } from "@cubehaus/scramble/last-layer";
import { fromKey, turnAfter } from "@cubehaus/scramble/last-layer-state";
import { COLL } from "./data/coll";
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
};

export function trainerSet(id: SetId): readonly TrainerCaseData[] {
  return SETS[id];
}

/** The case's picture after `turns` U turns (an AUF before the algorithm). */
export function pictureOf(c: TrainerCaseData, turns = 0): string {
  let state = fromKey(c.state);
  const n = ((turns % 4) + 4) % 4;
  for (let k = 0; k < n; k++) state = turnAfter(state);
  return stickersOf(state);
}
export {
  type AttemptLike,
  caseMedian,
  type Grade,
  gradeOf,
  newCard,
  nextCase,
  recall,
  review,
  roundOf,
  weakCases,
} from "./schedule";
export { groupMoves, recolour, turnScramble } from "./show";
