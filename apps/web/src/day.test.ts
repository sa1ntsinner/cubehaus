import { distribution } from "@cubehaus/stats";
import { expect, test } from "vitest";
import { dailyMedians, dailyTotals, localDayKey, totalOn } from "./day";

test("Berlin local midnight near the spring daylight-saving change", () => {
  const zone = "Europe/Berlin";
  expect(localDayKey(Date.parse("2026-03-28T22:30:00Z"), zone)).toBe(
    "2026-03-28",
  );
  expect(localDayKey(Date.parse("2026-03-28T23:30:00Z"), zone)).toBe(
    "2026-03-29",
  );
});

test("the same instant falls on different days in Tokyo and Los Angeles", () => {
  const ms = Date.parse("2026-11-11T16:00:00Z");
  expect(localDayKey(ms, "Asia/Tokyo")).toBe("2026-11-12");
  expect(localDayKey(ms, "America/Los_Angeles")).toBe("2026-11-11");
  expect(localDayKey(ms)).toBe(
    localDayKey(ms, new Intl.DateTimeFormat().resolvedOptions().timeZone),
  );
});

test("today uses civil midnight and keeps DNF-only practice", () => {
  const zone = "Europe/Berlin";
  // 29 March 2026 is a 23-hour day in Berlin: it starts at 23:00 UTC the day before.
  const startedAt = Float64Array.from([
    Date.parse("2026-03-28T23:00:00Z"),
    Date.parse("2026-03-29T21:59:59Z"),
    Date.parse("2026-03-29T22:00:00Z"),
  ]);
  const values = Float64Array.from([10000, Infinity, 20000]);
  const totals = dailyTotals(startedAt, values, zone);
  expect(totals).toEqual([
    { day: "2026-03-29", count: 2, dnf: 1, mean: 10000 },
    { day: "2026-03-30", count: 1, dnf: 0, mean: 20000 },
  ]);
  expect(totalOn(totals, "2026-03-29")).toEqual(totals[0]);
  expect(totalOn(totals, "2026-03-31")).toEqual({
    day: "2026-03-31",
    count: 0,
    dnf: 0,
    mean: null,
  });
  // A day of DNFs only is a day of practice with no mean.
  expect(
    dailyTotals(
      Float64Array.from([Date.parse("2026-04-01T10:00:00Z")]),
      Float64Array.from([Infinity]),
      zone,
    ),
  ).toEqual([{ day: "2026-04-01", count: 1, dnf: 1, mean: null }]);

  const spread = distribution(
    Float64Array.from([10000, 10999, 12000, Infinity]),
    1000,
  );
  expect(spread.dnf).toBe(1);
  expect(spread.bins).toEqual([
    { start: 10000, count: 2 },
    { start: 11000, count: 0 },
    { start: 12000, count: 1 },
  ]);
  expect(distribution(new Float64Array(), 1000)).toEqual({ bins: [], dnf: 0 });
  // One long outlier widens the bins instead of allocating a bin per second.
  const outlier = distribution(Float64Array.from([10000, 3_600_000]), 1000);
  expect(outlier.bins.length).toBeLessThanOrEqual(40);
  expect(outlier.bins.reduce((n, bin) => n + bin.count, 0)).toBe(2);
});

test("daily medians read only the last 90 civil days and skip DNFs", () => {
  const zone = "Europe/Berlin";
  const at = (iso: string) => Date.parse(iso);
  const startedAt = Float64Array.from([
    at("2026-01-01T10:00:00Z"), // 91 days before 1 April: out
    at("2026-01-02T10:00:00Z"),
    at("2026-01-02T11:00:00Z"),
    at("2026-03-31T22:30:00Z"), // after Berlin midnight: 1 April
    at("2026-04-01T09:00:00Z"),
    at("2026-04-01T10:00:00Z"),
  ]);
  const values = Float64Array.from([
    9000,
    12000,
    14000,
    10000,
    Infinity,
    11000,
  ]);
  expect(
    dailyMedians(startedAt, values, at("2026-04-01T12:00:00Z"), 90, zone),
  ).toEqual([
    { day: "2026-01-02", medianMs: 13000, finiteCount: 2 },
    { day: "2026-04-01", medianMs: 10500, finiteCount: 2 },
  ]);
});
