import { expect, test } from "vitest";
import { splitSummary } from "./splits";

test("computes each named part from raw durations, using its latest 12 samples", () => {
  const history = Array.from({ length: 13 }, (_, i) => [
    { name: "Cross", durationMs: i * 100 },
    { name: "F2L", durationMs: 4000 },
    { name: i === 12 ? "PLL" : "LL", durationMs: 2000 },
  ]);
  expect(splitSummary(history)).toMatchObject([
    { name: "Cross", mean: 600, ao12: 650, best: 0 },
    { name: "F2L", mean: 4000, ao12: 4000, best: 4000 },
    { name: "LL", mean: 2000, ao12: 2000, best: 2000 },
    { name: "PLL", mean: 2000, ao12: NaN, best: 2000 },
  ]);
});
