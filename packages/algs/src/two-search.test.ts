import { describe, expect, it } from "vitest";
import { applyTwo, SOLVED, sameTwo } from "./two";
import {
  distances,
  indexOf,
  SOLVED_UP_TO_U,
  STATES,
  scrambleTo,
  solveTwo,
  stateOf,
} from "./two-search";

describe("2×2 search", () => {
  it("indexes every state once, and the table reaches all 3 674 160 within 11 turns", () => {
    for (const i of [0, 1, 728, 729, 1_000_000, STATES - 1])
      expect(indexOf(stateOf(i))).toBe(i);
    const table = distances([SOLVED]);
    let most = 0;
    let unreached = 0;
    for (const d of table) {
      if (d === 255) unreached++;
      else if (d > most) most = d;
    }
    expect(unreached).toBe(0);
    // God's number for the 2×2 in R, U and F, half turns counted as one.
    expect(most).toBe(11);
  }, 120_000);

  it("finds the shortest algorithms, every one of which solves, and scrambles that lead back", () => {
    const table = distances(SOLVED_UP_TO_U);
    const start = applyTwo(SOLVED, "R U R' U R U2 R'");
    const found = solveTwo(table, start, { extra: 0, limit: 50 });
    expect(found.length).toBeGreaterThan(0);
    for (const alg of found) {
      expect(alg.split(" ").length).toBeLessThanOrEqual(7);
      const after = applyTwo(start, alg);
      expect(
        SOLVED_UP_TO_U.some((g) => sameTwo(g, after)),
        alg,
      ).toBe(true);
    }
    const exact = distances([SOLVED]);
    for (const pick of [0, 0.5, 0.99]) {
      const scramble = scrambleTo(exact, start, pick);
      expect(sameTwo(applyTwo(SOLVED, scramble), start)).toBe(true);
    }
  }, 120_000);
});
