import { expect, test, vi } from "vitest";

vi.mock("cubing/scramble", () => {
  throw new Error("cubing.js was loaded");
});

test("the package entry exports the queue without loading cubing.js", async () => {
  const entry = await import("./index");
  expect(Object.keys(entry).sort()).toEqual([
    "ScrambleTimeoutError",
    "createScrambleSource",
    "defaultDepth",
    "officialTokens",
    "toOfficial",
  ]);
});
