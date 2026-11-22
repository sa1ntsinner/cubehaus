import { puzzles } from "cubing/puzzles";
import { randomScrambleForEvent } from "cubing/scramble";
import { beforeAll, describe, expect, test } from "vitest";
import {
  createPyraminxSolver,
  type PyraminxMoves,
  type PyraminxSolver,
  splitPyraminx,
} from "./pyraminx";

let solver: PyraminxSolver;
let kpuzzle: Awaited<
  ReturnType<NonNullable<typeof puzzles.pyraminx>["kpuzzle"]>
>;
let buildMs = 0;

beforeAll(async () => {
  kpuzzle = await (
    puzzles.pyraminx as NonNullable<typeof puzzles.pyraminx>
  ).kpuzzle();
  const moves = Object.fromEntries(
    (["U", "L", "R", "B"] as const).map((face) => [
      face,
      kpuzzle.moveToTransformation(face).transformationData,
    ]),
  ) as unknown as PyraminxMoves;
  const started = performance.now();
  solver = createPyraminxSolver(moves);
  buildMs = performance.now() - started;
}, 60_000);

describe("Pyraminx: exactly 11 main moves, as the official program writes it", () => {
  test("the table covers the 933,120 states and the hardest is 11 moves away", () => {
    console.info(`Pyraminx table built in ${buildMs.toFixed(0)} ms`);
    expect(solver.census()).toEqual({ states: 933_120, deepest: 11 });
    expect(solver.distance(solver.stateOf(""))).toBe(0);
    expect(solver.distance(solver.stateOf("U"))).toBe(1);
    expect(solver.distance(solver.stateOf("U L"))).toBe(2);
  });

  test("200 library scrambles: 11 main moves, no vertex twice in a row, same state with the same tips", async () => {
    let slowest = 0;
    const distances = new Map<number, number>();
    for (let i = 0; i < 200; i++) {
      const library = (await randomScrambleForEvent("pyram")).toString();
      const { main, tips } = splitPyraminx(library);
      const started = performance.now();
      const state = solver.stateOf(main);
      distances.set(
        solver.distance(state),
        (distances.get(solver.distance(state)) ?? 0) + 1,
      );
      const eleven = solver.elevenMoves(state);
      slowest = Math.max(slowest, performance.now() - started);
      const moves = eleven.split(" ");
      expect(moves, library).toHaveLength(11);
      for (let j = 1; j < moves.length; j++)
        expect((moves[j] as string)[0], eleven).not.toBe(
          (moves[j - 1] as string)[0],
        );
      const official = [eleven, tips].filter(Boolean).join(" ");
      expect(
        kpuzzle
          .defaultPattern()
          .applyAlg(official)
          .isIdentical(kpuzzle.defaultPattern().applyAlg(library)),
        `${library} -> ${official}`,
      ).toBe(true);
    }
    console.info(`slowest 11-move search: ${slowest.toFixed(1)} ms`);
    console.info(
      "distances from solved, tips aside:",
      JSON.stringify([...distances].sort((a, b) => a[0] - b[0])),
    );
    expect(slowest).toBeLessThan(50);
  }, 120_000);
});
