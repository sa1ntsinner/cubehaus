import type { EventId } from "@cubehaus/core";
import { describe, expect, test } from "vitest";
import { cubingGenerate } from "./cubing";
import { officialShape } from "./shapes";

const events = Object.keys(officialShape) as EventId[];

describe("generated scrambles have the official form", () => {
  for (const event of events) {
    test(`${event === "fto" ? "draft 12f: " : ""}${event}: five scrambles`, async () => {
      for (let i = 0; i < 5; i++) {
        const scramble = await cubingGenerate(event);
        expect(scramble, `${event}: ${scramble}`).toMatch(officialShape[event]);
      }
    }, 60_000);
  }

  test("draft 12f: FTO allows U F R L B D BR BL with optional apostrophes", () => {
    expect("U' F R' L B' D BR' BL").toMatch(officialShape.fto);
    expect("U2 BR").not.toMatch(officialShape.fto);
    expect("BRw BL").not.toMatch(officialShape.fto);
  });

  test("333fm is R' U' F, a random state that does not merge with it, R' U' F", async () => {
    for (let i = 0; i < 5; i++) {
      const moves = (await cubingGenerate("333fm")).split(" ");
      expect(moves.slice(0, 3)).toEqual(["R'", "U'", "F"]);
      expect(moves.slice(-3)).toEqual(["R'", "U'", "F"]);
      // A random state's solution is usually 17 to 21 moves, rarely fewer.
      const inner = moves.slice(3, -3);
      expect(inner.length).toBeGreaterThan(0);
      expect(inner.length).toBeLessThanOrEqual(21);
      expect("FB").not.toContain(inner[0]?.[0]);
      expect("RL").not.toContain(inner.at(-1)?.[0]);
    }
  }, 60_000);

  test("4b3f: a Pyraminx scramble has 11 main moves and needs at least 6 moves, tips counted", async () => {
    const { createPyraminxSolver, splitPyraminx } = await import("./pyraminx");
    const { puzzles } = await import("cubing/puzzles");
    const kpuzzle = await (
      puzzles.pyraminx as NonNullable<typeof puzzles.pyraminx>
    ).kpuzzle();
    const solver = createPyraminxSolver(
      Object.fromEntries(
        (["U", "L", "R", "B"] as const).map((face) => [
          face,
          kpuzzle.moveToTransformation(face).transformationData,
        ]),
      ) as never,
    );
    for (let i = 0; i < 100; i++) {
      const { main, tips } = splitPyraminx(await cubingGenerate("pyram"));
      expect(main.split(" ")).toHaveLength(11);
      const tipMoves = tips.split(" ").filter(Boolean).length;
      expect(
        solver.distance(solver.stateOf(main)) + tipMoves,
      ).toBeGreaterThanOrEqual(6);
    }
  }, 60_000);

  test("333mbf with five cubes gives five different lines", async () => {
    const lines = (await cubingGenerate("333mbf", { cubes: 5 })).split("\n");
    expect(lines).toHaveLength(5);
    expect(new Set(lines).size).toBe(5);
  }, 60_000);
});
