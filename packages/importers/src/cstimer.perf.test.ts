import { expect, test } from "vitest";
import { ImportFormatError, parseCsTimer } from "./cstimer";

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

test("rejects 60 MB of garbage within two seconds of CPU", () => {
  const garbage = "x".repeat(60_000_000);
  const ms = cpuBestOf(3, () =>
    expect(() => parseCsTimer(garbage)).toThrow(ImportFormatError),
  );
  console.info(`60 MB of garbage rejected in ${ms.toFixed(1)} ms of CPU`);
  expect(ms).toBeLessThan(2000);
});
