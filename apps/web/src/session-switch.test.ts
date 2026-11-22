import type { EventId, Session } from "@cubehaus/core";
import { expect, test } from "vitest";
import {
  enterRow,
  findMoveRows,
  findSwitchRows,
  nextEvent,
  normalizeQuery,
} from "./session-switch";

const session = (id: string, name: string, event: EventId): Session => ({
  id,
  name,
  event,
  orderKey: id,
  folderId: null,
  archived: false,
  createdAt: 1,
});

const a = session("a", "Main", "333");
const b = session("b", "Two", "222");
const oh = session("oh", "OH", "333oh");
const list = [a, b, oh];

test("previous session and event alias determine enter", () => {
  // S then Enter goes back to the session open before.
  const all = findSwitchRows("", list, "a", "en", "333");
  expect(all.slice(0, 3).map(({ id }) => id)).toEqual(["a", "b", "oh"]);
  expect(enterRow(all, "", "b", "a")).toMatchObject({
    kind: "session",
    id: "b",
  });
  // With no previous one, Enter stays.
  expect(enterRow(all, "", null, "a")).toMatchObject({ id: "a" });

  // An event's alias finds its session.
  const ohRows = findSwitchRows("oh", list, "a", "en", "333");
  expect(enterRow(ohRows, "oh", "b", "a")).toMatchObject({ id: "oh" });

  // A puzzle with no session yet is one row that creates it.
  const skewb = findSwitchRows("skewb", list, "a", "en", "333");
  expect(skewb[0]).toMatchObject({
    kind: "event",
    id: "skewb",
    label: "Skewb",
    event: "skewb",
  });
  expect(skewb.filter(({ kind }) => kind === "event")).toHaveLength(1);

  // A name that matches nothing creates a session in the current puzzle.
  const friday = findSwitchRows("Friday", list, "a", "en", "333");
  expect(friday).toEqual([
    { kind: "create", id: "create", label: "Friday", event: "333", marks: [] },
  ]);
  expect(nextEvent("333")).toBe("222");
  expect(nextEvent("fto")).toBe("333");
  expect(nextEvent("333", -1)).toBe("fto");
});

test("names match anywhere and the matched letters are marked", () => {
  const rows = findSwitchRows("ain", list, null, "en", "333");
  expect(rows[0]).toMatchObject({ kind: "session", id: "a", marks: [[1, 4]] });
  // An exact name never offers to create a second one.
  expect(
    findSwitchRows("main", list, null, "en", "333").some(
      ({ kind }) => kind === "create",
    ),
  ).toBe(false);
  // A partial name still offers it, last.
  expect(rows.at(-1)).toMatchObject({ kind: "create", label: "ain" });
});

test("aliases in both languages and both x signs", () => {
  const empty: Session[] = [];
  const first = (query: string, language: "en" | "ru" = "en") =>
    findSwitchRows(query, empty, null, language, "333")[0];
  expect(first("3x3")).toMatchObject({ id: "333" });
  expect(first("3х3")).toMatchObject({ id: "333" }); // Cyrillic х
  expect(first("3×3")).toMatchObject({ id: "333" });
  expect(first("bld")).toMatchObject({ id: "333bf" });
  expect(first("4bld")).toMatchObject({ id: "444bf" });
  expect(first("fmc")).toMatchObject({ id: "333fm" });
  expect(first("mbld")).toMatchObject({ id: "333mbf" });
  expect(first("pyr")).toMatchObject({ id: "pyram" });
  expect(first("sq1")).toMatchObject({ id: "sq1" });
  expect(first("мульти", "ru")).toMatchObject({
    id: "333mbf",
    label: "Мульти-блайнд",
  });
  expect(first("часы", "ru")).toMatchObject({ id: "clock" });
  expect(first("кубик 4", "ru")).toMatchObject({
    id: "444",
    label: "Кубик 4x4x4",
    marks: [[0, 7]],
  });
  // Sessions of the puzzle answer to its alias too.
  expect(
    findSwitchRows("3", list, null, "en", "333").filter(
      ({ kind }) => kind === "session",
    ),
  ).toMatchObject([{ id: "a" }]);
});

test("with no query every session comes first, then the puzzles without one", () => {
  const rows = findSwitchRows("", list, null, "en", "333");
  expect(rows.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
    "session:a",
    "session:b",
    "session:oh",
    ...[
      "444",
      "555",
      "666",
      "777",
      "333bf",
      "333fm",
      "clock",
      "minx",
      "pyram",
      "skewb",
      "sq1",
      "444bf",
      "555bf",
      "333mbf",
      "fto",
    ].map((id) => `event:${id}`),
  ]);
  expect(rows.find(({ id }) => id === "666")).toMatchObject({
    label: "6x6x6 Cube",
  });
});

test("fifty-one sessions stay searchable", () => {
  const many = Array.from({ length: 51 }, (_, i) =>
    session(`s${i}`, `Session ${i + 1}`, "333"),
  );
  expect(
    findSwitchRows("51", many, null, "en", "333")
      .filter(({ kind }) => kind === "session")
      .map(({ id }) => id),
  ).toEqual(["s50"]);
  expect(normalizeQuery("  ЁЛКА 3Х3 ")).toBe("елка 3x3");
});

test("every event's official name in both languages, in WCA order, with no session yet", () => {
  const names = (language: "en" | "ru") =>
    findSwitchRows("", [], null, language, "333").map(({ label }) => label);
  expect(names("en")).toEqual([
    "3x3x3 Cube",
    "2x2x2 Cube",
    "4x4x4 Cube",
    "5x5x5 Cube",
    "6x6x6 Cube",
    "7x7x7 Cube",
    "3x3x3 Blindfolded",
    "3x3x3 Fewest Moves",
    "3x3x3 One-Handed",
    "Clock",
    "Megaminx",
    "Pyraminx",
    "Skewb",
    "Square-1",
    "4x4x4 Blindfolded",
    "5x5x5 Blindfolded",
    "3x3x3 Multi-Blind",
    "Face Turning Octahedron",
  ]);
  // WCA Russian locale (research A2); FTO has no Russian name and keeps the app's own.
  expect(names("ru")).toEqual([
    "Кубик 3x3x3",
    "Кубик 2x2x2",
    "Кубик 4x4x4",
    "Кубик 5x5x5",
    "Кубик 6x6x6",
    "Кубик 7x7x7",
    "3x3x3 вслепую",
    "Сборка 3x3x3 на количество ходов",
    "3x3x3 одной рукой",
    "Clock",
    "Мегаминкс",
    "Пираминкс",
    "Скьюб",
    "Square-1",
    "4x4x4 вслепую",
    "5x5x5 вслепую",
    "Мульти-блайнд",
    "FTO",
  ]);
});

test("an archived session is out of the list but found by search, after the rest", () => {
  const old = { ...session("old", "Main old", "444"), archived: true };
  const ids = (rows: ReturnType<typeof findSwitchRows>) =>
    rows.filter(({ kind }) => kind === "session").map(({ id }) => id);
  const rows = findSwitchRows("", [...list, old], "a", "en", "333");
  expect(ids(rows)).toEqual(["a", "b", "oh"]);
  // Its puzzle is free again: picking 4x4 makes a new session.
  expect(rows.some(({ kind, id }) => kind === "event" && id === "444")).toBe(
    true,
  );
  // The open session shows where it stands, archived or not.
  expect(ids(findSwitchRows("", [...list, old], "old", "en", "333"))).toEqual([
    "a",
    "b",
    "oh",
    "old",
  ]);
  expect(
    findSwitchRows("main", [old, ...list], "a", "en", "333").filter(
      ({ kind }) => kind === "session",
    ),
  ).toMatchObject([
    { id: "a", archived: false },
    { id: "old", archived: true },
  ]);
});

test("a move lists the other sessions of the same puzzle, and a new one by name", () => {
  const side = session("side", "Side", "333");
  const old = { ...session("old", "Old 3x3", "333"), archived: true };
  const all = [a, b, oh, side, old];
  // No query: the other live sessions of the puzzle, the open one left out.
  expect(findMoveRows("", all, "a", "333").map(({ id }) => id)).toEqual([
    "side",
  ]);
  // A query finds the archived too, last, and offers a new session of that puzzle.
  const found = findMoveRows("s", all, "a", "333");
  expect(found.map(({ kind, id }) => `${kind}:${id}`)).toEqual([
    "session:side",
    "create:create",
  ]);
  expect(findMoveRows("old", all, "a", "333").map(({ id }) => id)).toEqual([
    "old",
    "create",
  ]);
  expect(findMoveRows("Split", all, "a", "333").at(-1)).toMatchObject({
    kind: "create",
    label: "Split",
    event: "333",
  });
  // A name already there of this puzzle is picked, not made again; other puzzles never.
  expect(findMoveRows("side", all, "a", "333").map(({ id }) => id)).toEqual([
    "side",
  ]);
  expect(findMoveRows("two", all, "a", "333").map(({ id }) => id)).toEqual([
    "create",
  ]);
});
