import { expect, test } from "vitest";
import REVIEW from "./candidates/review-search.json";
import { COLL } from "./data/coll";
import { OLL } from "./data/oll";
import { PLL } from "./data/pll";
import { tidy } from "./metrics";
import { MAIN_BEFORE_REVIEW, REVIEW_LIVE_AT } from "./replaced";

const finds = (id: string): string[] =>
  Object.values(
    REVIEW as Record<string, Record<string, { friendly: string[] }>>,
  )
    .find((rows) => rows[id])
    ?.[id]?.friendly.map(tidy) ?? [];

test("the replaced main algorithms are the shipped data's: a review find first, the old main second", () => {
  const derived: Record<string, string> = {};
  for (const c of [...PLL, ...OLL, ...COLL]) {
    const [main, before] = c.algs;
    if (main && before && finds(c.id).includes(main.moves))
      derived[c.id] = before.moves;
  }
  expect(derived).toEqual(MAIN_BEFORE_REVIEW);
  // PLL E and Ra, OLL 29, 36, 38 and 42, COLL L 3 and S 5.
  const labels = [...PLL, ...OLL, ...COLL]
    .filter((c) => c.id in MAIN_BEFORE_REVIEW)
    .map((c) => c.label);
  expect(labels.sort()).toEqual(
    ["E", "Ra", "OLL 29", "OLL 36", "OLL 38", "OLL 42", "L 3", "S 5"].sort(),
  );
});

test("the change went live on the day of the review", () => {
  expect(new Date(REVIEW_LIVE_AT).toISOString()).toBe(
    "2026-11-23T13:32:44.000Z",
  );
});
