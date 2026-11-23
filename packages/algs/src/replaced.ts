/**
 * Main algorithms the algorithm review replaced (2026-11-23): where a finger-friendly find
 * scored at least 2 below the main algorithm it went first, and the old main algorithm
 * stayed second. Someone who drilled a case before that, and never chose an algorithm for
 * it, learnt the old one: the trainer keeps showing it to them (apps/web train-state.ts).
 * replaced.test.ts derives this table from the shipped data and the review's finds.
 */
export const MAIN_BEFORE_REVIEW: Readonly<Record<string, string>> = {
  "pll-01231032": "R2 U R' U' y R U R' U' R U R' U' R U R' y' R U' R2",
  "pll-01321023": "R U R' F' R U2 R' U2 R' F R U R U2 R'",
  "oll-00112100": "R U R' U' R U' R' F' U' F R U R'",
  "oll-00111020": "R' U' R U' R' U R U l U' R' U x",
  "oll-00112010": "R U R' U R U' R' U' R' F R F'",
  "oll-00111200": "R' U' R U' R' U2 R F R U R' U' F'",
  "coll-01320201": "R' U F U F' U' R U2 F U2 F'",
  "coll-01322220": "F R' U R U' F' U R' U' R",
};

/**
 * When the review's algorithms went live: the first deploy after the change was
 * committed. An attempt from before it was made on the old main algorithm.
 */
export const REVIEW_LIVE_AT = Date.parse("2026-11-23T13:32:44Z");
