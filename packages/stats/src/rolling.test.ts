import { expect, test } from "vitest";
import { rolling, type Stat, statOf } from "./index";

// Mulberry32: a small seeded generator, so every run sees the same values.
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer milliseconds between 5 and 30 s, with the given share of DNFs.
function solves(count: number, seed: number, dnfShare: number): Float64Array {
  const next = random(seed);
  const values = new Float64Array(count);
  for (let i = 0; i < count; i++)
    values[i] =
      next() < dnfShare ? Infinity : 5000 + Math.floor(next() * 25000);
  return values;
}

test("rolling ao5 over a rising series", () => {
  const values = Float64Array.of(1000, 2000, 3000, 4000, 5000, 6000, 7000);
  expect(Array.from(rolling(values, { kind: "ao", n: 5 }))).toEqual([
    NaN,
    NaN,
    NaN,
    NaN,
    3000,
    4000,
    5000,
  ]);
});

test.each<Stat>([
  { kind: "ao", n: 5 },
  { kind: "ao", n: 12 },
  { kind: "ao", n: 100 },
  { kind: "mo", n: 3 },
])("rolling %j equals statOf at every index", (stat) => {
  const values = solves(2000, 20261117, 0.03);
  const series = rolling(values, stat);
  expect(series.length).toBe(values.length);
  for (let i = 0; i < values.length; i++)
    expect(series[i], `index ${i}`).toBe(statOf(values, stat, i));
});

test("rolling handles a window full of DNFs and leaving it again", () => {
  const values = Float64Array.of(
    Infinity,
    Infinity,
    1000,
    Infinity,
    2000,
    3000,
    4000,
    5000,
  );
  const stat: Stat = { kind: "ao", n: 5 };
  const series = rolling(values, stat);
  for (let i = 0; i < values.length; i++)
    expect(series[i], `index ${i}`).toBe(statOf(values, stat, i));
});

test.each<Stat>([
  { kind: "ao", n: 5 },
  { kind: "mo", n: 3 },
])("rolling rejects NaN once per call for %j", (stat) => {
  for (const index of [0, 3, 5]) {
    const values = Float64Array.of(0, 1, 2, 3, 4, 5);
    values[index] = NaN;
    expect(() => rolling(values, stat)).toThrow(
      new RangeError(`NaN at index ${index}`),
    );
  }
});

test.each<Stat>([
  { kind: "ao", n: Number.MAX_SAFE_INTEGER },
  { kind: "mo", n: Number.MAX_SAFE_INTEGER },
])(
  "rolling returns unavailable values without allocating an oversized %j window",
  (stat) => {
    expect(rolling(Float64Array.of(1, 2, 3), stat)).toEqual(
      Float64Array.of(NaN, NaN, NaN),
    );
  },
);

test("large trimmed windows handle ties and DNFs through every slide", () => {
  const values = Float64Array.from({ length: 1700 }, (_, i) =>
    i % 16 === 0 || (i >= 600 && i < 640)
      ? Infinity
      : 7500 + ((i * 937) % 300) * 10,
  );
  for (const n of [128, 131, 400, 1200]) {
    const stat = { kind: "ao", n } as const;
    const actual = rolling(values, stat);
    for (let end = n - 1; end < values.length; end += 7)
      expect(actual[end]).toBe(statOf(values, stat, end));
  }
});
