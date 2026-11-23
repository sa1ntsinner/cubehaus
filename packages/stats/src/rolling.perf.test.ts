import { expect, test } from "vitest";
import { rolling } from "./index";

// Host APIs only the speed budget needs; the package itself uses none.
declare const process: {
  cpuUsage(previous?: { user: number; system: number }): {
    user: number;
    system: number;
  };
};
declare const console: { info(message: string): void };

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

// Integer milliseconds between 5 and 30 s with 3 % DNFs, from a seeded generator.
function solves(count: number, seed: number): Float64Array {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const values = new Float64Array(count);
  for (let i = 0; i < count; i++)
    values[i] = next() < 0.03 ? Infinity : 5000 + Math.floor(next() * 25000);
  return values;
}

test.each([100, 1000])(
  "rolling ao%s over 100,000 values takes under 2 s of CPU",
  (n) => {
    const values = solves(100_000, 42);
    let length = 0;
    const ms = cpuBestOf(3, () => {
      length = rolling(values, { kind: "ao", n }).length;
    });
    console.info(
      `rolling ao${n} over 100,000 values: ${ms.toFixed(1)} ms of CPU`,
    );
    expect(length).toBe(values.length);
    expect(ms).toBeLessThan(2000);
  },
);
