import { effectiveMs } from "@cubehaus/core";
import { createStore, migrate, snapshot } from "@cubehaus/storage";
import { createNodeDb } from "@cubehaus/storage/node";
import { expect, test } from "vitest";
import { parseImport, runImport } from "../../../apps/web/src/import";
import fixture from "./fixtures/cubedesk.json";
import { parseCubeDesk } from "./index";

const text = JSON.stringify(fixture);
const [attempt] = fixture.solves;

test("cubedesk rejoins sessions by id across a rename", async () => {
  const result = parseCubeDesk(text);
  expect(result).toMatchObject({
    source: "cubedesk",
    sessions: [
      {
        key: '["A","333"]',
        name: "Practice",
        event: "333",
        meta: { id: "A", name: "Practice" },
        solves: [],
      },
      {
        key: '["B","333"]',
        name: "Practice",
        event: "333",
        meta: { id: "B", name: "Practice" },
        solves: [
          {
            row: 1,
            timeMs: 12345,
            startedAt: 1700000000123,
            plus2: 1,
            dnf: false,
            scramble: "R",
            comment: "r",
            cubedesk: attempt,
          },
        ],
      },
    ],
    issues: [],
  });
  expect(result.sessions[1]?.solves.map(effectiveMs)).toEqual([14345]);
  expect(await parseImport(new File([text], "history.txt"))).toEqual(result);

  const db = createNodeDb(":memory:");
  try {
    await migrate(db);
    const store = createStore(db);
    expect(await runImport(store, result)).toMatchObject({
      added: 1,
      created: 2,
    });
    const original = await snapshot(db);
    const joined = original.tables.import_session?.find(
      ({ source_key }) => source_key === '["B","333"]',
    );
    if (typeof joined?.session_id !== "string")
      throw new Error("Missing binding for B");
    await store.sessions.rename(joined.session_id, "Renamed B");

    const reordered = parseCubeDesk(
      JSON.stringify({
        sessions: fixture.sessions.toReversed(),
        solves: fixture.solves.toReversed(),
      }),
    );
    expect(await runImport(store, reordered)).toMatchObject({
      added: 0,
      created: 0,
      skipped: 1,
    });
    expect(await runImport(store, result)).toMatchObject({
      added: 0,
      skipped: 1,
    });

    const backup = await snapshot(db);
    expect(backup.tables.session).toHaveLength(2);
    expect(backup.tables.session).toContainEqual(
      expect.objectContaining({ id: joined.session_id, name: "Renamed B" }),
    );
    expect(backup.tables.import_session).toEqual(
      original.tables.import_session,
    );
    expect(backup.tables.solve).toEqual([
      expect.objectContaining({
        session_id: joined.session_id,
        time_ms: 12345,
        started_at: 1700000000123,
        plus2: 1,
        dnf: 0,
        comment: "r",
        import_source: "cubedesk",
      }),
    ]);
    expect(JSON.parse(String(backup.tables.solve?.[0]?.import_extra))).toEqual({
      v: 1,
      cubedesk: attempt,
    });
  } finally {
    await db.close();
  }
});

test("cubedesk splits events, keeps an unknown puzzle apart and retains solves from missing sessions", () => {
  const result = parseCubeDesk(
    JSON.stringify({
      sessions: fixture.sessions,
      solves: [
        attempt,
        {
          ...attempt,
          id: "y",
          cube_type: "222",
          raw_time: 12.344999999999999,
          time: 12.344999999999999,
          plus_two: false,
        },
        {
          ...attempt,
          id: "z",
          session_id: "C",
          cube_type: "unknown",
          dnf: true,
        },
        { ...attempt, id: "w", session_id: "C", time: 12.345 },
        { ...attempt, id: "v", started_at: 1700000000 },
        { ...attempt, id: "u", raw_time: null, dnf: true },
        null,
      ],
    }),
  );
  expect(result.sessions).toMatchObject([
    { key: '["A","333"]', name: "Practice", solves: [] },
    { key: '["B","333"]', name: "Practice", solves: [{ row: 1 }] },
    {
      key: '["B","222"]',
      name: "Practice",
      solves: [{ row: 1, timeMs: 12344 }],
    },
    // A puzzle cubehaus has not got is a 3×3 session of its own, named with it in front.
    {
      key: '["C","unknown"]',
      name: "unknown C",
      event: "333",
      meta: { id: "C", name: "C" },
      solves: [{ row: 1, timeMs: 12345, plus2: 1, dnf: true }],
    },
    { key: '["C","333"]', name: "C", event: "333", solves: [] },
  ]);
  expect(result.issues).toEqual(
    expect.arrayContaining([
      { sessionKey: '["C","unknown"]', row: null, code: "missing-session" },
      {
        sessionKey: '["C","unknown"]',
        row: null,
        code: "unknown-event",
        value: "unknown",
      },
      { sessionKey: '["C","333"]', row: null, code: "missing-session" },
      { sessionKey: '["C","333"]', row: 1, code: "invalid-row" },
      { sessionKey: '["B","333"]', row: 2, code: "invalid-row" },
      { sessionKey: '["B","333"]', row: 3, code: "invalid-row" },
      { sessionKey: "", row: 7, code: "invalid-row" },
    ]),
  );
  expect(result.issues).toHaveLength(7);
});
