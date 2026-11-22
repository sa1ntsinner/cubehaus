import { expect, test } from "vitest";
import { formatAverage } from "../../core/src/format";
import { parseStat, statOf } from "./index";

function score(id: "ao5" | "mo3", values: number[]) {
  const stat = parseStat(id);
  if (!stat) throw new Error(`Expected a valid stat: ${id}`);
  return formatAverage(statOf(values, stat));
}

test("9f8: Ao5 drops the fastest and slowest of five attempts", () => {
  expect(score("ao5", [10000, 11000, 12000, 13000, 14000])).toBe("12.00");
});

test("9f9: Ao5 drops one DNF as the worst attempt", () => {
  expect(score("ao5", [10000, 11000, 12000, 13000, Infinity])).toBe("12.00");
});

test("9f9: Ao5 with a DNF and a DNS is DNF", () => {
  // DNF and DNS both use the worst value in the numeric stats API.
  expect(score("ao5", [10000, 11000, 12000, Infinity, Infinity])).toBe("DNF");
});

test("9f1: Ao5 rounds the trimmed mean to the nearest hundredth", () => {
  expect(score("ao5", [10000, 10010, 10020, 10020, 11000])).toBe("10.02");
});

test("9f10: Mo3 is the arithmetic mean of all three attempts", () => {
  expect(score("mo3", [60000, 61000, 62010])).toBe("1:01.00");
  expect(score("mo3", [1000, 1000, 1010])).toBe("1.00");
});

test("9f11: one DNF makes a Mo3 DNF", () => {
  expect(score("mo3", [60000, 61000, Infinity])).toBe("DNF");
});
