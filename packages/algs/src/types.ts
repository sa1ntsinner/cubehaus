import type { Metrics } from "./metrics";

export type LastLayerSet = "pll" | "oll" | "coll";
export type SetId =
  | LastLayerSet
  | "f2l"
  | "f2l-left"
  | "f2l-back"
  | "f2l-back-left"
  | LastSlotSetId
  | TwoSetId;

/**
 * Last slot: insert the joined pair (R U' R' or F' U F, front right) and orient the last
 * layer's corners with it, its edges already oriented.
 */
export type LastSlotSetId = "ls-right" | "ls-front";

/**
 * The 2×2 sets: orient the top (OLL), both layers' places (PBL), the top in one (CLL), and
 * the top in one with the bottom's pieces swapped side by side (adj) or across (diag).
 */
export type TwoSetId =
  | "two-oll"
  | "two-pbl"
  | "two-cll"
  | "two-adj"
  | "two-diag";

/** A case as shipped: built by build.ts from verified candidates. */
export type TrainerCaseData = {
  id: string;
  label: string;
  /** PLL: edges, corners, adjacent, diagonal, g. OLL: its edge shape. COLL: its corners' shape. */
  group: string;
  /**
   * The case's member as the main algorithm expects it: last-layer digits (llKey), or for
   * F2L the pair's corner place, twist, edge place and flip.
   */
  state: string;
  /** Best first; `auf` is the U turns before it, counted from the picture. */
  algs: readonly { moves: string; auf: number; metrics: Metrics }[];
  recognise: { en: string; ru: string } | null;
  /**
   * F2L only: what the main algorithm does, in plain words read from the cube model as it
   * is played (f2l-idea.ts); null where the algorithm has no clear shape.
   */
  idea?: { en: string; ru: string } | null;
  subsets: readonly string[];
  /** 2×2 and last slot: drill scrambles made at build time, each leading to the case. */
  scrambles?: readonly string[];
  /**
   * Last slot only: the case's pictures, `top` as the OLL pictures (21 letters), `slot` as
   * the F2L pictures (27 letters, `U` a last-layer sticker showing the top colour, `x` one
   * that says nothing).
   */
  pictures?: { top: string; slot: string };
};
