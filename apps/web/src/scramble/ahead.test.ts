import type { EventId } from "@cubehaus/core";
import { expect, test } from "vitest";
import {
  aheadKey,
  keepAhead,
  readAheadKey,
  takeKept,
  warmEvents,
} from "./ahead";

test("a Multi-Blind attempt of more than two cubes has a queue of its own", () => {
  expect(aheadKey("444", null)).toBe("444");
  expect(aheadKey("333mbf", 2)).toBe("333mbf");
  expect(aheadKey("333mbf", 7)).toBe("333mbf:7");
  expect(readAheadKey("333mbf:7")).toEqual({ event: "333mbf", cubes: 7 });
  expect(readAheadKey("sq1")).toEqual({ event: "sq1", cubes: null });
});

test("the puzzles warmed ahead are those of the sessions in use, the open one aside", () => {
  const session = (event: EventId, archived = false) => ({ event, archived });
  expect(
    warmEvents(
      [
        session("333"),
        session("444"),
        session("444"),
        session("sq1"),
        session("minx", true),
        session("555"),
      ],
      "333",
    ),
  ).toEqual(["444", "sq1", "555"]);
});

test("scrambles made ahead outlive a reload once: kept on leaving, taken once on coming back", () => {
  const items = new Map<string, string>();
  const storage = {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  };
  keepAhead(storage, { "444": ["A", "B"], "333mbf:5": ["C"], sq1: [] });
  const kept = takeKept(storage);
  // Taken: another tab or a second reload finds none of them.
  expect(takeKept(storage).next("444")).toBeNull();
  expect(kept.next("444")).toBe("A");
  expect(kept.next("444")).toBe("B");
  expect(kept.next("444")).toBeNull();
  expect(kept.next("333mbf:5")).toBe("C");
  expect(kept.next("sq1")).toBeNull();
  // Anything unreadable is nothing kept.
  storage.setItem("cubehaus.scrambles-ahead", "{oops");
  expect(takeKept(storage).next("444")).toBeNull();
  storage.setItem("cubehaus.scrambles-ahead", '{"444":[1,"R"]}');
  expect(takeKept(storage).next("444")).toBeNull();
});
