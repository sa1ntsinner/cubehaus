import { expect, test } from "vitest";
import { forecast } from "./forecast";

/** Practice on consecutive civil days from 1 March 2026, five solves a day. */
function days(medians: readonly number[], from = "2026-03-01") {
  const start = Date.parse(from);
  return medians.map((medianMs, index) => ({
    day: new Date(start + index * 86_400_000).toISOString().slice(0, 10),
    medianMs,
    finiteCount: 5,
  }));
}

test("forecast distinguishes a falling trend from sparse flat or stale data", () => {
  const falling = days([16000, 15000, 14000, 13000, 12000, 11000, 10000]);
  const today = "2026-03-07";
  expect(forecast(falling, 9000, today)).toMatchObject({
    slopeMsPerDay: -1000,
    // Day 7 (8 March) reaches 9.00 exactly; day 8 is the first strictly below it.
    day: "2026-03-09",
    reason: "estimate",
    days: 7,
    solves: 35,
  });
  expect(
    forecast(
      days([12000, 12000, 12000, 12000, 12000, 12000, 12000]),
      9000,
      today,
    ),
  ).toMatchObject({ slopeMsPerDay: 0, day: null, reason: "flat" });
  expect(
    forecast(days([12000, 11000, 10000]), 9000, "2026-03-03"),
  ).toMatchObject({
    day: null,
    reason: "sparse",
  });
  expect(forecast(falling, 9000, "2026-04-07")).toMatchObject({
    day: null,
    reason: "stale",
  });
  expect(forecast(falling, 11000, today)).toMatchObject({ reason: "already" });
  expect(
    forecast(
      days([10000, 10100, 10200, 10300, 10400, 10500, 10600]),
      9000,
      today,
    ),
  ).toMatchObject({ reason: "rising", day: null });
  // A slow fall that would take more than a year abstains.
  expect(
    forecast(
      days([10060, 10050, 10040, 10030, 10020, 10010, 10000]),
      5000,
      today,
    ),
  ).toMatchObject({ reason: "distant", day: null });
  // Days with fewer than five finite solves do not count; seven such days are sparse.
  expect(
    forecast(
      falling.map((entry) => ({ ...entry, finiteCount: 4 })),
      9000,
      today,
    ),
  ).toMatchObject({ reason: "sparse" });
  // Only the last 90 days count: older practice does not lift a sparse recent month.
  const old = days([20000, 19000, 18000, 17000, 16000], "2025-11-01");
  expect(
    forecast(
      [...old, ...days([12000, 11000, 10000], "2026-03-05")],
      9000,
      today,
    ),
  ).toMatchObject({ reason: "sparse" });
});
