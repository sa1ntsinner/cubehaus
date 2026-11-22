import { expect, test } from "vitest";
import { byDay, histogram, pbHistory, practice, quantile } from "./index";

test("personal bests exclude ties, DNFs and unavailable averages", () => {
  expect(pbHistory(Float64Array.of(12, 11, 11, 13, 9, NaN, 8))).toEqual([
    0, 1, 4, 6,
  ]);
  expect(pbHistory(Float64Array.of(Infinity, NaN, 12, Infinity, 10))).toEqual([
    2, 4,
  ]);
});

test("quantile linearly interpolates sorted finite values", () => {
  const values = Float64Array.of(1, 2, 3, 4);
  expect(quantile(values, 0.5)).toBe(2.5);
  expect(quantile(values, 0)).toBe(1);
  expect(quantile(values, 1)).toBe(4);
  expect(quantile(new Float64Array(), 0.5)).toBeNaN();
});

test("practice counts only whole days between sessions", () => {
  expect(practice(["2026-03-14", "2026-11-11"])).toEqual({
    activeDays: 2,
    longestBreak: { days: 241, from: "2026-03-14", to: "2026-11-11" },
    longestRun: { days: 1, from: "2026-03-14", to: "2026-03-14" },
  });
});

test("practice counts February 29 in a consecutive run", () => {
  expect(practice(["2024-02-28", "2024-02-29", "2024-03-01"])).toEqual({
    activeDays: 3,
    longestRun: { days: 3, from: "2024-02-28", to: "2024-03-01" },
    longestBreak: null,
  });
});

test("daily statistics count DNFs and use only finite times for quantiles", () => {
  const keys = ["2026-03-14", "2026-03-15", "2026-03-15", "2026-03-15"];
  expect(
    byDay(
      Float64Array.of(0, 1, 2, 3),
      Float64Array.of(Infinity, 3000, Infinity, 1000),
      (i) => keys[i] as string,
    ),
  ).toEqual([
    {
      day: "2026-03-14",
      count: 1,
      dnfCount: 1,
      best: NaN,
      median: NaN,
      p10: NaN,
      p90: NaN,
    },
    {
      day: "2026-03-15",
      count: 3,
      dnfCount: 1,
      best: 1000,
      median: 2000,
      p10: 1200,
      p90: 2800,
    },
  ]);
});

test("histogram fills gaps and ignores DNFs", () => {
  const expected = [
    { start: 1000, count: 2 },
    { start: 2000, count: 0 },
    { start: 3000, count: 0 },
    { start: 4000, count: 1 },
  ];
  expect(histogram(Float64Array.of(1000, 1900, 4100), 1000)).toEqual(expected);
  expect(histogram(Float64Array.of(1000, Infinity, 1900, 4100), 1000)).toEqual(
    expected,
  );
  expect(histogram(Float64Array.of(Infinity, NaN), 1000)).toEqual([]);
  expect(() => histogram(Float64Array.of(1000), 0)).toThrow(RangeError);
});
