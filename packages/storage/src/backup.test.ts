import { afterEach, expect, test } from "vitest";
import {
  BackupFormatError,
  BackupReferenceError,
  backupTables,
  NewerBackupError,
  restore,
  snapshot,
} from "./backup";
import type { Db, SqlValue } from "./db";
import { migrate, SCHEMA_VERSION } from "./migrations";
import { createNodeDb } from "./node-db";
import { createStore } from "./store";

const open: Db[] = [];
async function fresh(): Promise<Db> {
  const db = createNodeDb(":memory:");
  await migrate(db);
  open.push(db);
  return db;
}
afterEach(async () => {
  for (const db of open.splice(0)) await db.close();
});

const insert = (table: string, row: Record<string, SqlValue>) => ({
  sql: `INSERT INTO ${table} (${Object.keys(row).join(", ")}) VALUES (${Object.keys(
    row,
  )
    .map(() => "?")
    .join(", ")})`,
  params: Object.values(row),
});

const solveRow = (id: string, over: Record<string, SqlValue> = {}) => ({
  id,
  session_id: "s1",
  event: "333",
  time_ms: 12345,
  plus2: 0,
  dnf: 0,
  scramble: "R U R'",
  started_at: 5000,
  inspection_ms: null,
  comment: null,
  input: "keyboard",
  import_source: null,
  import_hash: null,
  moves: null,
  solution: null,
  cubes_solved: null,
  cubes_attempted: null,
  updated_at: 5000,
  deleted_at: null,
  import_extra: null,
  cross_colour: null,
  splits: null,
  ...over,
});

const repeatRow = (id: string, over: Record<string, SqlValue> = {}) => ({
  id,
  solve_id: "a",
  time_ms: 9000,
  plus2: 0,
  dnf: 0,
  started_at: 6000,
  inspection_ms: 8000,
  comment: null,
  input: "keyboard",
  updated_at: 6000,
  deleted_at: null,
  splits: null,
  ...over,
});

async function seed(db: Db) {
  await db.batch([
    insert("folder", {
      id: "f1",
      name: "Empty",
      order_key: "a0",
      collapsed: 1,
      created_at: 10,
      updated_at: 11,
      deleted_at: null,
    }),
    insert("session", {
      id: "s1",
      name: "Main",
      event: "333",
      order_key: "a0",
      folder_id: null,
      archived: 0,
      created_at: 20,
      updated_at: 21,
      deleted_at: null,
    }),
    insert("session", {
      id: "s2",
      name: "Old",
      event: "333fm",
      order_key: "a1",
      folder_id: "f1",
      archived: 1,
      created_at: 30,
      updated_at: 31,
      deleted_at: null,
    }),
    insert("session", {
      id: "s3",
      name: "Gone",
      event: "333mbf",
      order_key: "a2",
      folder_id: null,
      archived: 0,
      created_at: 40,
      updated_at: 41,
      deleted_at: 42,
    }),
    insert("solve", solveRow("a", { plus2: 1, comment: "line\r\nnext" })),
    insert("solve", solveRow("b")),
    insert("solve", solveRow("c", { deleted_at: 6000, updated_at: 6000 })),
    insert(
      "solve",
      solveRow("d", {
        session_id: "s2",
        event: "333fm",
        time_ms: 0,
        moves: 22,
        solution: "R",
      }),
    ),
    insert(
      "solve",
      solveRow("e", {
        session_id: "s3",
        event: "333mbf",
        cubes_solved: 2,
        cubes_attempted: 3,
        import_source: "cstimer",
        import_hash: "h",
        input: "imported",
        import_extra: '{"v":1,"phases":[7000]}',
      }),
    ),
    insert("solve_repeat", repeatRow("r1")),
    insert(
      "solve_repeat",
      repeatRow("r2", {
        dnf: 1,
        deleted_at: 7000,
        updated_at: 7000,
        splits:
          '[{"name":"Cross","durationMs":1500},{"name":"Rest","durationMs":7500}]',
      }),
    ),
    insert("import_session", {
      source: "cstimer",
      source_scope: "",
      source_key: "session3",
      session_id: "s3",
      source_meta: '{"name":"Gone","opt":{"scrType":"r3ni"}}',
      updated_at: 43,
    }),
    insert("import_seen", { source: "timed", hash: '["333",9000,0,0,"R",5]' }),
    insert("setting", { key: "anything", value: '{"x":1}', updated_at: 7 }),
    insert("setting", { key: "session.current", value: "s1", updated_at: 8 }),
  ]);
}

async function dump(db: Db) {
  const out: Record<string, Record<string, SqlValue>[]> = {};
  for (const [name, { key, columns }] of backupTables())
    out[name] = await db.all(
      `SELECT ${columns.join(", ")} FROM ${name} ORDER BY ${key.join(", ")}`,
    );
  return out;
}

test("the manifest lists every column of the live schema", async () => {
  const db = await fresh();
  for (const [name, { columns }] of backupTables(SCHEMA_VERSION)) {
    const live = await db.all<{ name: string }>(
      `SELECT name FROM pragma_table_info('${name}')`,
    );
    expect([...columns].sort()).toEqual(live.map((c) => c.name).sort());
  }
  const tables = await db.all<{ name: string }>(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  expect(tables.map((t) => t.name).sort()).toEqual(
    backupTables()
      .map(([name]) => name)
      .sort(),
  );
});

test("native backup restores every persisted row", async () => {
  const source = await fresh();
  await seed(source);
  const backup = JSON.parse(JSON.stringify(await snapshot(source, () => 99)));
  expect(backup).toMatchObject({
    format: "cubehaus",
    version: 1,
    exportedAt: 99,
  });

  const target = await fresh();
  // A first start leaves one generated session and its setting behind.
  await target.batch([
    insert("session", {
      id: "generated",
      name: "Practice",
      event: "333",
      order_key: "a0",
      folder_id: null,
      archived: 0,
      created_at: 1,
      updated_at: 1,
      deleted_at: null,
    }),
    insert("setting", {
      key: "session.current",
      value: "generated",
      updated_at: 9999,
    }),
  ]);
  expect(await restore(target, backup)).toEqual({
    inserted: 15,
    updated: 0,
    unchanged: 0,
  });
  expect(await dump(target)).toEqual(await dump(source));
  expect(await restore(target, backup)).toEqual({
    inserted: 0,
    updated: 0,
    unchanged: 15,
  });
  expect(await dump(target)).toEqual(await dump(source));
  expect(await target.all("PRAGMA foreign_key_check")).toEqual([]);
});

test("restoring into a used database keeps the newer edit of each row", async () => {
  const source = await fresh();
  await seed(source);
  const backup = await snapshot(source);
  const target = await fresh();
  await seed(target);
  await target.batch([
    // Edited here after the backup: kept.
    { sql: "UPDATE solve SET plus2 = 0, updated_at = 9000 WHERE id = 'a'" },
    // Older here than in the backup: replaced.
    {
      sql: "UPDATE solve SET comment = 'stale', updated_at = 1 WHERE id = 'b'",
    },
    { sql: "DELETE FROM solve WHERE id = 'd'" },
    // The same import under another ID: the backup's copy is skipped.
    { sql: "DELETE FROM solve WHERE id = 'e'" },
    insert(
      "solve",
      solveRow("e2", {
        session_id: "s3",
        event: "333mbf",
        cubes_solved: 2,
        cubes_attempted: 3,
        import_source: "cstimer",
        import_hash: "h",
        input: "imported",
      }),
    ),
    // A newer mapping here wins over the backup's.
    {
      sql: "UPDATE import_session SET source_meta = '{}', updated_at = 99 WHERE source_key = 'session3'",
    },
  ]);
  expect(await restore(target, backup)).toEqual({
    inserted: 1,
    updated: 1,
    unchanged: 13,
  });
  expect(await target.all("SELECT source_meta FROM import_session")).toEqual([
    { source_meta: "{}" },
  ]);
  const rows = await target.all<{ id: string; plus2: number; comment: string }>(
    "SELECT id, plus2, comment FROM solve ORDER BY id",
  );
  expect(rows.map((r) => r.id)).toEqual(["a", "b", "c", "d", "e2"]);
  expect(rows[0]?.plus2).toBe(0);
  expect(rows[1]?.comment).toBeNull();
});

test("a bad, newer or dangling backup leaves the target unchanged", async () => {
  const source = await fresh();
  await seed(source);
  const good = await snapshot(source);
  const target = await fresh();
  await seed(target);
  await target.batch([
    { sql: "UPDATE session SET name = 'Here', updated_at = 1 WHERE id = 's1'" },
  ]);
  const before = await dump(target);

  const dangling = structuredClone(good);
  dangling.tables.solve?.push(solveRow("z", { session_id: "nowhere" }));
  await expect(restore(target, dangling)).rejects.toThrow(BackupReferenceError);
  const unmapped = structuredClone(good);
  unmapped.tables.import_session?.push({
    source: "cstimer",
    source_scope: "",
    source_key: "session9",
    session_id: "nowhere",
    source_meta: "{}",
    updated_at: 1,
  });
  await expect(restore(target, unmapped)).rejects.toThrow(BackupReferenceError);

  await expect(
    restore(target, { ...good, schema: SCHEMA_VERSION + 1 }),
  ).rejects.toThrow(NewerBackupError);
  await expect(restore(target, { ...good, version: 2 })).rejects.toThrow(
    NewerBackupError,
  );
  for (const bad of [
    null,
    "text",
    { format: "cstimer" },
    { ...good, tables: { solve: "x" } },
    { ...good, tables: { solve: [{ id: "only" }] } },
    { ...good, tables: { other: [] } },
    { ...good, tables: { setting: [{ key: "k", value: 1.5, updated_at: 1 }] } },
  ])
    await expect(restore(target, bad)).rejects.toThrow(BackupFormatError);

  // A row the database itself refuses rolls back everything written before it.
  const refused = structuredClone(good);
  refused.tables.session?.push({
    ...(refused.tables.session?.[0] ?? {}),
    id: "s9",
    name: null,
  });
  await expect(restore(target, refused)).rejects.toThrow();
  expect(await dump(target)).toEqual(before);
});

test("a backup from schema 3 restores into the current schema", async () => {
  const source = await fresh();
  await seed(source);
  const current = await snapshot(source);
  const v3 = {
    ...current,
    schema: 3,
    tables: Object.fromEntries(
      backupTables(3).map(([name, { columns }]) => [
        name,
        (current.tables[name] ?? []).map((row) =>
          Object.fromEntries(columns.map((column) => [column, row[column]])),
        ),
      ]),
    ),
  };
  const target = await fresh();
  expect(await restore(target, v3)).toEqual({
    inserted: 11,
    updated: 0,
    unchanged: 0,
  });
  expect(
    await target.all("SELECT id, import_extra FROM solve WHERE id = 'e'"),
  ).toEqual([{ id: "e", import_extra: null }]);
  expect(await target.all("SELECT * FROM import_session")).toEqual([]);
});

test("a backup from schema 5 restores, and a repeat of a dangling solve is refused", async () => {
  const source = await fresh();
  await seed(source);
  const current = await snapshot(source);
  const v5 = {
    ...current,
    schema: 5,
    tables: Object.fromEntries(
      backupTables(5).map(([name, { columns }]) => [
        name,
        (current.tables[name] ?? []).map((row) =>
          Object.fromEntries(columns.map((column) => [column, row[column]])),
        ),
      ]),
    ),
  };
  expect(v5.tables.solve_repeat).toBeUndefined();
  const target = await fresh();
  expect(await restore(target, v5)).toEqual({
    inserted: 13,
    updated: 0,
    unchanged: 0,
  });
  expect(await target.all("SELECT count(*) AS n FROM solve_repeat")).toEqual([
    { n: 0 },
  ]);
  // The repeats come with a later schema 6 restore of the same history.
  expect(await restore(target, current)).toMatchObject({ inserted: 2 });
  expect(await dump(target)).toEqual(await dump(source));

  const dangling = JSON.parse(JSON.stringify(current));
  dangling.tables.solve_repeat[0].solve_id = "missing";
  const other = await fresh();
  await expect(restore(other, dangling)).rejects.toBeInstanceOf(
    BackupReferenceError,
  );
  expect(await other.all("SELECT count(*) AS n FROM solve")).toEqual([
    { n: 0 },
  ]);
});

test("a backup from schema 7 restores its trainer attempts as not split", async () => {
  const source = await fresh();
  await source.batch([
    {
      sql: `INSERT INTO trainer_attempt (id, set_id, case_id, mode, auf, scramble, recog_ms,
        exec_ms, missed, grade, at, updated_at, split)
        VALUES ('a', 'pll', 'pll-T', 'picture', 1, NULL, 640, 1830, 0, 'good', 5, 5, 0),
          ('b', 'pll', 'pll-T', 'scramble', 0, 'R U', 500, 1700, 0, 'good', 6, 6, 1)`,
    },
  ]);
  const current = await snapshot(source);
  // The current backup carries the mark.
  expect(current.tables.trainer_attempt?.map((r) => r.split)).toEqual([0, 1]);
  const v7 = {
    ...current,
    schema: 7,
    tables: Object.fromEntries(
      backupTables(7).map(([name, { columns }]) => [
        name,
        (current.tables[name] ?? []).map((row) =>
          Object.fromEntries(columns.map((column) => [column, row[column]])),
        ),
      ]),
    ),
  };
  expect(v7.tables.trainer_attempt?.[0]).not.toHaveProperty("split");
  const target = await fresh();
  await restore(target, v7);
  expect(
    await target.all(
      "SELECT id, recog_ms, split FROM trainer_attempt ORDER BY id",
    ),
  ).toEqual([
    { id: "a", recog_ms: 640, split: 0 },
    { id: "b", recog_ms: 500, split: 0 },
  ]);
  const again = await fresh();
  await restore(again, current);
  expect(
    await again.all("SELECT id, split FROM trainer_attempt ORDER BY id"),
  ).toEqual([
    { id: "a", split: 0 },
    { id: "b", split: 1 },
  ]);
});

test("cross colour and named splits round-trip; a schema 8 backup restores neither", async () => {
  const source = await fresh();
  await source.batch([
    insert("session", {
      id: "s1",
      name: "3×3",
      event: "333",
      order_key: "a",
      folder_id: null,
      archived: 0,
      created_at: 1,
      updated_at: 1,
      deleted_at: null,
    }),
    insert(
      "solve",
      solveRow("a", {
        cross_colour: "yellow",
        splits:
          '[{"name":"Cross","durationMs":1820},{"name":"Rest","durationMs":10525}]',
      }),
    ),
    insert("solve", solveRow("b", { started_at: 6000 })),
  ]);
  const current = await snapshot(source);
  expect(current.tables.solve?.map((r) => r.cross_colour)).toEqual([
    "yellow",
    null,
  ]);
  const roundTrip = await fresh();
  await restore(roundTrip, JSON.parse(JSON.stringify(current)));
  expect(
    await roundTrip.all("SELECT id, cross_colour FROM solve ORDER BY id"),
  ).toEqual([
    { id: "a", cross_colour: "yellow" },
    { id: "b", cross_colour: null },
  ]);
  expect((await createStore(roundTrip).solves.get("a"))?.splits).toEqual([
    { name: "Cross", durationMs: 1820 },
    { name: "Rest", durationMs: 10525 },
  ]);
  const v8 = {
    ...current,
    schema: 8,
    tables: Object.fromEntries(
      backupTables(8).map(([name, { columns }]) => [
        name,
        (current.tables[name] ?? []).map((row) =>
          Object.fromEntries(columns.map((column) => [column, row[column]])),
        ),
      ]),
    ),
  };
  expect(v8.tables.solve?.[0]).not.toHaveProperty("cross_colour");
  const old = await fresh();
  await restore(old, v8);
  expect(
    await old.all("SELECT id, cross_colour FROM solve ORDER BY id"),
  ).toEqual([
    { id: "a", cross_colour: null },
    { id: "b", cross_colour: null },
  ]);
  expect(await createStore(old).solves.get("a")).not.toHaveProperty("splits");
  // A colour that is not one of the six is refused, and nothing is written.
  const bad = structuredClone(current);
  (bad.tables.solve?.[0] as Record<string, SqlValue>).cross_colour = "purple";
  const target = await fresh();
  await expect(restore(target, bad)).rejects.toThrow();
  expect(await target.all("SELECT count(*) AS n FROM solve")).toEqual([
    { n: 0 },
  ]);
});

/** The seed plus the trainer's tables: every table a backup carries has rows. */
async function seedAll(db: Db) {
  await seed(db);
  await db.batch([
    insert("trainer_case", {
      set_id: "pll",
      case_id: "pll-T",
      card: '{"due":1}',
      due_at: 900,
      added_at: 800,
      updated_at: 850,
      removed_at: null,
    }),
    insert("trainer_case", {
      set_id: "oll",
      case_id: "oll-21",
      card: '{"due":2}',
      due_at: 901,
      added_at: 801,
      updated_at: 851,
      removed_at: 860,
    }),
    insert("trainer_attempt", {
      id: "t1",
      set_id: "pll",
      case_id: "pll-T",
      mode: "picture",
      auf: 1,
      scramble: null,
      recog_ms: 640,
      exec_ms: 1830,
      missed: 0,
      grade: "good",
      at: 870,
      updated_at: 870,
      split: 1,
    }),
    insert("setting", {
      key: "trainer.algs",
      value: '{"pll-T":1}',
      updated_at: 9,
    }),
  ]);
}

test("every table goes round one backup file, whichever app wrote it", async () => {
  // The web's worker, the desktop's native file and the phone's copy in Documents all
  // write this one snapshot as JSON text; any of them restores anywhere.
  const source = await fresh();
  await seedAll(source);
  const text = JSON.stringify(await snapshot(source, () => 1));
  for (const [name] of backupTables())
    expect(JSON.parse(text).tables[name].length, name).toBeGreaterThan(0);

  const target = await fresh();
  expect(await restore(target, JSON.parse(text))).toMatchObject({
    updated: 0,
    unchanged: 0,
  });
  expect(await dump(target)).toEqual(await dump(source));
  // The target's own backup is the same file, its time aside.
  expect(JSON.stringify(await snapshot(target, () => 1))).toBe(text);
});

test("a first start that only drilled cases still takes a backup of the same cases", async () => {
  const source = await fresh();
  await seedAll(source);
  const backup = JSON.parse(JSON.stringify(await snapshot(source)));
  const target = await fresh();
  // A new browser: the generated session, and a case drilled before the restore.
  await target.batch([
    insert("session", {
      id: "generated",
      name: "3×3",
      event: "333",
      order_key: "a0",
      folder_id: null,
      archived: 0,
      created_at: 1,
      updated_at: 1,
      deleted_at: null,
    }),
    insert("trainer_case", {
      set_id: "pll",
      case_id: "pll-T",
      card: '{"due":0}',
      due_at: 1,
      added_at: 1,
      updated_at: 1,
      removed_at: null,
    }),
  ]);
  expect(await restore(target, backup)).toMatchObject({ updated: 1 });
  expect(await dump(target)).toEqual(await dump(source));
});

test("a backup of every older schema restores into the current one", async () => {
  const source = await fresh();
  await seedAll(source);
  const current = await snapshot(source);
  for (let schema = 3; schema <= SCHEMA_VERSION; schema++) {
    const old = {
      ...current,
      schema,
      tables: Object.fromEntries(
        backupTables(schema).map(([name, { columns }]) => [
          name,
          (current.tables[name] ?? []).map((row) =>
            Object.fromEntries(columns.map((column) => [column, row[column]])),
          ),
        ]),
      ),
    };
    const target = await fresh();
    const rows = Object.values(old.tables).flat().length;
    expect(await restore(target, old), `schema ${schema}`).toEqual({
      inserted: rows,
      updated: 0,
      unchanged: 0,
    });
  }
});
