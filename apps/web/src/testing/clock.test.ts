import { afterEach, expect, test } from "vitest";
import { pinClock } from "./clock";

const RealDate = Date;
afterEach(() => {
  globalThis.Date = RealDate;
});

test("a pinned clock starts at the given local time and keeps running", () => {
  const before = RealDate.now();
  pinClock("?state=progress-target&now=2026-11-22T12:00");
  const pinned = new RealDate(2026, 10, 22, 12).getTime();
  expect(Date.now() - pinned).toBeGreaterThanOrEqual(0);
  expect(Date.now() - pinned).toBeLessThan(1_000 + RealDate.now() - before);
  expect(new Date().getDate()).toBe(22);
  expect(new Date().getHours()).toBe(12);
  // Dates built from values are the same as ever.
  expect(new Date(2000, 0, 1).getFullYear()).toBe(2000);
  expect(new Date("2026-03-01T12:00:00Z").toISOString()).toBe(
    "2026-03-01T12:00:00.000Z",
  );
  expect(new Date(0).getTime()).toBe(0);
  expect(new Date() instanceof RealDate).toBe(true);
});

test("without a readable time the clock is left alone", () => {
  pinClock("?state=progress");
  expect(Date).toBe(RealDate);
  pinClock("?now=soon");
  expect(Date).toBe(RealDate);
});
