import { expect, test } from "vitest";
import {
  formatAverage,
  formatPenaltySum,
  formatSolve,
  formatTime,
} from "./index";

test.each([
  [12345, "12.34"],
  [12349, "12.34"],
  [980, "0.98"],
  [0, "0.00"],
  [59999, "59.99"],
  [60000, "1:00.00"],
  [62345, "1:02.34"],
  [3723450, "1:02:03"],
  [Infinity, "DNF"],
  [NaN, ""],
])("formatTime(%s) truncates to %s", (ms, expected) => {
  expect(formatTime(ms)).toBe(expected);
});

test("supports millisecond precision", () => {
  expect(formatTime(12345, { precision: 3 })).toBe("12.345");
});

test.each([
  [12485, "12.49"],
  [12484.9, "12.48"],
  [59995, "1:00.00"],
  [3723455, "1:02:03"],
  [12480, "12.48"],
  [Infinity, "DNF"],
  [NaN, ""],
])("formatAverage(%s) rounds half up to %s", (ms, expected) => {
  expect(formatAverage(ms)).toBe(expected);
});

test("formatAverage supports millisecond precision", () => {
  expect(formatAverage(11000.3333, { precision: 3 })).toBe("11.000");
  expect(formatAverage(11000.5, { precision: 3 })).toBe("11.001");
});

test("9f4: formats accumulated penalties with one suffix and DNF precedence", () => {
  expect(formatSolve({ timeMs: 11280, plus2: 0, dnf: false })).toBe("11.28");
  expect(formatSolve({ timeMs: 11280, plus2: 1, dnf: false })).toBe("13.28+");
  expect(formatSolve({ timeMs: 11280, plus2: 2, dnf: false })).toBe("15.28+");
  expect(formatSolve({ timeMs: 11280, plus2: 2, dnf: true })).toBe("DNF");
});

test("A7b4 9f4: show the penalty sum for a valid solve with penalties", () => {
  expect(formatPenaltySum({ timeMs: 10000, plus2: 2, dnf: false })).toBe(
    "10.00 + 4 = 14.00",
  );
  expect(formatPenaltySum({ timeMs: 10000, plus2: 0, dnf: false })).toBe("");
  expect(formatPenaltySum({ timeMs: 10000, plus2: 2, dnf: true })).toBe("");
});

test("9f2: optional millisecond precision still omits fractions from 10 minutes", () => {
  expect(formatTime(600990, { precision: 3 })).toBe("10:00");
  expect(formatAverage(600500, { precision: 3 })).toBe("10:01");
});

test("E2d: a Fewest Moves solve is written as its OBTM count", () => {
  expect(
    formatSolve({ event: "333fm", timeMs: 0, plus2: 0, dnf: false, moves: 4 }),
  ).toBe("4");
});

test("9f2 9f2+: a Multi-Blind solve is written as cubes and whole seconds", () => {
  expect(
    formatSolve({
      event: "333mbf",
      timeMs: 2430870,
      plus2: 0,
      dnf: false,
      cubesSolved: 3,
      cubesAttempted: 5,
    }),
  ).toBe("3/5 40:30");
});
