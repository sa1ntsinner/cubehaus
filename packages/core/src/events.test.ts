import { expect, test } from "vitest";
import { EVENTS, eventInfo, hasTimePenalty, isEventId } from "./index";

test("E36: events.json and WCA ru.yml: event ranks and official names follow A1 and A2", () => {
  expect(
    EVENTS.map(({ id, rank, name, nameRu }) => [id, rank, name, nameRu]),
  ).toEqual([
    ["333", 10, "3x3x3 Cube", "Кубик 3x3x3"],
    ["222", 20, "2x2x2 Cube", "Кубик 2x2x2"],
    ["444", 30, "4x4x4 Cube", "Кубик 4x4x4"],
    ["555", 40, "5x5x5 Cube", "Кубик 5x5x5"],
    ["666", 50, "6x6x6 Cube", "Кубик 6x6x6"],
    ["777", 60, "7x7x7 Cube", "Кубик 7x7x7"],
    ["333bf", 70, "3x3x3 Blindfolded", "3x3x3 вслепую"],
    ["333fm", 80, "3x3x3 Fewest Moves", "Сборка 3x3x3 на количество ходов"],
    ["333oh", 90, "3x3x3 One-Handed", "3x3x3 одной рукой"],
    ["clock", 110, "Clock", "Clock"],
    ["minx", 120, "Megaminx", "Мегаминкс"],
    ["pyram", 130, "Pyraminx", "Пираминкс"],
    ["skewb", 140, "Skewb", "Скьюб"],
    ["sq1", 150, "Square-1", "Square-1"],
    ["444bf", 160, "4x4x4 Blindfolded", "4x4x4 вслепую"],
    ["555bf", 170, "5x5x5 Blindfolded", "5x5x5 вслепую"],
    ["333mbf", 180, "3x3x3 Multi-Blind", "Мульти-блайнд"],
    ["fto", 810, "Face Turning Octahedron", "FTO"],
  ]);
});

test("provides every event field and a lookup by unique ID in rank order", () => {
  expect(new Set(EVENTS.map(({ id }) => id)).size).toBe(EVENTS.length);
  expect(EVENTS.map(({ rank }) => rank)).toEqual(
    EVENTS.map(({ rank }) => rank).sort((a, b) => a - b),
  );
  for (const event of EVENTS) {
    expect(event).toMatchObject({
      id: expect.any(String),
      rank: expect.any(Number),
      name: expect.any(String),
      nameRu: expect.any(String),
      label: expect.stringMatching(/\S/),
      format: expect.any(String),
      kind: expect.any(String),
    });
    for (const field of [
      "recognised",
      "inspectionMs",
      "officialFrom",
      "officialUntil",
    ] as const) {
      expect(event).toHaveProperty(field);
      expect(event[field]).not.toBeUndefined();
    }
    expect(eventInfo(event.id)).toBe(event);
  }
  expect(eventInfo("333").label).toBe("3×3");
});

test("recognizes event IDs", () => {
  expect(isEventId("333")).toBe(true);
  expect(isEventId("fto")).toBe(true);
  expect(isEventId("foo")).toBe(false);
});

test.each([
  ["333fm", false],
  ["333", true],
  ["333bf", true],
  ["333mbf", true],
  ["clock", true],
  ["fto", true],
] as const)("time penalty eligibility for %s is %s", (event, expected) => {
  expect(hasTimePenalty(event)).toBe(expected);
});
