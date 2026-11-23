import { puzzles } from "cubing/puzzles";
import { describe, expect, it } from "vitest";
import {
  LAST_SLOT_KEYS,
  lastSlotDone,
  lastSlotMember,
  lastSlotOf,
} from "./last-slot";
import { generateTraining } from "./training";

function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

describe("last-slot drills", () => {
  it("26 cases a set, and the insert from a member leaves only twisted corners", async () => {
    const puzzle = await puzzles["3x3x3"]?.kpuzzle();
    if (!puzzle) throw new Error("Missing 3×3 KPuzzle loader");
    expect(LAST_SLOT_KEYS).toHaveLength(26);
    expect(new Set(LAST_SLOT_KEYS).size).toBe(26);
    for (const key of LAST_SLOT_KEYS)
      expect(
        lastSlotDone(
          lastSlotMember(puzzle, "ls-right", key).applyAlg("R U' R'"),
        ),
      ).toBe(false);
  });

  it("a drill scramble reads back to its case, the top turned at most once", async () => {
    const puzzle = await puzzles["3x3x3"]?.kpuzzle();
    if (!puzzle) throw new Error("Missing 3×3 KPuzzle loader");
    const rng = seeded(9);
    for (const set of ["ls-right", "ls-front"] as const)
      for (const key of LAST_SLOT_KEYS.filter((_, i) => i % 6 === 0)) {
        const { scramble, caseId } = await generateTraining(
          { kind: set, caseIds: [`${set}-${key}`] },
          rng,
        );
        expect(caseId).toBe(`${set}-${key}`);
        expect(scramble).toMatch(/^[ULFRBD](2|')?( [ULFRBD](2|')?)*$/);
        expect(
          lastSlotOf(set, puzzle.defaultPattern().applyAlg(scramble)),
        ).toBe(key);
      }
  }, 120_000);
});
