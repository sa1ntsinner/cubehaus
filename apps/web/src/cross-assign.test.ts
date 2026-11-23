import type { Solve } from "@cubehaus/core";
import { expect, it } from "vitest";
import { colourNews, createCrossAssigner, crossHistory } from "./cross-assign";

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

it("says when a block of a new colour starts and when the mix begins, and nothing else", () => {
  const colours = ["white", "yellow"] as const;
  const run = (colour: "white" | "yellow", n: number, value: number) =>
    Array.from({ length: n }, () => ({ colour, value }));
  // Nothing known yet: the first block starts without a word.
  expect(colourNews([], colours, "white")).toBeNull();
  // Inside a block: nothing.
  expect(colourNews(run("white", 5, 9000), colours, "white")).toBeNull();
  // Twelve whites done: the next block is yellow's.
  expect(colourNews(run("white", 12, 9000), colours, "yellow")).toEqual({
    kind: "block",
    colour: "yellow",
  });
  // Yellow's block done and within 25 % of white: the mix begins, once.
  const both = [...run("white", 12, 9000), ...run("yellow", 12, 11_000)];
  expect(colourNews(both, colours, "white")).toEqual({ kind: "mixed" });
  expect(
    colourNews([...both, { colour: "white", value: 9000 }], colours, "yellow"),
  ).toBeNull();
  // Still far behind: blocks go on, the next one white's again.
  const far = [...run("white", 12, 9000), ...run("yellow", 12, 13_000)];
  expect(colourNews(far, colours, "white")).toEqual({
    kind: "block",
    colour: "white",
  });
});
