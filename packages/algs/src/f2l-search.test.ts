import { f2lOf, f2lSolved } from "@cubehaus/scramble/f2l";
import { describe, expect, it } from "vitest";
import { f2lTables, searchF2l } from "./f2l-search";
import { kpuzzle } from "./verify";

describe("F2L search", () => {
  it("finds the three-turn insert, and every algorithm it finds solves the slot", async () => {
    const puzzle = await kpuzzle();
    const t = f2lTables(puzzle);
    const made = puzzle.defaultPattern().applyAlg("R U' R'");
    const found = searchF2l(t, f2lOf(made), { extra: 2, limit: 20 });
    expect(found[0]).toBe("R U R'");
    for (const alg of found) {
      expect(alg).not.toMatch(/^U|U['2]?$/);
      expect(f2lSolved(made.applyAlg(alg))).toBe(true);
    }
    // A pair split in the slot.
    const split = puzzle.defaultPattern().applyAlg("R U R' U' R U R'");
    const again = searchF2l(t, f2lOf(split), { extra: 0, limit: 5 });
    expect(again.length).toBeGreaterThan(0);
    for (const alg of again) expect(f2lSolved(split.applyAlg(alg))).toBe(true);
  }, 60_000);
});
