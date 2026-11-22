import type { Metrics } from "./metrics";

export type SetId = "pll" | "oll" | "coll";

/** A case as shipped: built by build.ts from verified candidates. */
export type TrainerCaseData = {
  id: string;
  label: string;
  /** PLL: edges, corners, adjacent, diagonal, g. OLL: its edge shape. COLL: its corners' shape. */
  group: string;
  /** The case's member as the main algorithm expects it, as last-layer digits (llKey). */
  state: string;
  /** Best first; `auf` is the U turns before it, counted from the picture. */
  algs: readonly { moves: string; auf: number; metrics: Metrics }[];
  recognise: { en: string; ru: string } | null;
  subsets: readonly string[];
};
