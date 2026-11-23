import type { Solve } from "@cubehaus/core";
import { expect, test } from "vitest";
import { spokenResult } from "./file-result";

const solve: Solve = {
  id: "a",
  sessionId: "s",
  event: "333",
  timeMs: 11_284,
  plus2: 0,
  dnf: false,
  scramble: "R",
  startedAt: 0,
  inspectionMs: null,
  comment: null,
  input: "keyboard",
};

test("a result is said with its penalty in words a screen reader reads plainly", () => {
  expect(spokenResult(solve)).toBe("11.28");
  expect(spokenResult({ ...solve, plus2: 1 })).toBe("13.28, +2");
  expect(spokenResult({ ...solve, plus2: 2 })).toBe("15.28, +4");
  expect(spokenResult({ ...solve, dnf: true })).toBe("DNF, 11.28");
  expect(spokenResult({ ...solve, plus2: 1, dnf: true })).toBe("DNF, 11.28");
  expect(spokenResult({ ...solve, event: "333fm", moves: 27 })).toBe("27");
});
