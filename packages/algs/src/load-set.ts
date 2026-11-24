import type { SetId, TrainerCaseData } from "./types";

const loaders: Record<SetId, () => Promise<readonly TrainerCaseData[]>> = {
  pll: () => import("./data/pll").then(({ PLL }) => PLL),
  oll: () => import("./data/oll").then(({ OLL }) => OLL),
  coll: () => import("./data/coll").then(({ COLL }) => COLL),
  cmll: () => import("./data/cmll").then(({ CMLL }) => CMLL),
  f2l: () => import("./data/f2l").then(({ F2L }) => F2L),
  "f2l-left": () => import("./data/f2l-left").then(({ F2L_LEFT }) => F2L_LEFT),
  "f2l-back": () => import("./data/f2l-back").then(({ F2L_BACK }) => F2L_BACK),
  "f2l-back-left": () =>
    import("./data/f2l-back-left").then(({ F2L_BACK_LEFT }) => F2L_BACK_LEFT),
  "ls-front": () => import("./data/ls-front").then(({ LS_FRONT }) => LS_FRONT),
  "ls-right": () => import("./data/ls-right").then(({ LS_RIGHT }) => LS_RIGHT),
  "two-oll": () => import("./data/two-oll").then(({ TWO_OLL }) => TWO_OLL),
  "two-pbl": () => import("./data/two-pbl").then(({ TWO_PBL }) => TWO_PBL),
  "two-cll": () => import("./data/two-cll").then(({ TWO_CLL }) => TWO_CLL),
  "two-adj": () => import("./data/two-adj").then(({ TWO_ADJ }) => TWO_ADJ),
  "two-diag": () => import("./data/two-diag").then(({ TWO_DIAG }) => TWO_DIAG),
};

export const loadTrainerSet = (id: SetId) => loaders[id]();
