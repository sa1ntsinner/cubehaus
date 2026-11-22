import { expect, test } from "vitest";
import { effectiveMs, inspectionPenalty, nextPlus2, penaltyOf } from "./index";

test.each([
  [null, 0, false],
  [14999, 0, false],
  [15000, 1, false],
  [16999, 1, false],
  [17000, 0, true],
  [18000, 0, true],
])("inspection penalty at %s", (ms, plus2, dnf) => {
  expect(inspectionPenalty(ms)).toEqual({ plus2, dnf });
});

test("9f4: effective time adds all time penalties and DNF wins", () => {
  expect(effectiveMs({ timeMs: 12340, plus2: 0, dnf: false })).toBe(12340);
  expect(effectiveMs({ timeMs: 12340, plus2: 1, dnf: false })).toBe(14340);
  expect(effectiveMs({ timeMs: 12340, plus2: 2, dnf: false })).toBe(16340);
  expect(effectiveMs({ timeMs: 12340, plus2: 2, dnf: true })).toBe(Infinity);
});

test("9f4: penaltyOf summarizes the stored penalties", () => {
  expect(penaltyOf({ plus2: 0, dnf: false })).toBe("ok");
  expect(penaltyOf({ plus2: 2, dnf: false })).toBe("plus2");
  expect(penaltyOf({ plus2: 0, dnf: true })).toBe("dnf");
  expect(penaltyOf({ plus2: 2, dnf: true })).toBe("dnf");
});

test("A4e A6i: the hand +2 toggles on top of the inspection penalty", () => {
  expect(nextPlus2({ inspectionMs: null, plus2: 0 })).toBe(1);
  expect(nextPlus2({ inspectionMs: null, plus2: 1 })).toBe(0);
  expect(nextPlus2({ inspectionMs: 15800, plus2: 1 })).toBe(2);
  expect(nextPlus2({ inspectionMs: 15800, plus2: 2 })).toBe(1);
  expect(nextPlus2({ inspectionMs: 15800, plus2: 0 })).toBe(2);
  expect(nextPlus2({ inspectionMs: 17000, plus2: 0 })).toBe(1);
});
