import { expect, test } from "vitest";
import { ImportFormatError, parseCsTimer } from "./cstimer";
import fixture from "./fixtures/cstimer-small.json";

test("parses sessions in numeric order, preserving solves and raw times", () => {
  const result = parseCsTimer(JSON.stringify(fixture));
  expect(result.source).toBe("cstimer");
  expect(result.issues).toEqual([]);
  expect(
    result.sessions.map(({ key, name, event, solves }) => ({
      key,
      name,
      event,
      count: solves.length,
    })),
  ).toEqual([
    { key: "session1", name: "Practice", event: "333", count: 6 },
    { key: "session2", name: "OH practice", event: "333oh", count: 1 },
    { key: "session10", name: "Two", event: "222", count: 0 },
  ]);
  const solves = result.sessions[0]?.solves;
  expect(solves?.[0]).toEqual({
    timeMs: 10510,
    plus2: 0,
    dnf: false,
    scramble: "R U",
    comment: null,
    startedAt: 1700000000000,
    row: 1,
  });
  expect(solves?.[1]).toMatchObject({ timeMs: 11200, plus2: 1, dnf: false });
  expect(solves?.[2]).toMatchObject({ timeMs: 12345, plus2: 0, dnf: true });
  expect(solves?.[3]?.comment).toBe("Practice");
  expect({ ...solves?.[4], row: 0 }).toEqual({ ...solves?.[5], row: 0 });
  expect(result.sessions[1]?.solves[0]).toMatchObject({
    timeMs: 18870,
    plus2: 2,
    dnf: false,
  });
});

test("accepts session metadata as an object or a JSON string", () => {
  const object = {
    ...fixture,
    properties: { sessionData: JSON.parse(fixture.properties.sessionData) },
  };
  expect(parseCsTimer(JSON.stringify(object))).toEqual(
    parseCsTimer(JSON.stringify(fixture)),
  );
});

test("phase tails keep their original values and row number", () => {
  const result = parseCsTimer(
    JSON.stringify({
      session1: [[[2000, 12345, 7000], "R", "x", 1700000000]],
      session2: [],
      properties: { sessionData: { "1": { name: "Split", scrType: "333" } } },
    }),
  );
  expect(result.sessions).toHaveLength(2);
  expect(result.issues.filter(({ code }) => code === "invalid-row")).toEqual(
    [],
  );
  expect(result.sessions[0]?.solves).toEqual([
    {
      timeMs: 12345,
      plus2: 1,
      dnf: false,
      scramble: "R",
      comment: "x",
      startedAt: 1700000000000,
      row: 1,
      phases: [7000],
      splits: [
        { name: "1", durationMs: 7000 },
        { name: "2", durationMs: 5345 },
      ],
    },
  ]);

  const broken = parseCsTimer(
    JSON.stringify({
      session1: [
        [[2000, 12345, 7000], "R", "x", 1700000000],
        [[0, 1000], "R"],
      ],
      session2: [],
    }),
  );
  expect(broken.sessions[0]?.solves.map(({ row }) => row)).toEqual([1]);
  expect(broken.issues).toContainEqual({
    sessionKey: "session1",
    row: 2,
    code: "invalid-row",
  });
});

test("keeps row items after the date and every field of the session data", () => {
  const meta = {
    name: "Smart",
    opt: { scrType: "444wca", phases: 2 },
    rank: 3,
    stat: [1, 0, 1000],
  };
  const result = parseCsTimer(
    JSON.stringify({
      session1: [[[0, 40000], "R U", "", 1700000000, ["R U R'", "333"]]],
      properties: { sessionData: JSON.stringify({ "1": meta }) },
    }),
  );
  expect(result.sessions[0]).toMatchObject({ event: "444", meta });
  expect(result.sessions[0]?.solves[0]?.extra).toEqual([["R U R'", "333"]]);
  expect(result.sessions[0]?.solves[0]).not.toHaveProperty("phases");
});

test("reads the scramble type nested in opt before the flat one", () => {
  const result = parseCsTimer(
    JSON.stringify({
      session1: [],
      session2: [],
      session3: [],
      properties: {
        sessionData: {
          "1": { name: 1, opt: { scrType: "fto" } },
          "2": { name: "Clock", opt: { scrType: "clkwca" }, scrType: "333" },
          "3": { name: "  ", opt: {}, scrType: "pyrso" },
        },
      },
    }),
  );
  expect(result.sessions.map(({ name, event }) => [name, event])).toEqual([
    ["1", "fto"],
    ["Clock", "clock"],
    ["session3", "pyram"],
  ]);
  expect(result.issues).toEqual([]);
});

test("reports each unreadable row by session and row", () => {
  const result = parseCsTimer(
    JSON.stringify({
      ...fixture,
      session1: [
        ...fixture.session1,
        [[0, 1000, "late"], "R", "", 1700000000],
        [[1000, 1000], "R", "", 1700000000],
        [[0, -1], "R", "", 1700000000],
        [[0, 1.5], "R", "", 1700000000],
        [[0, 1000], "R", "", null],
        [[0, 1000, 500], "R", "", 1700000000],
      ],
    }),
  );
  expect(result.sessions[0]?.solves).toHaveLength(7);
  expect(result.issues).toEqual(
    [7, 8, 9, 10, 11].map((row) => ({
      sessionKey: "session1",
      row,
      code: "invalid-row",
    })),
  );
});

test("falls back to 3×3 and identifies sessions with missing or unknown types", () => {
  const result = parseCsTimer(
    JSON.stringify({
      session1: [],
      session2: [],
      properties: { sessionData: { "2": { name: "OH", scrType: "unknown" } } },
    }),
  );
  expect(result.sessions.map(({ name, event }) => [name, event])).toEqual([
    ["session1", "333"],
    ["OH", "333"],
  ]);
  expect(result.issues).toEqual([
    { sessionKey: "session1", row: null, code: "unknown-event" },
    {
      sessionKey: "session2",
      row: null,
      code: "unknown-event",
      value: "unknown",
    },
  ]);
});

test.each([
  ["{broken", "json"],
  ["[]", "object"],
  ['{"session1":{}}', "sessions"],
])("rejects malformed exports (%s) with a format error", (value, problem) => {
  expect(() => parseCsTimer(value)).toThrow(ImportFormatError);
  try {
    parseCsTimer(value);
  } catch (error) {
    expect((error as ImportFormatError).problem).toBe(problem);
  }
});

test("rejects 60 MB of garbage with a format error", () => {
  expect(() => parseCsTimer("x".repeat(60_000_000))).toThrow(ImportFormatError);
});
