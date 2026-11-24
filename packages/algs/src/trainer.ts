import type { SetId } from "./types";

/**
 * The trainer's sets at run time: verified algorithms, pictures and explanations, with no
 * cube library behind them.
 */
export type { Metrics } from "./metrics";
export { MAIN_BEFORE_REVIEW, REVIEW_LIVE_AT } from "./replaced";
export type {
  LastSlotSetId,
  SetId,
  TrainerCaseData,
  TwoSetId,
} from "./types";

/**
 * Names for the sets whose common names say little: the 2×2's top in one go with the
 * bottom's pieces swapped side by side or across. `short` fits the sets row.
 */
export const SET_NAMES: Partial<
  Record<SetId, { short: { en: string; ru: string }; en: string; ru: string }>
> = {
  "two-adj": {
    short: { en: "Adj", ru: "Сосед" },
    en: "Top in one go, bottom pieces swapped side by side",
    ru: "Верх за раз, внизу обмен соседних",
  },
  "ls-right": {
    short: { en: "LS-R", ru: "LS-R" },
    en: "Last slot: insert the joined pair with R U' R', orient the corners",
    ru: "Последний слот: вставка пары R U' R' с ориентацией углов",
  },
  "ls-front": {
    short: { en: "LS-F", ru: "LS-F" },
    en: "Last slot: insert the joined pair with F' U F, orient the corners",
    ru: "Последний слот: вставка пары F' U F с ориентацией углов",
  },
  "two-diag": {
    short: { en: "Diag", ru: "Диаг" },
    en: "Top in one go, bottom pieces swapped across",
    ru: "Верх за раз, внизу обмен по диагонали",
  },
};

/** The puzzle a set is for. */
export const puzzleOf = (set: SetId): "333" | "222" =>
  set.startsWith("two-") ? "222" : "333";

export {
  type F2lSlot,
  mirrorAlg,
  slotAlg,
  slotMirrored,
} from "@cubehaus/scramble/f2l-state";
export { type Arrow, pllArrows } from "./arrows";
export {
  type F2lFacing,
  type F2lFacts,
  type F2lPlace,
  type F2lSection,
  type F2lSetId,
  type F2lWhere,
  f2lFacts,
  f2lGroups,
  f2lOrder,
  f2lSections,
} from "./f2l-order";
export { loadTrainerSet } from "./load-set";
export { lookalikesFor } from "./lookalike";
export { lastSlotTop, pictureOf, slotOf, turnPicture } from "./pictures";

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
