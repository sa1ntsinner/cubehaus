import { expect, test } from "vitest";
import {
  countMoves,
  formatMoves,
  formatMulti,
  formatMultiValue,
  multiLimitMs,
  multiPoints,
  multiValue,
  resultValue,
  type Solve,
} from "./index";

test("E2d and 12a5: R U R' x U2 gives 4 OBTM and 5 ETM", () => {
  expect(countMoves("R U R' x U2")).toEqual({ obtm: 4, etm: 5 });
  expect(countMoves("Uw z")).toEqual({ obtm: 1, etm: 2 });
});

test("E2c4, E2c2++ and E2c6: correct case, reject slice moves and brackets", () => {
  expect(countMoves("  r \n uW Y' Z2  ")).toEqual({ obtm: 2, etm: 4 });
  expect(countMoves("r U M")).toEqual({ error: expect.stringContaining("M") });
  expect(countMoves("[r]")).toEqual({ error: expect.stringContaining("[r]") });
});

test("12a2: the optional layer count for a 3x3x3 wide move is 2", () => {
  expect(countMoves("2Rw")).toEqual({ obtm: 1, etm: 1 });
  expect(countMoves("3Rw")).toEqual({ error: expect.stringContaining("3Rw") });
});

test("E2c4++: R2' is R2 and counts once", () => {
  expect(countMoves("R2'")).toEqual({ obtm: 1, etm: 1 });
});

test("9f10 and WCA export readme: [24, 25, 27] gives a mean of 25.33", () => {
  expect(formatMoves((24 + 25 + 27) / 3, { mean: true })).toBe("25.33");
  expect(formatMoves(25)).toBe("25");
  expect(formatMoves(Infinity)).toBe("DNF");
});

test("9f12c and H1a: Multi-Blind scores solved minus unsolved or is DNF", () => {
  expect(multiPoints(3, 5)).toBe(1);
  expect(multiPoints(2, 2)).toBe(2);
  expect(multiPoints(2, 4)).toBe(0);
  expect(multiPoints(1, 2)).toBeNull();
  expect(multiPoints(2, 5)).toBeNull();
  expect(multiPoints(1, 1)).toBeNull();
  expect(multiValue(1, 2, 0)).toBe(Infinity);
});

test("H1b: 3 cubes get 30 minutes, 8 get 60 minutes", () => {
  expect(multiLimitMs(3)).toBe(30 * 60 * 1000);
  expect(multiLimitMs(8)).toBe(60 * 60 * 1000);
});

test("H1b1: stopping at 30:00 with 3/3 gives 3/3 30:00", () => {
  const limit = multiLimitMs(3);
  expect(formatMulti(3, 3, limit)).toBe("3/3 30:00");
  expect(multiValue(3, 3, limit)).toBeLessThan(Infinity);
});

test("9f2: Multi-Blind truncates 40:30.87 to 40:30", () => {
  expect(formatMulti(3, 5, 2430870)).toBe("3/5 40:30");
  expect(multiValue(3, 5, 2430870)).toBe(multiValue(3, 5, 2430000));
  expect(formatMulti(2, 2, 59999)).toBe("2/2 59");
});

test("9f12c and WCA export readme: order by points, time, then unsolved", () => {
  expect(multiValue(5, 5, 3000000)).toBeLessThan(multiValue(3, 5, 2430870));
  expect(multiValue(6, 7, 2400000)).toBeLessThan(multiValue(5, 5, 3000000));
  expect(multiValue(8, 8, 2400000)).toBeLessThan(multiValue(9, 10, 2400000));
  expect(multiValue(3, 5, 2430870)).toBe(980243002);
});

test("E2d, 9f12c and H1d: statistics use the event result, with DNF last", () => {
  const solve: Solve = {
    id: "solve",
    sessionId: "session",
    event: "333",
    timeMs: 2430870,
    plus2: 2,
    dnf: false,
    scramble: "R",
    startedAt: 0,
    inspectionMs: null,
    comment: null,
    input: "manual",
  };
  expect(resultValue({ ...solve, event: "333fm", moves: 25 })).toBe(25);
  expect(resultValue({ ...solve, event: "333fm" })).toBe(Infinity);
  const multi: Solve = {
    ...solve,
    event: "333mbf",
    cubesSolved: 3,
    cubesAttempted: 5,
  };
  expect(resultValue(multi)).toBe(multiValue(3, 5, solve.timeMs + 4000));
  expect(resultValue({ ...multi, dnf: true })).toBe(Infinity);
  expect(resultValue({ ...solve, event: "333mbf" })).toBe(Infinity);
});

test("H1c: a Multi-Blind value reads back as solved/attempted and time", () => {
  expect(formatMultiValue(multiValue(3, 5, 2_430_000))).toBe("3/5 40:30");
  expect(formatMultiValue(multiValue(2, 2, 61_000))).toBe("2/2 1:01");
  expect(formatMultiValue(Infinity)).toBe("DNF");
});
