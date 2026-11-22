import { formatAverage } from "@cubehaus/core";
import { best, parseStat, statOf } from "@cubehaus/stats";
import { expect, test } from "vitest";
import { createSessionStats } from "./session-stats";

const seconds = (count: number) =>
  Float64Array.from({ length: count }, (_, index) => (index + 1) * 1000);

test("custom ao20 and ao50 agree with the trimmed window oracle", () => {
  const values = seconds(20);
  const dates = seconds(20);
  const session = createSessionStats(values, dates, ["ao20", "ao50"]);
  expect(session.stats().ao20).toBe(10500);
  expect(session.stats()["ao20-best"]).toBe(10500);
  expect(session.stats().ao50).toBeNaN();

  session.change(19, true, { value: Infinity, at: 20_000 });
  expect(session.stats().ao20).toBe(10500);
  session.change(18, true, { value: Infinity, at: 19_000 });
  expect(session.stats().ao20).toBe(Infinity);

  const ao50 = createSessionStats(seconds(50), seconds(50), ["ao50"]);
  expect(ao50.stats().ao50).toBe(25_500);
  expect(ao50.upTo(48).ao50).toBeNaN();

  const custom = createSessionStats(seconds(100), seconds(100), [
    "ao5",
    "ao12",
    "ao100",
    "ao9007199254740991",
  ]);
  expect(custom.at("ao5", 4)).toBe(3000);
  expect(custom.at("ao12", 11)).toBe(6500);
  expect(custom.at("ao100", 99)).toBe(50500);
  expect(custom.stats().ao9007199254740991).toBeNaN();
  expect(parseStat("ao4")).toBeNull();
  expect(best(Float64Array.of(12345, 12345))).toEqual({
    value: 12345,
    index: 0,
  });

  const mo3 = createSessionStats(Float64Array.of(10000, 11000, Infinity));
  expect(mo3.stats().mo3).toBe(Infinity);
  expect(formatAverage(mo3.stats().mo3)).toBe("DNF");
  expect(formatAverage(12344.99)).toBe("12.34");
  expect(formatAverage(12345)).toBe("12.35");
});

test("ranked sessions update the current and historical windows after an edit and append", async () => {
  const values = seconds(200);
  const series = createSessionStats(values.slice(), seconds(200), ["ao128"]);
  const stat = { kind: "ao", n: 128 } as const;
  values[99] = Infinity;
  await series.change(99, true, { value: Infinity, at: 100000 });
  for (const end of [127, 140, 199])
    expect(series.at("ao128", end)).toBe(statOf(values, stat, end));
  await series.change(200, false, { value: 201000, at: 201000 });
  await series.change(201, false, { value: 202000, at: 202000 });
  const appended = Float64Array.from([...values, 201000, 202000]);
  expect(series.stats().ao128).toBe(statOf(appended, stat));
  await series.change(201, true);
  expect(series.stats().ao128).toBe(statOf(appended.subarray(0, 201), stat));
});
