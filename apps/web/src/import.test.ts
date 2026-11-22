import type { Solve } from "@cubehaus/core";
import { encodeCsTimer, encodeCsv, parseCsTimer } from "@cubehaus/importers";
import {
  createStore,
  migrate,
  type Store,
  snapshot,
  starterKey,
} from "@cubehaus/storage";
import { createNodeDb } from "@cubehaus/storage/node";
import { expect, test } from "vitest";
import fixture from "../../../packages/importers/src/fixtures/cstimer-small.json";
import { loadSessions } from "./db/flow";
import { importPlan, parseImport, runImport } from "./import";
import { textFor } from "./text";

test("overlapping imports serialize session creation and de-duplication", async () => {
  const db = createNodeDb(":memory:");
  try {
    await migrate(db);
    const store = createStore(db);
    const result = parseCsTimer(JSON.stringify(fixture));
    const [first, second] = await Promise.all([
      runImport(store, result),
      runImport(store, result),
    ]);
    expect(first).toMatchObject({ sessions: 3, added: 7, skipped: 0 });
    expect(second).toMatchObject({ sessions: 3, added: 0, skipped: 7 });
    expect(await store.sessions.list()).toHaveLength(3);
  } finally {
    await db.close();
  }
});

test("csTimer +2 is dropped for Fewest Moves and stored for Multi-Blind", async () => {
  const db = createNodeDb(":memory:");
  try {
    await migrate(db);
    const store = createStore(db);
    const result = parseCsTimer(
      JSON.stringify({
        session1: [[[2000, 25000], "R U", "", 1700000001]],
        session2: [[[2000, 60000], "R U", "", 1700000002]],
        properties: {
          sessionData: {
            "1": { name: "Moves", scrType: "333fm" },
            "2": { name: "Multi", scrType: "r3ni" },
          },
        },
      }),
    );
    expect(result.sessions[0]?.solves[0]?.plus2).toBe(1);
    expect(await runImport(store, result)).toMatchObject({
      added: 2,
      skipped: 0,
    });
    for (const session of await store.sessions.list()) {
      expect(await store.solves.page(session.id, { limit: 10 })).toEqual([
        expect.objectContaining({
          event: session.event,
          plus2: session.event === "333fm" ? 0 : 1,
        }),
      ]);
    }
    expect(await runImport(store, result)).toMatchObject({
      added: 0,
      skipped: 2,
    });
  } finally {
    await db.close();
  }
});

const same = {
  session1: [
    [[0, 9000], "R U", "", 1700000000],
    [[0, 9000], "R U", "", 1700000000],
  ],
  session2: [[[0, 9000], "R U", "", 1700000000]],
  session3: [[[2000, 12345, 7000], "R", "x", 1700000005]],
  properties: {
    sessionData: {
      "1": { name: "Same", opt: { scrType: "333" } },
      "2": { name: "Same", opt: { scrType: "333" } },
      "3": { name: "Split", opt: { scrType: "333" }, rank: 3 },
    },
  },
};

test("renamed moved and deleted imports survive interrupted replay", async () => {
  const db = createNodeDb(":memory:");
  try {
    await migrate(db);
    const store = createStore(db);
    const result = parseCsTimer(JSON.stringify(same));
    expect(result.issues).toEqual([]);

    // A failure while writing the second session leaves nothing behind.
    await db.batch([
      {
        sql: `CREATE TRIGGER fail_import BEFORE INSERT ON import_session
          WHEN NEW.source_key = 'session2' BEGIN SELECT RAISE(ABORT, 'test rejection'); END`,
      },
    ]);
    await expect(runImport(store, result)).rejects.toThrow("test rejection");
    expect(await store.sessions.list()).toEqual([]);
    expect(await db.all("SELECT id FROM solve")).toEqual([]);
    expect(await db.all("SELECT * FROM import_session")).toEqual([]);
    await db.batch([{ sql: "DROP TRIGGER fail_import" }]);

    expect(await runImport(store, result)).toMatchObject({
      sessions: 3,
      created: 3,
      added: 4,
      skipped: 0,
    });
    const [first, second, split] = await store.sessions.list();
    if (!first || !second || !split) throw new Error("Missing sessions");
    expect([first.name, second.name]).toEqual(["Same", "Same"]);
    expect(await store.solves.count(first.id)).toBe(2);
    expect(await store.solves.count(second.id)).toBe(1);

    // The split time and the session's own data come along.
    const backup = await snapshot(db);
    expect(
      backup.tables.solve?.find((row) => row.session_id === split.id),
    ).toMatchObject({ import_extra: '{"v":1,"phases":[7000]}' });
    expect(
      backup.tables.import_session?.map(({ source_key, source_meta }) => [
        source_key,
        JSON.parse(String(source_meta)),
      ]),
    ).toEqual([
      ["session1", { name: "Same", opt: { scrType: "333" } }],
      ["session2", { name: "Same", opt: { scrType: "333" } }],
      ["session3", { name: "Split", opt: { scrType: "333" }, rank: 3 }],
    ]);

    // Rename the first, move one of its solves to the second, delete the other.
    await store.sessions.rename(first.id, "Renamed");
    const [moved, removed] = await store.solves.page(first.id, { limit: 2 });
    if (!moved || !removed) throw new Error("Missing solves");
    await db.batch([
      {
        sql: "UPDATE solve SET session_id = ? WHERE id = ?",
        params: [second.id, moved.id],
      },
    ]);
    await store.solves.remove(removed.id);

    expect(await runImport(store, result)).toMatchObject({
      created: 0,
      added: 0,
      skipped: 4,
    });
    expect(
      (await store.sessions.list()).map(({ id, name }) => [id, name]),
    ).toEqual([
      [first.id, "Renamed"],
      [second.id, "Same"],
      [split.id, "Split"],
    ]);
    expect(await store.solves.count(first.id)).toBe(0);
    expect(await store.solves.count(second.id)).toBe(2);
  } finally {
    await db.close();
  }
});

test("an import made before sessions were mapped is matched by its solves", async () => {
  const db = createNodeDb(":memory:");
  try {
    await migrate(db);
    const store = createStore(db);
    const result = parseCsTimer(JSON.stringify(fixture));
    // What 0.0.x wrote: the same hashes, sessions found by name, no mapping rows.
    const plan = await importPlan(result);
    for (const draft of plan.sessions) {
      const session = await store.sessions.create({
        name: `${draft.name} (kept)`,
        event: draft.event,
      });
      await store.solves.addImported(
        draft.solves.map((solve, i) => ({
          ...solve,
          id: `${draft.sourceKey}-${i}`,
          sessionId: session.id,
          event: draft.event,
          input: "imported",
          importSource: "cstimer",
        })),
      );
    }
    const before = await store.sessions.list();
    expect(await runImport(store, result)).toMatchObject({
      created: 1,
      added: 0,
      skipped: 7,
    });
    const after = await store.sessions.list();
    // The empty session had no solves to recognise it by: it is made again.
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length).map(({ name }) => name)).toEqual(["Two"]);
    expect(
      (
        await db.all<{ source_key: string; session_id: string }>(
          "SELECT source_key, session_id FROM import_session ORDER BY source_key",
        )
      ).filter(({ source_key }) => source_key !== "session10"),
    ).toEqual([
      { source_key: "session1", session_id: before[0]?.id },
      { source_key: "session2", session_id: before[1]?.id },
    ]);
    expect(await runImport(store, result)).toMatchObject({
      created: 0,
      added: 0,
      skipped: 7,
    });
  } finally {
    await db.close();
  }
});

test("pending first solve wins over starter cleanup", async () => {
  const empty = {
    session1: [[[0, 9000], "R U", "", 1700000000]],
    session2: [],
    properties: {
      sessionData: {
        "1": { name: "A", scrType: "333" },
        "2": { name: "B", scrType: "222so" },
      },
    },
  };
  const file = parseCsTimer(JSON.stringify(empty));
  async function fresh(
    prepare?: (store: Store, starter: string) => Promise<void>,
  ) {
    const db = createNodeDb(":memory:");
    await migrate(db);
    const store = createStore(db);
    const { current } = await loadSessions(store);
    await prepare?.(store, current.id);
    return { db, store, starter: current.id };
  }

  // Untouched: the import leaves exactly the file's sessions, the empty one too.
  {
    const { db, store } = await fresh();
    expect(await runImport(store, file)).toMatchObject({ created: 2 });
    expect((await store.sessions.list()).map(({ name }) => name)).toEqual([
      "A",
      "B",
    ]);
    expect(await store.settings.get(starterKey)).toBeNull();
    await db.close();
  }

  // Renamed, given its own setting, chosen, or holding a solve: it stays.
  for (const prepare of [
    (store: Store, id: string) => store.sessions.rename(id, "Mine"),
    (store: Store, id: string) => store.sessions.adopt(id),
    async (store: Store, id: string) => {
      await store.solves.add({
        id: "first",
        sessionId: id,
        event: "333",
        timeMs: 1000,
        plus2: 0,
        dnf: false,
        scramble: "R",
        startedAt: 1,
        inspectionMs: null,
        comment: null,
        input: "keyboard",
      });
    },
  ]) {
    const { db, store, starter } = await fresh(prepare);
    await runImport(store, file);
    const sessions = await store.sessions.list();
    expect(sessions.map(({ id }) => id)).toContain(starter);
    expect(sessions).toHaveLength(3);
    await db.close();
  }

  // A failed import keeps it, still marked.
  {
    const { db, store, starter } = await fresh();
    await db.batch([
      {
        sql: `CREATE TRIGGER fail_import BEFORE INSERT ON solve
          BEGIN SELECT RAISE(ABORT, 'test rejection'); END`,
      },
    ]);
    await expect(runImport(store, file)).rejects.toThrow("test rejection");
    expect((await store.sessions.list()).map(({ id }) => id)).toEqual([
      starter,
    ]);
    expect(await store.settings.get(starterKey)).toBe(starter);
    await db.close();
  }

  // A session that was already there before this version is never removed.
  {
    const db = createNodeDb(":memory:");
    await migrate(db);
    const store = createStore(db);
    const legacy = await store.sessions.create({ name: "3×3", event: "333" });
    await runImport(store, file);
    expect((await store.sessions.list()).map(({ id }) => id)).toContain(
      legacy.id,
    );
    await db.close();
  }
});

test("a csTimer file exported here and imported back adds nothing", async () => {
  const db = createNodeDb(":memory:");
  try {
    await migrate(db);
    const store = createStore(db);
    const main = await store.sessions.create({ name: "Main", event: "333" });
    const fm = await store.sessions.create({ name: "Moves", event: "333fm" });
    const timed = (id: string, sessionId: string, over: Partial<Solve> = {}) =>
      store.solves.add({
        id,
        sessionId,
        event: "333",
        timeMs: 9870,
        plus2: 0,
        dnf: false,
        scramble: "R U",
        startedAt: 1700000000123,
        inspectionMs: 15000,
        comment: null,
        input: "keyboard",
        ...over,
      });
    // Two genuine equal solves in the same second, and two that differ only slightly.
    await timed("a", main.id);
    await timed("b", main.id, { startedAt: 1700000000456 });
    await timed("c", main.id, { plus2: 1, startedAt: 1700000001000 });
    await timed("d", main.id, { dnf: true, startedAt: 1700000002000 });
    await timed("e", fm.id, {
      event: "333fm",
      timeMs: 0,
      moves: 28,
      startedAt: 1700000003000,
    });
    const exported = encodeCsTimer(await snapshot(db));
    const result = parseCsTimer(exported.text);
    expect(await store.reviewImport(await importPlan(result))).toMatchObject({
      added: 0,
      skipped: 5,
      sessions: [
        { target: main.id, added: 0, here: 4 },
        { target: fm.id, added: 0, here: 1 },
      ],
    });
    expect(await runImport(store, result)).toMatchObject({
      created: 0,
      added: 0,
      skipped: 5,
    });
    expect(await store.sessions.list()).toHaveLength(2);
    expect(await store.solves.count(main.id)).toBe(4);

    // One more equal solve in the file than here: exactly one is added.
    const extra = JSON.parse(exported.text);
    extra.session1.push(extra.session1[0]);
    const more = parseCsTimer(JSON.stringify(extra));
    expect(await runImport(store, more)).toMatchObject({
      added: 1,
      skipped: 5,
    });
    expect(await store.solves.count(main.id)).toBe(5);
  } finally {
    await db.close();
  }
});

test.each([
  ['{"session1":[]}', "cstimer"],
  ['{"session1":{}}', "sessions"],
  ['{"properties":{"sessionData":"{}"}}', "sessions"],
  ["{broken", "json"],
  ['{"sessions":[],"solves":{}}', "cubedesk"],
  ['{"settings":{}}', "unsupported-shape"],
])("routes JSON import %s by content", async (contents, outcome) => {
  const parsed = parseImport(new File([contents], "history.txt"));
  if (outcome === "cstimer")
    await expect(parsed).resolves.toMatchObject({ source: outcome });
  else await expect(parsed).rejects.toMatchObject({ problem: outcome });
});

test("the unsupported import shape lists CubeDesk in both languages", () => {
  expect(textFor("en").settings.importProblem["unsupported-shape"]).toBe(
    "cubehaus can’t read this file. It reads csTimer exports, CubeTime’s CSV files, Twisty Timer backups and CubeDesk exports.",
  );
  expect(textFor("ru").settings.importProblem["unsupported-shape"]).toBe(
    "Этот файл не читается. cubehaus читает экспорт csTimer, CSV-файлы CubeTime, резервные копии Twisty Timer и экспорт CubeDesk.",
  );
});

test("files for csTimer and the table leave repeats out; the backup keeps them", async () => {
  const db = createNodeDb(":memory:");
  try {
    await migrate(db);
    const store = createStore(db);
    const session = await store.sessions.create({ name: "A", event: "333" });
    const solve = (id: string, timeMs: number, repeatOf?: string): Solve => ({
      id,
      sessionId: session.id,
      event: "333",
      timeMs,
      plus2: 0,
      dnf: false,
      scramble: "R U F",
      startedAt: 1_700_000_000_000 + timeMs,
      inspectionMs: null,
      comment: null,
      input: "keyboard",
      ...(repeatOf ? { repeatOf } : {}),
    });
    await store.solves.add(solve("root", 12340));
    await store.solves.add(solve("again", 7770, "root"));
    const backup = await snapshot(db);
    expect(backup.tables.solve).toHaveLength(1);
    expect(backup.tables.solve_repeat).toHaveLength(1);
    const cstimer = encodeCsTimer(backup).text;
    expect(cstimer).toContain("12340");
    expect(cstimer).not.toContain("7770");
    const csv = encodeCsv(backup).text;
    expect(csv.trim().split("\n")).toHaveLength(2);
    expect(csv).not.toContain("7.77");
  } finally {
    await db.close();
  }
});
