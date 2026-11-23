import { expect, test } from "vitest";
import {
  calendarLevel,
  formatAxisTime,
  monthAbbreviation,
  monthLayout,
  trendGeometry,
  weekLayout,
  xTicks,
  yTicks,
} from "./progress-chart";

test("y ticks use the smallest round step with at most four ticks in the domain", () => {
  expect(yTicks(11_900, 13_100)).toEqual([12_000, 12_500, 13_000]);
  expect(yTicks(0, 10_000)).toEqual([0, 5_000, 10_000]);
  expect(yTicks(300, 850)).toEqual([400, 600, 800]);
});

test("axis labels express seconds without trailing zeros and minutes with padded seconds", () => {
  expect([12_000, 12_500, 65_000].map(formatAxisTime)).toEqual([
    "12",
    "12.5",
    "1:05",
  ]);
});

test("x ticks use round solve numbers with room for labels at both widths", () => {
  expect(xTicks(100, 1100, 948, 1000)).toEqual([
    100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100,
  ]);
  expect(xTicks(100, 1100, 348, 400)).toEqual([200, 400, 600, 800, 1000]);
});

test("dense plots average the values per column and leave all-DNF columns empty", () => {
  const series = [NaN, 1000, 3000, Infinity, Infinity, 5000, Infinity];
  const plot = trendGeometry(series, 1, 55, 100);
  expect(plot?.path).toMatch(/^M40\.5 [\d.]+ h0 M42\.5 [\d.]+ h0$/);
  expect(plot?.domain).toEqual([760, 5240]);
  expect(plot?.points).toEqual([
    { x: 40.5, value: 2000 },
    null,
    { x: 42.5, value: 5000 },
  ]);
});

test("dense buckets use the same x scale as the full-resolution points", () => {
  const plot = trendGeometry([1000, 2000, 3000, 4000, 5000], 0, 55, 100);
  expect(plot?.points.map((point) => point?.value)).toEqual([1500, 3000, 4500]);
});

test("sparse plots keep every solve, with gaps and a padded flat domain", () => {
  const plot = trendGeometry([1000, Infinity, 1000], 0, 152, 100);
  expect(plot?.path).toBe("M40 44 h0 M140 44 h0");
  expect(plot?.domain).toEqual([0, 2000]);
  expect(trendGeometry([Infinity], 0, 152, 100)).toBeNull();
});

test("picking uses full resolution and the nearest finite solve, preferring the earlier in a tie", () => {
  const plot = trendGeometry(
    [NaN, 1000, 2000, Infinity, Infinity, 5000, 6000],
    1,
    55,
    100,
  );
  if (!plot) throw new Error("Missing trend");
  expect(plot.pick(plot.x(2))).toBe(2);
  expect(plot.pick(plot.x(3))).toBe(2);
  expect(plot.pick(plot.x(4))).toBe(5);
  expect(plot.pick(0)).toBe(1);
  expect(plot.pick(100)).toBe(6);
  const tie = trendGeometry([1000, Infinity, 3000], 0, 100, 100);
  expect(tie?.pick(64)).toBe(0);
});

test("calendar levels use nearest rank quartiles of positive counts", () => {
  const levels = (counts: number[]) => counts.map(calendarLevel(counts));
  expect(levels([0, 1, 2, 3, 4, 40])).toEqual([0, 1, 1, 2, 3, 4]);
  expect(levels([0, 5, 5, 5, 5])).toEqual([0, 1, 1, 1, 1]);
  expect(levels([0, 0])).toEqual([0, 0]);
});

test("week layout starts on Monday and stops at today, with spaced year labels", () => {
  const days = new Map([
    ["2025-12-12", 2],
    ["2026-01-01", 5],
  ]);
  const grid = weekLayout(days, "2026-01-03", 90);
  expect(grid.cells[0]).toMatchObject({ day: "2025-12-08", x: 0 });
  expect(grid.cells.at(-1)).toMatchObject({ day: "2026-01-03", count: 0 });
  expect(grid.cells.find(({ day }) => day === "2026-01-01")).toMatchObject({
    x: 45,
    count: 5,
    level: 3,
  });
  expect(grid.years).toEqual([
    { year: 2025, x: 0 },
    { year: 2026, x: 45 },
  ]);
  const trimmed = weekLayout(days, "2026-01-03", 9);
  expect(trimmed.cells[0]?.day).toBe("2025-12-22");
  expect(trimmed.cells.at(-1)?.day).toBe("2026-01-03");
  expect(trimmed.years).toEqual([{ year: 2026, x: 4 }]);
  expect(weekLayout(days, "2026-01-03", 3).cells).toEqual([]);
});

test("week layout gives 1 January priority over a nearby first column label", () => {
  const grid = weekLayout(new Map([["2023-12-18", 1]]), "2024-03-01", 600);
  expect(grid.cell).toBe(14);
  expect(grid.years).toEqual([{ year: 2024, x: 30 }]);
});

test("week layout keeps the first column label when 1 January has room", () => {
  const grid = weekLayout(new Map([["2023-06-05", 1]]), "2024-03-01", 600);
  expect(grid.cell).toBe(14);
  expect(grid.years).toEqual([
    { year: 2023, x: 0 },
    { year: 2024, x: 450 },
  ]);
});

test("month layout groups counts by month and omits months outside the session span", () => {
  const days = new Map([
    ["2025-12-12", 2],
    ["2025-12-15", 4],
    ["2026-02-03", 2],
  ]);
  const grid = monthLayout(days, "2026-03-11", 280);
  expect(grid.cell).toBe(18);
  expect(grid.height).toBe(56);
  // Three letters need 28 px a month: at 20 px every other month is named.
  expect(grid.months.map(({ month }) => month)).toEqual([0, 2, 4, 6, 8, 10]);
  expect(grid.years).toEqual([
    { year: 2025, y: 25 },
    { year: 2026, y: 45 },
  ]);
  expect(grid.cells).toEqual([
    { year: 2025, month: 11, count: 6, level: 3, x: 260, y: 16 },
    { year: 2026, month: 0, count: 0, level: 0, x: 40, y: 36 },
    { year: 2026, month: 1, count: 2, level: 1, x: 60, y: 36 },
    { year: 2026, month: 2, count: 0, level: 0, x: 80, y: 36 },
  ]);
});

test("a wide month layout names every month", () => {
  const grid = monthLayout(new Map([["2026-01-02", 1]]), "2026-03-11", 400);
  expect(grid.months.map(({ month }) => month)).toEqual([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
  ]);
});

test("month names are three letters, so June and July differ in both languages", () => {
  const months = (locale: string) =>
    Array.from({ length: 12 }, (_, month) => monthAbbreviation(locale, month));
  expect(months("ru")).toEqual([
    "янв",
    "фев",
    "мар",
    "апр",
    "май",
    "июн",
    "июл",
    "авг",
    "сен",
    "окт",
    "ноя",
    "дек",
  ]);
  expect(months("en")).toEqual([
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ]);
  for (const locale of ["ru", "en", "en-GB"])
    expect(new Set(months(locale)).size).toBe(12);
});
