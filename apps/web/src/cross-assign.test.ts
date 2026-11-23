import type { Solve } from "@cubehaus/core";
import { expect, it } from "vitest";
import { createCrossAssigner, crossHistory } from "./cross-assign";

const solve = (
  id: string,
  extra: Partial<Solve> = {},
  sessionId = "s",
): Solve => ({
  id,
  sessionId,
  event: "333",
  timeMs: 10_000,
  plus2: 0,
  dnf: false,
  scramble: `scramble ${id}`,
  startedAt: Number(id),
  inspectionMs: null,
  comment: null,
  input: "keyboard",
  ...extra,
});

it("reads the session's solves with a colour, oldest first, a penalty in the value", () => {
  const newestFirst = [
    solve("4", { crossColour: "yellow", dnf: true }),
    solve("3"),
    solve("2", { crossColour: "white", plus2: 1 }),
    solve("1", { crossColour: "yellow" }),
  ];
  expect(crossHistory(newestFirst, null, "s")).toEqual([
    { colour: "yellow", value: 10_000 },
    { colour: "white", value: 12_000 },
    { colour: "yellow", value: Infinity },
  ]);
});

it("counts a solve just made that the list does not hold yet, once", () => {
  const rows = [solve("1", { crossColour: "white" })];
  const recent = solve("2", { crossColour: "yellow" });
  expect(crossHistory(rows, recent, "s")).toHaveLength(2);
  expect(crossHistory([recent, ...rows], recent, "s")).toHaveLength(2);
  // One from another session is not this session's.
  expect(crossHistory(rows, { ...recent, sessionId: "t" }, "s")).toHaveLength(
    1,
  );
});

it("keeps the colour a scramble was shown with, while that colour is in play", () => {
  const assign = createCrossAssigner();
  const white = assign.colourFor("R U", ["white", "yellow"], []);
  expect(white).toBe("white");
  // Twelve whites later the rule would say yellow; the scramble keeps its colour.
  const twelve = Array.from({ length: 12 }, () => ({
    colour: "white" as const,
    value: 10_000,
  }));
  expect(assign.colourFor("R U", ["white", "yellow"], twelve)).toBe("white");
  expect(assign.colourFor("F D", ["white", "yellow"], twelve)).toBe("yellow");
  // White out of play: the scramble is assigned again.
  expect(assign.colourFor("R U", ["yellow"], twelve)).toBe("yellow");
  // A colour set by hand (a drill made for it) stands.
  assign.keep("L B", "green");
  expect(assign.colourFor("L B", ["green", "blue"], twelve)).toBe("green");
});
