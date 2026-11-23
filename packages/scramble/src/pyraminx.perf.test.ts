import { puzzles } from "cubing/puzzles";
import { randomScrambleForEvent } from "cubing/scramble";
import { expect, test } from "vitest";
import {
  createPyraminxSolver,
  type PyraminxMoves,
  splitPyraminx,
} from "./pyraminx";

/** The least CPU time, in ms, one run of `work` took over `runs` runs. */
function cpuBestOf(runs: number, work: () => unknown) {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) {
    const start = process.cpuUsage();
    work();
    const { user, system } = process.cpuUsage(start);
    best = Math.min(best, (user + system) / 1000);
  }
  return best;
}

test("the slowest of 200 eleven-move searches takes under 50 ms of CPU", async () => {
  const kpuzzle = await (
    puzzles.pyraminx as NonNullable<typeof puzzles.pyraminx>
  ).kpuzzle();
  const moves = Object.fromEntries(
    (["U", "L", "R", "B"] as const).map((face) => [
      face,
      kpuzzle.moveToTransformation(face).transformationData,
    ]),
  ) as unknown as PyraminxMoves;
  const build = cpuBestOf(1, () => createPyraminxSolver(moves));
  console.info(`Pyraminx table built in ${build.toFixed(0)} ms of CPU`);
  const solver = createPyraminxSolver(moves);
  let slowest = 0;
  for (let i = 0; i < 200; i++) {
    const { main } = splitPyraminx(
      (await randomScrambleForEvent("pyram")).toString(),
    );
    slowest = Math.max(
      slowest,
      cpuBestOf(3, () => solver.elevenMoves(solver.stateOf(main))),
    );
  }
  console.info(`slowest 11-move search: ${slowest.toFixed(1)} ms of CPU`);
  expect(slowest).toBeLessThan(50);
});
