import { classifyLL } from "@cubehaus/scramble/last-layer";
import { describe, expect, it } from "vitest";
import { pictureOf, trainerSet } from "./index";
import {
  algGroups,
  algUnits,
  groupMoves,
  recolour,
  turnScramble,
} from "./show";
import { kpuzzle } from "./verify";

describe("showing a case", () => {
  it("triggers group an algorithm and a turned scramble keeps its case", async () => {
    expect(groupMoves("R U R' U' R' F R F'")).toEqual([
      ["R", "U", "R'", "U'"],
      ["R'", "F", "R", "F'"],
    ]);
    expect(groupMoves("F R U R' U' F'")).toEqual([
      ["F"],
      ["R", "U", "R'", "U'"],
      ["F'"],
    ]);
    // Recolouring four times is the identity; the top colour never moves.
    const t = trainerSet("pll").find((c) => c.label === "T");
    const picture = pictureOf(t as NonNullable<typeof t>);
    expect(recolour(picture, 4)).toBe(picture);
    expect(recolour(picture, 1).slice(0, 9)).toBe(picture.slice(0, 9));
    expect(recolour(picture, 1)).not.toBe(picture);
    // A T scramble turned about the top is still a T, with the first two layers whole.
    const puzzle = await kpuzzle();
    const scramble = "R U R' U' R' F R2 U' R' U' R U R' F'";
    for (let k = 0; k < 4; k++)
      expect(
        classifyLL(puzzle.defaultPattern().applyAlg(turnScramble(scramble, k)))
          .pll,
      ).toBe(t?.id);
  });

  it("a trigger is marked, the moves between triggers are not", () => {
    expect(algGroups("F R U R' U' F'")).toEqual([
      { moves: ["F"], trigger: false },
      { moves: ["R", "U", "R'", "U'"], trigger: true },
      { moves: ["F'"], trigger: false },
    ]);
  });

  it("an algorithm breaks between groups and never leaves one move alone", () => {
    const moves = (units: ReturnType<typeof algUnits>) =>
      units.map((u) => u.flatMap((g) => g.moves).join(" "));
    // The lone F and F' hold on to the trigger beside them.
    expect(moves(algUnits("F R U R' U' F'"))).toEqual(["F R U R' U' F'"]);
    // A long run between triggers is cut into even pieces; a piece goes on from the run
    // before it (no group gap), a new group starts with one.
    const ab = algUnits("x R2 D2 R U R' D2 R U' R x'");
    expect(moves(ab)).toEqual(["x R2 D2", "R U R'", "D2 R U'", "R x'"]);
    expect(ab.map((u) => u[0]?.cont ?? false)).toEqual([
      false,
      false,
      false,
      true,
    ]);
    for (const set of ["pll", "oll", "coll", "f2l"] as const)
      for (const c of trainerSet(set))
        for (const alg of c.algs) {
          const units = algUnits(alg.moves);
          const all = alg.moves.trim().split(/\s+/);
          expect(units.flat().flatMap((g) => g.moves)).toEqual(all);
          for (const unit of units) {
            const n = unit.reduce((sum, g) => sum + g.moves.length, 0);
            expect(n, `${c.label}: ${alg.moves}`).toBeGreaterThan(1);
            expect(n, `${c.label}: ${alg.moves}`).toBeLessThanOrEqual(7);
          }
          // A trigger is never cut.
          for (const g of algGroups(alg.moves).filter((g) => g.trigger))
            expect(
              units.some((u) =>
                u.some(
                  (x) => x.trigger && x.moves.join(" ") === g.moves.join(" "),
                ),
              ),
            ).toBe(true);
        }
  });
});
