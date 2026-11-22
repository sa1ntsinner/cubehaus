import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  createStore,
  type Db,
  migrate,
  NewerSchemaError,
  SCHEMA_VERSION,
  type Statement,
} from "./index";
import { createNodeDb } from "./node-db";

let db: Db;
beforeEach(() => {
  db = createNodeDb(":memory:");
});
afterEach(async () => {
  await db.close();
});

test("migrates once, preserves existing data, and refuses a newer schema", async () => {
  expect(SCHEMA_VERSION).toBe(7);
  expect(await migrate(db)).toBe(7);
  await db.batch([{ sql: "INSERT INTO setting VALUES ('test', 'kept', 1)" }]);
  const schema = await db.all("SELECT * FROM sqlite_schema ORDER BY name");
  expect(await migrate(db)).toBe(7);
  expect(await db.all("SELECT * FROM sqlite_schema ORDER BY name")).toEqual(
    schema,
  );
  expect(await db.all("SELECT value FROM setting")).toEqual([
    { value: "kept" },
  ]);
  await db.batch([{ sql: "PRAGMA user_version = 8" }]);
  await expect(migrate(db)).rejects.toBeInstanceOf(NewerSchemaError);
  expect(await db.all("PRAGMA user_version")).toEqual([{ user_version: 8 }]);
  expect(await db.all("SELECT * FROM sqlite_schema ORDER BY name")).toEqual(
    schema,
  );
  expect(await db.all("SELECT value FROM setting")).toEqual([
    { value: "kept" },
  ]);
});

test("version 1 upgrades in place and gives existing solves null result fields", async () => {
  await db.batch([
    ...legacyV1,
    {
      sql: "INSERT INTO session VALUES ('s', 'Practice', '333', 'a0', 0, 1, 1, NULL)",
    },
    {
      sql: `INSERT INTO solve VALUES
      ('kept', 's', '333', 10000, 1, 0, 'R', 1, 15000, 'note', 'imported', 'fixture', 'hash', 3, NULL),
      ('deleted', 's', '333', 11000, 0, 1, 'U', 2, NULL, NULL, 'keyboard', NULL, NULL, 4, 4)`,
    },
    {
      sql: "INSERT INTO session VALUES ('hidden', 'Hidden', '333', 'a1', 1, 1, 2, 2)",
    },
    { sql: "PRAGMA user_version = 1" },
  ]);
  const before = await db.all("SELECT * FROM solve ORDER BY id");
  const sessions = await db.all("SELECT * FROM session ORDER BY id");

  expect(await migrate(db)).toBe(7);
  expect(await db.all("PRAGMA user_version")).toEqual([{ user_version: 7 }]);
  expect(await db.all("SELECT * FROM session ORDER BY id")).toEqual(
    sessions.map((row) => ({ ...row, folder_id: null })),
  );
  const columns = await db.all<{ name: string; type: string; notnull: number }>(
    "PRAGMA table_info(solve)",
  );
  expect(
    columns.slice(-5).map(({ name, type, notnull }) => [name, type, notnull]),
  ).toEqual([
    ["moves", "INTEGER", 0],
    ["solution", "TEXT", 0],
    ["cubes_solved", "INTEGER", 0],
    ["cubes_attempted", "INTEGER", 0],
    ["import_extra", "TEXT", 0],
  ]);
  expect(await db.all("SELECT * FROM solve ORDER BY id")).toEqual(
    before.map((row) => ({
      ...row,
      moves: null,
      solution: null,
      cubes_solved: null,
      cubes_attempted: null,
      import_extra: null,
    })),
  );
  expect(await createStore(db).solves.page("s", { limit: 10 })).toEqual([
    {
      id: "kept",
      sessionId: "s",
      event: "333",
      timeMs: 10000,
      plus2: 1,
      dnf: false,
      scramble: "R",
      startedAt: 1,
      inspectionMs: 15000,
      comment: "note",
      input: "imported",
      moves: null,
      solution: null,
      cubesSolved: null,
      cubesAttempted: null,
    },
  ]);
});

// The legacy fixtures are independent of the migrations under test.
const legacyV1: Statement[] = [
  {
    sql: `CREATE TABLE session (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, event TEXT NOT NULL, order_key TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, deleted_at INTEGER
    ) STRICT`,
  },
  {
    sql: `CREATE TABLE solve (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES session(id), event TEXT NOT NULL,
      time_ms INTEGER NOT NULL CHECK (time_ms >= 0),
      plus2 INTEGER NOT NULL DEFAULT 0 CHECK (plus2 >= 0),
      dnf INTEGER NOT NULL DEFAULT 0 CHECK (dnf IN (0, 1)),
      scramble TEXT NOT NULL, started_at INTEGER NOT NULL, inspection_ms INTEGER, comment TEXT,
      input TEXT NOT NULL, import_source TEXT, import_hash TEXT,
      updated_at INTEGER NOT NULL, deleted_at INTEGER
    ) STRICT`,
  },
  {
    sql: "CREATE INDEX solve_by_session ON solve (session_id, started_at, id) WHERE deleted_at IS NULL",
  },
  { sql: "CREATE INDEX solve_session_time ON solve (session_id, time_ms)" },
  {
    sql: "CREATE UNIQUE INDEX solve_import ON solve (import_source, import_hash) WHERE import_hash IS NOT NULL",
  },
  {
    sql: `CREATE TABLE setting (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
    ) STRICT, WITHOUT ROWID`,
  },
];
const legacyV2: Statement[] = [
  ...legacyV1,
  { sql: "ALTER TABLE solve ADD COLUMN moves INTEGER" },
  { sql: "ALTER TABLE solve ADD COLUMN solution TEXT" },
  { sql: "ALTER TABLE solve ADD COLUMN cubes_solved INTEGER" },
  { sql: "ALTER TABLE solve ADD COLUMN cubes_attempted INTEGER" },
  { sql: "PRAGMA user_version = 2" },
];

test("v2 preserves ties and hidden imports on upgrade", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cubehaus-v2-"));
  let file: Db | undefined;
  try {
    const path = join(dir, "old.sqlite");
    file = createNodeDb(path);
    await file.batch([
      ...legacyV2,
      {
        sql: `INSERT INTO session VALUES
        ('B', 'Second', '333fm', 'a1', 1, 2, 3, NULL),
        ('A', 'First', '333', 'a0', 0, 1, 2, NULL)`,
      },
      {
        sql: `INSERT INTO solve VALUES
        ('b', 'A', '333', 11000, 0, 0, 'U', 1000, NULL, NULL, 'keyboard', NULL, NULL, 3, NULL, NULL, NULL, NULL, NULL),
        ('a', 'A', '333', 10000, 1, 0, 'R', 1000, 15000, 'note', 'keyboard', NULL, NULL, 2, NULL, NULL, NULL, NULL, NULL),
        ('hidden', 'B', '333fm', 0, 0, 0, 'R U', 2000, NULL, NULL, 'imported', 'fixture', 'h', 5, 5, 25, 'R', NULL, NULL)`,
      },
      { sql: "INSERT INTO setting VALUES ('theme', 'dark', 4)" },
    ]);
    const sessions = await file.all("SELECT * FROM session ORDER BY id");
    const solves = await file.all("SELECT * FROM solve ORDER BY id");
    const settings = await file.all("SELECT * FROM setting");
    await file.close();
    file = undefined;

    for (let open = 0; open < 2; open++) {
      file = createNodeDb(path);
      expect(await migrate(file)).toBe(7);
      expect(await file.all("PRAGMA user_version")).toEqual([
        { user_version: 7 },
      ]);
      expect(await file.all("PRAGMA foreign_key_check")).toEqual([]);
      expect(await file.all("PRAGMA integrity_check")).toEqual([
        { integrity_check: "ok" },
      ]);
      expect(await file.all("SELECT * FROM session ORDER BY id")).toEqual(
        sessions.map((row) => ({ ...row, folder_id: null })),
      );
      expect(await file.all("SELECT * FROM solve ORDER BY id")).toEqual(
        solves.map((row) => ({ ...row, import_extra: null })),
      );
      expect(await file.all("SELECT * FROM setting")).toEqual(settings);

      const store = createStore(file);
      expect(await store.sessions.list()).toEqual([
        {
          id: "A",
          name: "First",
          event: "333",
          orderKey: "a0",
          folderId: null,
          archived: false,
          createdAt: 1,
        },
        {
          id: "B",
          name: "Second",
          event: "333fm",
          orderKey: "a1",
          folderId: null,
          archived: true,
          createdAt: 2,
        },
      ]);
      const [newest] = await store.solves.page("A", { limit: 1 });
      expect(newest).toMatchObject({ id: "b", startedAt: 1000 });
      expect(
        await store.solves.page("A", {
          limit: 1,
          before: { id: "b", startedAt: 1000 },
        }),
      ).toEqual([expect.objectContaining({ id: "a", startedAt: 1000 })]);
      expect(await store.solves.page("B", { limit: 10 })).toEqual([]);
      await expect(
        file.batch([
          {
            sql: `INSERT INTO solve (id, session_id, event, time_ms, scramble, started_at, input, import_source, import_hash, updated_at)
            VALUES ('duplicate', 'B', '333fm', 0, 'R', 2000, 'imported', 'fixture', 'h', 5)`,
          },
        ]),
      ).rejects.toThrow(
        "UNIQUE constraint failed: solve.import_source, solve.import_hash",
      );
      await file.close();
      file = undefined;
    }
  } finally {
    await file?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("interrupted v3 DDL rolls back the schema and version before retry", async () => {
  await db.batch(legacyV2);
  const schema = await db.all("SELECT * FROM sqlite_schema ORDER BY name");
  const interrupted: Db = {
    ...db,
    batch: (statements) =>
      db.batch([...statements, { sql: "CREATE TABLE session (id TEXT)" }]),
  };
  await expect(migrate(interrupted)).rejects.toThrow(
    "table session already exists",
  );
  expect(await db.all("PRAGMA user_version")).toEqual([{ user_version: 2 }]);
  expect(await db.all("SELECT * FROM sqlite_schema ORDER BY name")).toEqual(
    schema,
  );
  expect(await migrate(db)).toBe(7);
  expect(await db.all("PRAGMA foreign_key_check")).toEqual([]);
});

test("fresh v3 has a strict flat folder table and indexed nullable membership", async () => {
  expect(await migrate(db)).toBe(7);
  const columns = await db.all("PRAGMA table_info(folder)");
  expect(
    columns.map(({ name, type, notnull, dflt_value, pk }) => [
      name,
      type,
      notnull,
      dflt_value,
      pk,
    ]),
  ).toEqual([
    ["id", "TEXT", 1, null, 1],
    ["name", "TEXT", 1, null, 0],
    ["order_key", "TEXT", 1, null, 0],
    ["collapsed", "INTEGER", 1, "0", 0],
    ["created_at", "INTEGER", 1, null, 0],
    ["updated_at", "INTEGER", 1, null, 0],
    ["deleted_at", "INTEGER", 0, null, 0],
  ]);
  expect(
    await db.all("SELECT strict FROM pragma_table_list WHERE name = 'folder'"),
  ).toEqual([{ strict: 1 }]);
  expect(
    await db.all(
      `SELECT "table", "from", "to" FROM pragma_foreign_key_list('session')`,
    ),
  ).toEqual([{ table: "folder", from: "folder_id", to: "id" }]);
  expect(
    await db.all(`SELECT info.name FROM pragma_index_list('session') AS indexes,
      pragma_index_info(indexes.name) AS info
      WHERE indexes.name = 'session_by_folder' ORDER BY info.seqno`),
  ).toEqual([{ name: "folder_id" }, { name: "order_key" }, { name: "id" }]);
});

test("fresh v4 maps source sessions by source, scope and key", async () => {
  expect(await migrate(db)).toBe(7);
  expect(
    (await db.all("PRAGMA table_info(import_session)")).map(
      ({ name, type, notnull, pk }) => [name, type, notnull, pk],
    ),
  ).toEqual([
    ["source", "TEXT", 1, 1],
    ["source_scope", "TEXT", 1, 2],
    ["source_key", "TEXT", 1, 3],
    ["session_id", "TEXT", 1, 0],
    ["source_meta", "TEXT", 1, 0],
    ["updated_at", "INTEGER", 1, 0],
  ]);
  expect(
    await db.all(
      `SELECT "table", "from", "to" FROM pragma_foreign_key_list('import_session')`,
    ),
  ).toEqual([{ table: "session", from: "session_id", to: "id" }]);
  await db.batch([
    {
      sql: "INSERT INTO session (id, name, event, order_key, created_at, updated_at) VALUES ('s', 'A', '333', 'a0', 1, 1)",
    },
    {
      sql: "INSERT INTO import_session VALUES ('cstimer', '', 'session1', 's', '{}', 1)",
    },
  ]);
  await expect(
    db.batch([
      {
        sql: "INSERT INTO import_session VALUES ('cstimer', '', 'session1', 's', '{}', 2)",
      },
    ]),
  ).rejects.toThrow();
  await expect(
    db.batch([
      {
        sql: "INSERT INTO import_session VALUES ('cstimer', '', 'session2', 'missing', '{}', 2)",
      },
    ]),
  ).rejects.toThrow();
});

test("v4 upgrades to an empty purge ledger, keeping tombstones and bindings", async () => {
  await migrate(db);
  // A version 4 file: the same schema without what 5 adds.
  await db.batch([
    { sql: "DROP TABLE trainer_attempt" },
    { sql: "DROP TABLE trainer_case" },
    { sql: "DROP TABLE solve_repeat" },
    { sql: "DROP TABLE import_seen" },
    { sql: "DROP INDEX solve_deleted" },
    { sql: "DROP INDEX session_deleted" },
    {
      sql: `INSERT INTO session (id, name, event, order_key, archived, created_at, updated_at, deleted_at)
        VALUES ('kept', 'A', '333', 'a0', 1, 1, 1, NULL), ('gone', 'B', '333', 'a1', 0, 1, 2, 2)`,
    },
    {
      sql: `INSERT INTO solve (id, session_id, event, time_ms, scramble, started_at, input,
        import_source, import_hash, updated_at, deleted_at)
        VALUES ('x', 'kept', '333', 9000, 'R', 5, 'imported', 'cstimer', 'h', 3, 3)`,
    },
    {
      sql: "INSERT INTO import_session VALUES ('cstimer', '', '1', 'gone', '{}', 2)",
    },
    { sql: "PRAGMA user_version = 4" },
  ]);
  const rows = async () => [
    await db.all("SELECT * FROM session ORDER BY id"),
    await db.all("SELECT * FROM solve ORDER BY id"),
    await db.all("SELECT * FROM import_session"),
  ];
  const before = await rows();
  expect(await migrate(db)).toBe(7);
  expect(await rows()).toEqual(before);
  expect(await db.all("SELECT count(*) AS n FROM import_seen")).toEqual([
    { n: 0 },
  ]);
  expect(
    (await db.all("PRAGMA table_info(import_seen)")).map(
      ({ name, type, notnull, pk }) => [name, type, notnull, pk],
    ),
  ).toEqual([
    ["source", "TEXT", 1, 1],
    ["hash", "TEXT", 1, 2],
  ]);
  expect(
    await db.all(
      "SELECT name FROM sqlite_schema WHERE name IN ('solve_deleted', 'session_deleted') ORDER BY name",
    ),
  ).toEqual([{ name: "session_deleted" }, { name: "solve_deleted" }]);
  const schema = await db.all("SELECT * FROM sqlite_schema ORDER BY name");
  expect(await migrate(db)).toBe(7);
  expect(await db.all("SELECT * FROM sqlite_schema ORDER BY name")).toEqual(
    schema,
  );
  expect(await db.all("PRAGMA foreign_key_check")).toEqual([]);
});

test("a version 5 file on disk gains repeats and keeps every row", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cubehaus-v5-"));
  const path = join(dir, "v5.sqlite");
  let file: Db | undefined;
  try {
    file = createNodeDb(path);
    await migrate(file);
    // A version 5 file: the same schema without what 6 and 7 add.
    await file.batch([
      { sql: "DROP TABLE trainer_attempt" },
      { sql: "DROP TABLE trainer_case" },
      { sql: "DROP TABLE solve_repeat" },
      {
        sql: `INSERT INTO session (id, name, event, order_key, created_at, updated_at)
          VALUES ('s', 'A', '333', 'a0', 1, 1)`,
      },
      {
        sql: `INSERT INTO solve (id, session_id, event, time_ms, plus2, dnf, scramble,
          started_at, inspection_ms, comment, input, updated_at, deleted_at)
          VALUES ('a', 's', '333', 10000, 1, 0, 'R U', 1000, 15200, 'note', 'keyboard', 2, NULL),
                 ('b', 's', '333', 11000, 0, 1, 'F', 2000, NULL, NULL, 'touch', 3, 4)`,
      },
      { sql: "INSERT INTO setting VALUES ('theme', 'dark', 4)" },
      { sql: "PRAGMA user_version = 5" },
    ]);
    const tables = async (db: Db) => [
      await db.all("SELECT * FROM session ORDER BY id"),
      await db.all("SELECT * FROM solve ORDER BY id"),
      await db.all("SELECT * FROM setting ORDER BY key"),
    ];
    const before = await tables(file);
    await file.close();

    for (let open = 0; open < 2; open++) {
      file = createNodeDb(path);
      expect(await migrate(file)).toBe(7);
      expect(await tables(file)).toEqual(before);
      expect(await file.all("PRAGMA foreign_key_check")).toEqual([]);
      expect(await file.all("PRAGMA integrity_check")).toEqual([
        { integrity_check: "ok" },
      ]);
      if (open === 0) {
        const store = createStore(file);
        await store.solves.add({
          id: "again",
          sessionId: "s",
          event: "333",
          timeMs: 9000,
          plus2: 0,
          dnf: false,
          scramble: "R U",
          startedAt: 5000,
          inspectionMs: null,
          comment: null,
          input: "keyboard",
          repeatOf: "a",
        });
        expect([...(await store.solves.series("s")).values]).toEqual([12000]);
      }
      await file.close();
      file = undefined;
    }
    file = createNodeDb(path);
    expect(
      (await createStore(file).repeats.list("a")).map(({ id }) => id),
    ).toEqual(["again"]);
  } finally {
    await file?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
