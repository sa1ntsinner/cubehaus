import { CMLL } from "./data/cmll";
import { COLL } from "./data/coll";
import { F2L } from "./data/f2l";
import { F2L_BACK } from "./data/f2l-back";
import { F2L_BACK_LEFT } from "./data/f2l-back-left";
import { F2L_LEFT } from "./data/f2l-left";
import { LS_FRONT } from "./data/ls-front";
import { LS_RIGHT } from "./data/ls-right";
import { OLL } from "./data/oll";
import { PLL } from "./data/pll";
import { TWO_ADJ } from "./data/two-adj";
import { TWO_CLL } from "./data/two-cll";
import { TWO_DIAG } from "./data/two-diag";
import { TWO_OLL } from "./data/two-oll";
import { TWO_PBL } from "./data/two-pbl";
import { lookalikesFor } from "./lookalike";
import type { LastSlotSetId, SetId, TrainerCaseData } from "./types";

export * from "./trainer";

const SETS: Record<SetId, readonly TrainerCaseData[]> = {
  pll: PLL,
  oll: OLL,
  coll: COLL,
  cmll: CMLL,
  f2l: F2L,
  "f2l-left": F2L_LEFT,
  "f2l-back": F2L_BACK,
  "f2l-back-left": F2L_BACK_LEFT,
  "two-oll": TWO_OLL,
  "two-pbl": TWO_PBL,
  "two-cll": TWO_CLL,
  "two-adj": TWO_ADJ,
  "two-diag": TWO_DIAG,
  "ls-right": LS_RIGHT,
  "ls-front": LS_FRONT,
};

export function trainerSet(id: SetId): readonly TrainerCaseData[] {
  return SETS[id];
}

/**
 * The last-slot sets (last-slot.ts), typed with what every case carries: its pictures and
 * eight drill scrambles; `generateTraining({ kind: set, caseIds })` makes more.
 */
export function lastSlotSet(id: LastSlotSetId): readonly (TrainerCaseData & {
  scrambles: readonly string[];
  pictures: { top: string; slot: string };
})[] {
  return id === "ls-right" ? LS_RIGHT : LS_FRONT;
}

export function lookalikes(set: SetId): ReadonlyMap<string, readonly string[]> {
  return lookalikesFor(set, trainerSet(set));
}
