import { classifyLL } from "@cubehaus/scramble/last-layer";
import { describe, expect, it } from "vitest";
import { pictureOf, trainerSet } from "./index";
import { algGroups, groupMoves, recolour, turnScramble } from "./show";
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
});
