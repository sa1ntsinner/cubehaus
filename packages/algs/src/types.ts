import type { Metrics } from "./metrics";

export type LastLayerSet = "pll" | "oll" | "coll";
export type SetId = LastLayerSet | "f2l" | "f2l-left";

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
  subsets: readonly string[];
};
