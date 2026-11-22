import { expect, test } from "vitest";
import {
  best,
  parseStat,
  type Stat,
  statOf,
  summary,
  trimCount,
} from "./index";

const ao5: Stat = { kind: "ao", n: 5 };
const mo3: Stat = { kind: "mo", n: 3 };

function steps(step: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => step * (i + 1));
}

test.each([
  [[12340, 11200, 15060, 13000, 12100], ao5, 12480],
  [[10000, Infinity, 12000, 11000, 13000], ao5, 12000],
  [[10000, Infinity, 12000, Infinity, 13000], ao5, Infinity],
  [steps(1000, 12), { kind: "ao", n: 12 } as Stat, 6500],
  [steps(100, 50), { kind: "ao", n: 50 } as Stat, 2550],
  [steps(10, 100), { kind: "ao", n: 100 } as Stat, 505],
  [[10000, Infinity, 12000], mo3, Infinity],
  [[1000, 2000, 3000, 4000], ao5, NaN],
])("statOf(%j, %j) is %s", (values, stat, expected) => {
  expect(statOf(values, stat)).toBe(expected);
});

test("mo3 is the plain mean as a float", () => {
  expect(statOf([10000, 11000, 12001], mo3)).toBeCloseTo(11000.3333, 4);
});

test("statOf looks at the n values ending at end", () => {
  const values = [1000, 2000, 3000, 4000, 5000, 60000];
  expect(statOf(values, mo3, 2)).toBe(2000);
  expect(statOf(values, ao5, 4)).toBe(3000);
  expect(statOf(values, mo3, 1)).toBeNaN();
});

test.each([
  ["ao5", { kind: "ao", n: 5 }],
  ["ao100", { kind: "ao", n: 100 }],
  ["mo3", { kind: "mo", n: 3 }],
  ["mo2", { kind: "mo", n: 2 }],
])("parseStat(%s)", (id, expected) => {
  expect(parseStat(id)).toEqual(expected);
});

test.each(["ao4", "mo1", "avg5", "ao", "ao5x", "ao05", ""])(
  "parseStat(%j) is null",
  (id) => {
    expect(parseStat(id)).toBeNull();
  },
);

test.each([
  [5, 1],
  [12, 1],
  [50, 3],
  [100, 5],
  [1000, 50],
])("trimCount(%s) is %s", (n, expected) => {
  expect(trimCount(n)).toBe(expected);
});

test("best is the earliest smallest finite value", () => {
  expect(best(Float64Array.of(NaN, 12, Infinity, 9, 9, 15))).toEqual({
    index: 3,
    value: 9,
  });
});

test("best is null when nothing is finite", () => {
  expect(best(Float64Array.of(NaN, Infinity))).toBeNull();
  expect(best(new Float64Array(0))).toBeNull();
});

test("summary counts, finds best and worst finite values and their mean", () => {
  expect(summary(Float64Array.of(12000, Infinity, 9000, 15000, 15000))).toEqual(
    {
      count: 5,
      dnfCount: 1,
      best: { index: 2, value: 9000 },
      worst: { index: 3, value: 15000 },
      mean: 12750,
    },
  );
});

test("summary of only DNFs has no best, no worst and a NaN mean", () => {
  const result = summary(Float64Array.of(Infinity, Infinity));
  expect(result.count).toBe(2);
  expect(result.dnfCount).toBe(2);
  expect(result.best).toBeNull();
  expect(result.worst).toBeNull();
  expect(result.mean).toBeNaN();
});

test.each([0, 3, 5])(
  "statOf rejects NaN at input index %s, even outside the window",
  (index) => {
    const values = Float64Array.of(0, 1, 2, 3, 4, 5);
    values[index] = NaN;
    expect(() => statOf(values, ao5, 4)).toThrow(
      new RangeError(`NaN at index ${index}`),
    );
    expect(() => statOf(values, mo3, 1)).toThrow(
      new RangeError(`NaN at index ${index}`),
    );
  },
);

test.each(["ao", "mo"])("parseStat rejects unsafe %s window sizes", (kind) => {
  expect(parseStat(kind + "9".repeat(310))).toBeNull();
  expect(parseStat(`${kind}9007199254740992`)).toBeNull();
  expect(parseStat(kind + Number.MAX_SAFE_INTEGER)).toEqual({
    kind,
    n: Number.MAX_SAFE_INTEGER,
  });
});
