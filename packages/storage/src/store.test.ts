import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Solve } from "@cubehaus/core";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  createStore,
  type Db,
  type ImportedSolve,
  type ImportPlan,
  type ImportPlanSolve,
  MergeError,
  MoveError,
  migrate,
  SplitError,
  type Store,
} from "./index";
import { createNodeDb } from "./node-db";

let db: Db;
let store: Store;
let sessionId: string;
let clock = 1000;
beforeEach(async () => {
  db = createNodeDb(":memory:");
  await migrate(db);
  clock = 1000;
  store = createStore(db, () => clock++);
  sessionId = (await store.sessions.create({ name: "Practice", event: "333" }))
    .id;
});
afterEach(async () => {
  await db.close();
});

function solve(
  id: string,
  startedAt = Number(id),
  extra: Partial<Solve> = {},
): Solve {
  return {
    id,
    sessionId,
    event: "333",
    timeMs: 10000,
    plus2: 0,
    dnf: false,
    scramble: "R U",
    startedAt,
    inspectionMs: null,
    comment: null,
    input: "keyboard",
    ...extra,
  };
}

test("batch rolls back every statement when the third violates a CHECK", async () => {
  await expect(
    db.batch([
      { sql: "INSERT INTO setting VALUES ('atomic', 'no', 0)" },
      {
        sql: "INSERT INTO solve (id, session_id, event, time_ms, scramble, started_at, input, updated_at) VALUES (?, ?, '333', 100, '', 0, 'keyboard', 0)",
        params: ["valid", sessionId],
      },
      { sql: "UPDATE solve SET time_ms = -1 WHERE id = 'valid'" },
    ]),
  ).rejects.toThrow();
  expect(await store.settings.get("atomic")).toBeNull();
  expect(await store.solves.count(sessionId)).toBe(0);
  await store.solves.add(solve("1"));
  expect(await store.solves.count(sessionId)).toBe(1);
});

test("add, count and cursor pagination preserve chronological ties without gaps", async () => {
  for (const id of ["3", "1", "5", "2", "4"])
    await store.solves.add(solve(id, id === "3" ? 2 : Number(id)));
  expect(await store.solves.count(sessionId)).toBe(5);
  expect(
    (await store.solves.page(sessionId, { limit: 10 })).map((s) => s.id),
  ).toEqual(["5", "4", "3", "2", "1"]);
  const ids: string[] = [];
  let before: { startedAt: number; id: string } | undefined;
  for (;;) {
    const page = await store.solves.page(sessionId, {
      limit: 2,
      ...(before ? { before } : {}),
    });
    if (!page.length) break;
    ids.push(...page.map((s) => s.id));
    const last = page.at(-1) as Solve;
    before = { startedAt: last.startedAt, id: last.id };
  }
  expect(ids).toEqual(["5", "4", "3", "2", "1"]);
  expect(await store.solves.series(sessionId)).toEqual({
    values: new Float64Array([10000, 10000, 10000, 10000, 10000]),
    startedAt: new Float64Array([1, 2, 2, 4, 5]),
  });
  expect(await store.solves.count("missing")).toBe(0);
  expect(await store.solves.series("missing")).toEqual({
    values: new Float64Array(),
    startedAt: new Float64Array(),
  });
});

test("E2d and E2d1: Fewest Moves series reports move counts and Infinity for DNF", async () => {
  const session = await store.sessions.create({
    name: "Fewest Moves",
    event: "333fm",
  });
  const accepted = solve("accepted", 1, {
    sessionId: session.id,
    event: "333fm",
    input: "manual",
    moves: 25,
    solution: "r2' U",
  });
  await store.solves.add(accepted);
  await store.solves.add({ ...accepted, id: "dnf", startedAt: 2, dnf: true });
  // Old timer rows can have a timed event and no move count in this session.
  await store.solves.add(solve("legacy", 3, { sessionId: session.id }));
  expect(
    await store.solves.page(session.id, {
      limit: 1,
      before: { id: "dnf", startedAt: 2 },
    }),
  ).toEqual([{ ...accepted, cubesSolved: null, cubesAttempted: null }]);
  expect(await store.solves.series(session.id)).toEqual({
    values: new Float64Array([25, Infinity, Infinity]),
    startedAt: new Float64Array([1, 2, 3]),
  });
});

test("9f12c and WCA export readme: Multi-Blind series uses the stored cube counts", async () => {
  const session = await store.sessions.create({
    name: "Multi-Blind",
    event: "333mbf",
  });
  const accepted = solve("accepted", 1, {
    sessionId: session.id,
    event: "333mbf",
    input: "manual",
    timeMs: 2430870,
    cubesSolved: 3,
    cubesAttempted: 5,
  });
  await store.solves.addImported([
    { ...accepted, importSource: "fixture", importHash: "multi" },
  ]);
  await store.solves.add({
    ...accepted,
    id: "dnf",
    startedAt: 2,
    cubesSolved: 2,
  });
  expect(
    await store.solves.page(session.id, {
      limit: 1,
      before: { id: "dnf", startedAt: 2 },
    }),
  ).toEqual([{ ...accepted, moves: null, solution: null }]);
  expect(await store.solves.series(session.id)).toEqual({
    values: new Float64Array([980243002, Infinity]),
    startedAt: new Float64Array([1, 2]),
  });
});

test("equal timestamps have identical id order after reopening a file database", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cubehaus-storage-"));
  let fileDb: Db | undefined;
  try {
    const path = join(dir, "test.sqlite");
    fileDb = createNodeDb(path);
    await migrate(fileDb);
    let fileStore = createStore(fileDb);
    const session = await fileStore.sessions.create({
      name: "Ties",
      event: "333",
    });
    const expected = ["b", "a"].map((id) => ({
      ...solve(id, 5, { sessionId: session.id }),
      moves: null,
      solution: null,
      cubesSolved: null,
      cubesAttempted: null,
    }));
    for (const row of expected) await fileStore.solves.add(row);
    await fileDb.close();
    fileDb = undefined;
    fileDb = createNodeDb(path);
    fileStore = createStore(fileDb);
    expect(await fileDb.all("PRAGMA integrity_check")).toEqual([
      { integrity_check: "ok" },
    ]);
    expect(await fileStore.sessions.list()).toEqual([session]);
    expect(await fileStore.solves.page(session.id, { limit: 10 })).toEqual(
      expected,
    );
    expect((await fileStore.solves.series(session.id)).startedAt).toEqual(
      new Float64Array([5, 5]),
    );
  } finally {
    if (fileDb) await fileDb.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("penalty updates affect series, DNF wins, invalid counts are rejected", async () => {
  await store.solves.add(solve("1"));
  await store.solves.add(solve("2", 2, { timeMs: 11000 }));
  for (const [plus2, dnf, value] of [
    [1, false, 13000],
    [2, false, 15000],
    [1, true, Infinity],
  ] as const) {
    await store.solves.setPenalty("2", { plus2, dnf });
    expect((await store.solves.series(sessionId)).values).toEqual(
      new Float64Array([10000, value]),
    );
    expect((await store.solves.page(sessionId, { limit: 1 }))[0]).toMatchObject(
      { plus2, dnf },
    );
  }
  await expect(
    store.solves.setPenalty("2", { plus2: -1, dnf: false }),
  ).rejects.toThrow();
  await expect(
    store.solves.setPenalty("2", { plus2: 0.5, dnf: false }),
  ).rejects.toThrow();
  expect((await store.solves.series(sessionId)).values[1]).toBe(Infinity);
});

test("soft deletion, restore, comments and duplicate ids preserve the row", async () => {
  const original = solve("1", 10, { inspectionMs: 15000, plus2: 1 });
  const stored = {
    ...original,
    moves: null,
    solution: null,
    cubesSolved: null,
    cubesAttempted: null,
  };
  await store.solves.add(original);
  await store.solves.add(solve("2", 20));
  await store.solves.add(solve("1", 999));
  expect((await store.solves.page(sessionId, { limit: 10 }))[1]).toEqual(
    stored,
  );
  await store.solves.setComment("1", "Practice note");
  expect((await store.solves.page(sessionId, { limit: 10 }))[1]?.comment).toBe(
    "Practice note",
  );
  await store.solves.setComment("1", null);
  await store.solves.remove("1");
  expect(await store.solves.count(sessionId)).toBe(1);
  expect(
    (await store.solves.page(sessionId, { limit: 10 })).map((s) => s.id),
  ).toEqual(["2"]);
  expect((await store.solves.series(sessionId)).startedAt).toEqual(
    new Float64Array([20]),
  );
  const deleted = (
    await db.all("SELECT deleted_at, updated_at FROM solve WHERE id = '1'")
  )[0];
  expect(deleted?.deleted_at).toBe(deleted?.updated_at);
  await store.solves.restore("1");
  expect(await store.solves.count(sessionId)).toBe(2);
  expect((await store.solves.page(sessionId, { limit: 10 }))[1]).toEqual(
    stored,
  );
});

test("imports 12000 rows in 5000-row transactions and skips a repeated import", async () => {
  const rows: ImportedSolve[] = Array.from({ length: 12000 }, (_, i) => ({
    ...solve(String(i)),
    input: "imported",
    importSource: "synthetic",
    importHash: `hash-${i}`,
  }));
  const sizes: number[] = [];
  const traced: Db = {
    all: db.all.bind(db),
    columns: db.columns.bind(db),
    close: db.close.bind(db),
    batch: async (statements) => {
      sizes.push(statements.length);
      await db.batch(statements);
    },
  };
  const importing = createStore(traced);
  const start = performance.now();
  expect(await importing.solves.addImported(rows)).toEqual({
    added: 12000,
    skipped: 0,
  });
  const firstMs = performance.now() - start;
  expect(sizes).toEqual([5000, 5000, 2000]);
  const repeat = performance.now();
  expect(await importing.solves.addImported(rows)).toEqual({
    added: 0,
    skipped: 12000,
  });
  console.info(
    `12000-row import: first ${firstMs.toFixed(2)}ms; repeat ${(performance.now() - repeat).toFixed(2)}ms; total ${(performance.now() - start).toFixed(2)}ms`,
  );
  expect(await store.solves.count(sessionId)).toBe(12000);
  expect(
    await importing.solves.addImported([
      { ...(rows[0] as ImportedSolve), id: "new-id" },
    ]),
  ).toEqual({ added: 0, skipped: 1 });
  await store.solves.remove("0");
  expect(
    await importing.solves.addImported([rows[0] as ImportedSolve]),
  ).toEqual({ added: 0, skipped: 1 });
  expect(await store.solves.count(sessionId)).toBe(11999);
});

test("sessions append in order, rename, hide and restore in the original position", async () => {
  const second = await store.sessions.create({ name: "Second", event: "222" });
  const third = await store.sessions.create({ name: "Third", event: "444" });
  expect((await store.sessions.list()).map((s) => s.id)).toEqual([
    sessionId,
    second.id,
    third.id,
  ]);
  expect(second).toMatchObject({
    archived: false,
    event: "222",
    folderId: null,
    name: "Second",
    createdAt: 1001,
  });
  await store.sessions.rename(second.id, "Renamed");
  await store.sessions.remove(second.id);
  expect((await store.sessions.list()).map((s) => s.id)).toEqual([
    sessionId,
    third.id,
  ]);
  await store.sessions.restore(second.id);
  expect(await store.sessions.list()).toEqual([
    expect.objectContaining({ id: sessionId }),
    { ...second, name: "Renamed" },
    third,
  ]);
  await store.sessions.remove(third.id);
  const fourth = await store.sessions.create({ name: "Fourth", event: "333" });
  await store.sessions.restore(third.id);
  expect((await store.sessions.list()).map((s) => s.id)).toEqual([
    sessionId,
    second.id,
    third.id,
    fourth.id,
  ]);
});

const day = 86_400_000;

test("session trash retains children and respects the 30 day boundary", async () => {
  const other = await store.sessions.create({ name: "B", event: "333" });
  for (const id of ["10", "20", "30"]) await store.solves.add(solve(id));
  await store.solves.add(solve("5"));
  clock = 1000;
  await store.solves.remove("5");

  // Archived: still a live session with live solves, only marked.
  await store.sessions.setArchived(sessionId, true);
  expect(
    (await store.sessions.list()).map(({ id, archived }) => [id, archived]),
  ).toEqual([
    [sessionId, true],
    [other.id, false],
  ]);
  expect(await store.solves.count(sessionId)).toBe(3);
  expect(
    await db.all(
      `SELECT count(*) AS n FROM solve JOIN session ON session.id = solve.session_id
        WHERE solve.event = '333' AND solve.deleted_at IS NULL AND session.deleted_at IS NULL`,
    ),
  ).toEqual([{ n: 3 }]);
  // A solve deleted on its own is in the trash by itself.
  expect(await store.trash.list(1000)).toEqual([
    expect.objectContaining({ kind: "solve", id: "5", deletedAt: 1000 }),
  ]);

  // Trashed at 1000: its solves are hidden with it, their own dates untouched.
  clock = 1000;
  await store.sessions.remove(sessionId);
  const deadline = 1000 + 30 * day;
  expect(await store.trash.list(deadline - 1)).toEqual([
    expect.objectContaining({
      kind: "session",
      id: sessionId,
      deletedAt: 1000,
      expiresAt: deadline,
      count: 3,
    }),
  ]);
  expect(
    await db.all(
      "SELECT id, deleted_at FROM solve WHERE session_id = ? ORDER BY id",
      [sessionId],
    ),
  ).toEqual([
    { id: "10", deleted_at: null },
    { id: "20", deleted_at: null },
    { id: "30", deleted_at: null },
    { id: "5", deleted_at: 1000 },
  ]);

  // One millisecond before the deadline nothing goes, and it comes back whole.
  expect(await store.trash.expire(deadline - 1)).toBe(0);
  clock = deadline - 1;
  await store.trash.restore("session", sessionId);
  expect(
    (await store.solves.page(sessionId, { limit: 10 })).map(({ id }) => id),
  ).toEqual(["30", "20", "10"]);
  expect(
    (await store.sessions.list()).find(({ id }) => id === sessionId),
  ).toMatchObject({ archived: true });
  // The solve deleted on its own stays deleted, in the trash with its own deadline.
  expect(await store.trash.list(deadline - 1)).toEqual([
    expect.objectContaining({
      kind: "solve",
      id: "5",
      deletedAt: 1000,
      expiresAt: deadline,
      sessionName: "Practice",
    }),
  ]);

  // At the deadline exactly it is eligible, and goes with everything in it.
  clock = 1000;
  await store.sessions.remove(sessionId);
  expect(await store.trash.list(deadline)).toEqual([]);
  expect(await store.trash.expire(deadline)).toBe(5);
  expect(
    await db.all("SELECT count(*) AS n FROM solve WHERE session_id = ?", [
      sessionId,
    ]),
  ).toEqual([{ n: 0 }]);
  expect((await store.sessions.list()).map(({ id }) => id)).toEqual([other.id]);
  await store.trash.restore("session", sessionId);
  expect((await store.sessions.list()).map(({ id }) => id)).toEqual([other.id]);
  expect(await store.trash.expire(deadline + day)).toBe(0);
});

function cubeTimePlan(
  source: "cubetime" | "cstimer",
  rows: readonly Partial<ImportPlanSolve>[],
): ImportPlan {
  return {
    source,
    ...(source === "cstimer" ? { penaltiesFor: ["cubetime"] } : {}),
    sessions: [
      {
        sourceKey: source,
        name: source,
        event: "333",
        meta: "{}",
        solves: rows.map((row, i) => ({
          timeMs: 10000,
          plus2: 0,
          dnf: false,
          scramble: "R U",
          startedAt: 10_123,
          inspectionMs: null,
          comment: null,
          importHash: `${source}-${i}`,
          importExtra: null,
          ...row,
        })),
      },
    ],
  };
}

test("one history through the CSV and the csTimer route is imported once, in either order", async () => {
  const clean = { timeMs: 11000, startedAt: 10_123 };
  const dnf = { timeMs: 12000, startedAt: 20_456 };
  const plus2 = { timeMs: 13000, startedAt: 30_789 };
  const csv = cubeTimePlan("cubetime", [clean, dnf, plus2]);
  const json = cubeTimePlan("cstimer", [
    { ...clean, startedAt: 10_000 },
    { ...dnf, dnf: true, startedAt: 20_000 },
    { ...plus2, plus2: 1, startedAt: 31_000 },
  ]);
  const penalties = [
    { time_ms: 11000, plus2: 0, dnf: 0 },
    { time_ms: 12000, plus2: 0, dnf: 1 },
    { time_ms: 13000, plus2: 1, dnf: 0 },
  ];
  for (const [first, second, penalized] of [
    [csv, json, 2],
    [json, csv, 0],
  ] as const) {
    const history = createNodeDb(":memory:");
    try {
      await migrate(history);
      const imported = createStore(history, () => clock);
      const read = () =>
        history.all("SELECT time_ms, plus2, dnf FROM solve ORDER BY time_ms");
      const initial = await imported.importBatch(first);
      expect(initial).toMatchObject({ added: 3, skipped: 0 });
      const beforeReview = await read();
      expect(await imported.reviewImport(second)).toMatchObject({
        added: 0,
        skipped: 3,
        penalized,
        sessions: [{ target: initial.sessionIds[0], create: false, here: 3 }],
      });
      expect(await read()).toEqual(beforeReview);
      clock++;
      expect(await imported.importBatch(second)).toMatchObject({
        added: 0,
        skipped: 3,
        penalized,
        sessions: 0,
        sessionIds: initial.sessionIds,
      });
      expect(await read()).toEqual(penalties);
      expect(
        await history.all(
          "SELECT count(*) AS n FROM solve WHERE updated_at = ?",
          [clock],
        ),
      ).toEqual([{ n: penalized }]);
    } finally {
      await history.close();
    }
  }
});

test("a CubeTime solve keeps the penalty the person already gave it", async () => {
  const first = await store.importBatch(cubeTimePlan("cubetime", [{}]));
  const [target] = first.sessionIds;
  if (!target) throw new Error("Missing imported session");
  const [row] = await store.solves.page(target, { limit: 1 });
  if (!row) throw new Error("Missing imported solve");
  await store.solves.setPenalty(row.id, { plus2: 1, dnf: false });

  expect(
    await store.importBatch(cubeTimePlan("cstimer", [{ dnf: true }])),
  ).toMatchObject({ added: 0, skipped: 1, penalized: 0 });
  expect(await store.solves.get(row.id)).toMatchObject({
    plus2: 1,
    dnf: false,
  });
});

test("two equal solves on both CubeTime routes stay two", async () => {
  const csv = cubeTimePlan("cubetime", [{}, {}]);
  const json = cubeTimePlan("cstimer", [{ dnf: true }, { dnf: true }]);
  const first = await store.importBatch(csv);
  const [target] = first.sessionIds;
  if (!target) throw new Error("Missing imported session");
  expect(first).toMatchObject({ added: 2, skipped: 0 });
  expect(await store.importBatch(json)).toMatchObject({
    added: 0,
    skipped: 2,
    penalized: 2,
  });
  expect(await store.solves.count(target)).toBe(2);
  expect((await store.solves.series(target)).values).toEqual(
    new Float64Array([Infinity, Infinity]),
  );
});

test("expired imports and timed solves never come back with a repeat import", async () => {
  const plan = {
    source: "cstimer",
    sessions: [
      {
        sourceKey: "1",
        name: "Imported",
        event: "333" as const,
        meta: "{}",
        solves: [1, 2].map((n) => ({
          timeMs: 9000 + n,
          plus2: 0,
          dnf: false,
          scramble: `F${n}`,
          startedAt: n * 1000,
          inspectionMs: null,
          comment: null,
          importHash: `h${n}`,
          importExtra: null,
        })),
      },
    ],
  };
  const first = await store.importBatch(plan);
  expect(first).toMatchObject({ added: 2, sessions: 1 });
  const imported = first.sessionIds[0] as string;
  // A solve timed here, exported and imported back, matches by its values.
  await store.solves.add(solve("50", 50_000));
  const exported = {
    ...plan,
    source: "csv",
    sessions: [
      {
        ...(plan.sessions[0] as (typeof plan.sessions)[0]),
        sourceKey: "x",
        solves: [
          {
            timeMs: 10000,
            plus2: 0,
            dnf: false,
            scramble: "R U",
            startedAt: 50_000,
            inspectionMs: null,
            comment: null,
            importHash: "csv-1",
            importExtra: null,
          },
        ],
      },
    ],
  };
  expect(await store.importBatch(exported)).toMatchObject({
    added: 0,
    skipped: 1,
  });

  clock = 1000;
  await store.sessions.remove(imported);
  clock = 1000;
  await store.solves.remove("50");
  // Purged in bounded batches, children before parents (foreign keys are on).
  expect(await store.trash.expire(1000 + 30 * day)).toBe(4);
  expect(
    await db.all("SELECT source, hash FROM import_seen ORDER BY source, hash"),
  ).toEqual([
    { source: "cstimer", hash: JSON.stringify(["session", "", "1"]) },
    { source: "cstimer", hash: "h1" },
    { source: "cstimer", hash: "h2" },
    {
      source: "timed",
      hash: JSON.stringify(["333", 10000, 0, 0, "R U", 50]),
    },
  ]);
  // The purged session's binding is retired; the CSV's, to a live session, stays.
  expect(await db.all("SELECT source, source_key FROM import_session")).toEqual(
    [{ source: "csv", source_key: "x" }],
  );

  // Neither file brings anything back, and no empty session appears.
  const before = await store.sessions.list();
  expect(await store.reviewImport(plan)).toMatchObject({
    added: 0,
    skipped: 2,
  });
  expect(await store.importBatch(plan)).toMatchObject({
    added: 0,
    skipped: 2,
    sessions: 0,
  });
  expect(await store.importBatch(exported)).toMatchObject({
    added: 0,
    skipped: 1,
    sessions: 0,
  });
  // Nor does a file never imported before that holds only purged solves.
  const fresh = {
    ...exported,
    source: "csv-other",
    sessions: [
      {
        ...(exported.sessions[0] as (typeof exported.sessions)[0]),
        sourceKey: "y",
      },
    ],
  };
  expect(await store.reviewImport(fresh)).toMatchObject({
    added: 0,
    sessions: [{ target: null, create: false }],
  });
  expect(await store.importBatch(fresh)).toMatchObject({
    added: 0,
    skipped: 1,
    sessions: 0,
    sessionIds: [null],
  });
  expect(await store.sessions.list()).toEqual(before);
  expect(await db.all("SELECT count(*) AS n FROM solve")).toEqual([{ n: 0 }]);
});

test("moving preserves all fields and rejects a mixed-event destination", async () => {
  const b = (await store.sessions.create({ name: "B", event: "333" })).id;
  const two = (await store.sessions.create({ name: "Two", event: "222" })).id;
  const imported = (row: Solve): ImportedSolve => ({
    ...row,
    importSource: "cstimer",
    importHash: `h${row.id}`,
  });
  await store.solves.addImported(
    [
      solve("a", 1),
      solve("b", 2, { plus2: 1, comment: "old", inspectionMs: 15800 }),
      solve("c", 2),
      solve("d", 3, { dnf: true, scramble: "F2 R'" }),
    ].map(imported),
  );
  const raw = async (id: string) =>
    (
      await db.all(
        `SELECT id, session_id, event, time_ms, plus2, dnf, scramble, started_at,
          inspection_ms, comment, input, import_source, import_hash, deleted_at
          FROM solve WHERE id = ?`,
        [id],
      )
    )[0];
  const before = { b: await raw("b"), d: await raw("d") };
  const reason = (promise: Promise<unknown>) =>
    promise.then(
      () => "moved",
      (error: unknown) => (error instanceof MoveError ? error.reason : error),
    );

  // A range by its two ends, either way round; a deleted solve in it is left out.
  const at = (id: string, startedAt: number) => ({ id, startedAt });
  expect(await store.solves.ids(sessionId, at("d", 3), at("b", 2))).toEqual([
    "b",
    "c",
    "d",
  ]);
  await store.solves.remove("c");
  expect(await store.solves.ids(sessionId, at("a", 1), at("d", 3))).toEqual([
    "a",
    "b",
    "d",
  ]);
  await store.solves.restore("c");

  // A 2×2 session takes no 3×3 solve: the whole batch stays.
  expect(await reason(store.solves.move(["b", "d"], two))).toBe("event");
  // A deleted or unknown solve fails the batch too.
  await store.solves.remove("c");
  expect(await reason(store.solves.move(["b", "c"], b))).toBe("missing");
  expect(await reason(store.solves.move(["b", "zz"], b))).toBe("missing");
  await store.solves.restore("c");
  expect(await store.solves.count(sessionId)).toBe(4);
  expect(await store.solves.count(b)).toBe(0);
  expect(await store.solves.count(two)).toBe(0);

  // The shown b and the selected d move; a repeated ID moves once.
  const moved = await store.solves.move(["b", "d", "b"], b);
  expect(moved).toEqual([
    { id: "b", from: sessionId },
    { id: "d", from: sessionId },
  ]);
  expect(await store.solves.count(sessionId)).toBe(2);
  expect(await store.solves.count(b)).toBe(2);
  expect(await raw("b")).toEqual({ ...before.b, session_id: b });
  expect(await raw("d")).toEqual({ ...before.d, session_id: b });
  expect(
    (await store.solves.page(b, { limit: 10 })).map((row) => row.id),
  ).toEqual(["d", "b"]);
  expect((await store.solves.series(sessionId)).startedAt).toEqual(
    new Float64Array([1, 2]),
  );
  // Already there: nothing to do.
  expect(await store.solves.move(["b"], b)).toEqual([]);
  expect(await store.solves.move([], two)).toEqual([]);

  // A repeat import finds them where they went.
  expect(
    await store.solves.addImported(
      [solve("b", 2), solve("d", 3)].map(imported),
    ),
  ).toEqual({ added: 0, skipped: 2 });

  // Undo is the move back by ID; a comment edited meanwhile stays.
  await store.solves.setComment("b", "new");
  expect(
    await store.solves.move(
      moved.map((entry) => entry.id),
      sessionId,
    ),
  ).toEqual([
    { id: "b", from: b },
    { id: "d", from: b },
  ]);
  expect(await raw("b")).toEqual({ ...before.b, comment: "new" });
  expect(await store.solves.count(b)).toBe(0);

  // A destination in the trash takes nothing.
  await store.sessions.remove(b);
  expect(await reason(store.solves.move(["a"], b))).toBe("destination");
  expect(await store.solves.count(sessionId)).toBe(4);
});

test("a solve that changes between the checks and the write fails the whole move", async () => {
  const b = (await store.sessions.create({ name: "B", event: "333" })).id;
  await store.solves.add(solve("1", 1));
  await store.solves.add(solve("2", 2));
  // Another connection deletes solve 2 just before the move's transaction.
  let interfere = true;
  const racing: Db = {
    ...db,
    async batch(statements) {
      if (interfere) {
        interfere = false;
        await db.batch([
          { sql: "UPDATE solve SET deleted_at = 5 WHERE id = '2'" },
        ]);
      }
      return db.batch(statements);
    },
  };
  const raced = createStore(racing, () => clock++);
  await expect(raced.solves.move(["1", "2"], b)).rejects.toMatchObject({
    reason: "changed",
  });
  expect(await store.solves.count(b)).toBe(0);
  expect((await store.solves.get("1"))?.sessionId).toBe(sessionId);
});

test("merge can be undone after a new destination solve", async () => {
  const a = sessionId;
  const b = (await store.sessions.create({ name: "B", event: "333" })).id;
  const c = (await store.sessions.create({ name: "C", event: "333" })).id;
  const two = (await store.sessions.create({ name: "Two", event: "222" })).id;
  await store.solves.add(solve("1"));
  await store.solves.add({ ...solve("2"), sessionId: b });
  await store.solves.add({ ...solve("3"), sessionId: c });
  // A hidden solve goes with its session and comes back with it.
  await store.solves.add({ ...solve("4"), sessionId: c });
  await store.solves.remove("4");
  // C sat in a folder alone: the folder hides with it and comes back with it.
  const folder = await store.folders.create("Old", [c]);
  // A file imported into A keeps finding its solves after the merge, and A after undo.
  await db.batch([
    {
      sql: `INSERT INTO import_session (source, source_scope, source_key, session_id, source_meta, updated_at)
        VALUES ('cstimer', '', 'session1', ?, '{}', 1)`,
      params: [a],
    },
  ]);
  const members = async (id: string) =>
    (await store.solves.page(id, { limit: 10 })).map((row) => row.id).reverse();
  const reason = (promise: Promise<unknown>) =>
    promise.then(
      () => "merged",
      (error: unknown) => (error instanceof MergeError ? error.reason : error),
    );

  // Nothing merges across puzzles, into one of its sources, or from a missing session.
  expect(await reason(store.sessions.merge([a, two], b))).toBe("event");
  expect(await reason(store.sessions.merge([a, b], b))).toBe("target");
  expect(await reason(store.sessions.merge([a, "zz"], b))).toBe("missing");
  expect(await members(a)).toEqual(["1"]);
  expect(await members(b)).toEqual(["2"]);
  expect(await members(c)).toEqual(["3"]);

  const receipt = await store.sessions.merge([a, c, a], b);
  expect(receipt.sources).toEqual([a, c]);
  expect(receipt.moved).toHaveLength(3);
  expect(await members(b)).toEqual(["1", "2", "3"]);
  expect((await store.sessions.list()).map(({ id }) => id)).toEqual([b, two]);
  expect((await store.folders.list()).map(({ id }) => id)).toEqual([]);
  // The absorbed sessions are not something the person put in the trash.
  expect(await store.trash.list(clock)).toEqual([
    expect.objectContaining({
      kind: "solve",
      solve: expect.objectContaining({ id: "4" }),
    }),
  ]);
  expect(
    await db.all(
      "SELECT session_id FROM import_session WHERE source_key = 'session1'",
    ),
  ).toEqual([{ session_id: b }]);

  await store.solves.add({ ...solve("5"), sessionId: b });
  await store.sessions.undoMerge(receipt);
  expect(await members(a)).toEqual(["1"]);
  expect(await members(c)).toEqual(["3"]);
  expect(await members(b)).toEqual(["2", "5"]);
  expect(
    await db.all(
      "SELECT session_id, deleted_at > 0 AS hidden FROM solve WHERE id = '4'",
    ),
  ).toEqual([{ session_id: c, hidden: 1 }]);
  expect((await store.sessions.list()).map(({ id }) => id).sort()).toEqual(
    [a, b, c, two].sort(),
  );
  expect((await store.folders.list()).map(({ id }) => id)).toEqual([folder.id]);
  expect(
    await db.all(
      "SELECT session_id FROM import_session WHERE source_key = 'session1'",
    ),
  ).toEqual([{ session_id: a }]);
  // A receipt is used once.
  expect(await reason(store.sessions.undoMerge(receipt))).toBe("gone");
});

test("a solve added to a source between the checks and the write fails the whole merge", async () => {
  const b = (await store.sessions.create({ name: "B", event: "333" })).id;
  await store.solves.add(solve("1"));
  let interfere = true;
  const racing: Db = {
    ...db,
    async batch(statements) {
      if (interfere) {
        interfere = false;
        await db.batch([
          {
            sql: `INSERT INTO solve (id, session_id, event, time_ms, scramble, started_at, input, updated_at)
              VALUES ('2', ?, '333', 9000, 'R', 2, 'keyboard', 2)`,
            params: [sessionId],
          },
        ]);
      }
      return db.batch(statements);
    },
  };
  const raced = createStore(racing, () => clock++);
  await expect(raced.sessions.merge([sessionId], b)).rejects.toMatchObject({
    reason: "changed",
  });
  expect(await store.solves.count(sessionId)).toBe(2);
  expect(await store.solves.count(b)).toBe(0);
  expect((await store.sessions.list()).map(({ id }) => id)).toContain(
    sessionId,
  );
});

test("split before the selected tied solve", async () => {
  const settingKey = (id: string) => `settings.session.${id}`;
  const two = (await store.sessions.create({ name: "Two", event: "222" })).id;
  const folder = await store.folders.create("Main", [sessionId, two]);
  await store.settings.set(settingKey(sessionId), '{"inspection":false}');
  await store.solves.add(solve("a", 1000));
  await store.solves.add(solve("b", 1000));
  await store.solves.add(solve("c", 2000));
  // A hidden earlier solve goes with its neighbours, so a later restore finds them.
  await store.solves.add(solve("h", 500));
  await store.solves.remove("h");
  const members = async (id: string) =>
    (await store.solves.page(id, { limit: 10 })).map((row) => row.id).reverse();
  const reason = (promise: Promise<unknown>) =>
    promise.then(
      () => "split",
      (error: unknown) => (error instanceof SplitError ? error.reason : error),
    );

  // Nothing comes before the first live solve, and a solve of another session is no pivot.
  expect(await reason(store.sessions.splitBefore(sessionId, "a", "Old"))).toBe(
    "first",
  );
  expect(await reason(store.sessions.splitBefore(two, "b", "Old"))).toBe(
    "missing",
  );

  const receipt = await store.sessions.splitBefore(sessionId, "b", "Old", {
    settingKey,
  });
  expect(receipt.from).toBe(sessionId);
  expect([...receipt.moved].sort()).toEqual(["a", "h"]);
  expect(await members(receipt.sessionId)).toEqual(["a"]);
  expect(await members(sessionId)).toEqual(["b", "c"]);
  expect(await db.all("SELECT session_id FROM solve WHERE id = 'h'")).toEqual([
    { session_id: receipt.sessionId },
  ]);
  // The earlier part stands just before the session it came from, in its folder.
  const listed = await store.sessions.list();
  const made = listed.find(({ id }) => id === receipt.sessionId);
  expect(made).toMatchObject({
    name: "Old",
    event: "333",
    folderId: folder.id,
  });
  expect(listed.map(({ id }) => id)).toEqual([
    receipt.sessionId,
    sessionId,
    two,
  ]);
  // Its settings are a copy: changing one leaves the other.
  expect(await store.settings.get(settingKey(receipt.sessionId))).toBe(
    '{"inspection":false}',
  );
  await store.settings.set(settingKey(sessionId), '{"inspection":true}');
  expect(await store.settings.get(settingKey(receipt.sessionId))).toBe(
    '{"inspection":false}',
  );

  await store.sessions.undoSplit(receipt);
  expect(await members(sessionId)).toEqual(["a", "b", "c"]);
  expect(await db.all("SELECT session_id FROM solve WHERE id = 'h'")).toEqual([
    { session_id: sessionId },
  ]);
  expect((await store.sessions.list()).map(({ id }) => id)).toEqual([
    sessionId,
    two,
  ]);
  expect(await store.settings.get(settingKey(receipt.sessionId))).toBeNull();
  expect(await reason(store.sessions.undoSplit(receipt))).toBe("gone");

  // A solve timed into the earlier part since stays there, and so does the part.
  const again = await store.sessions.splitBefore(sessionId, "c", "Old");
  await store.solves.add({ ...solve("d", 3000), sessionId: again.sessionId });
  await store.sessions.undoSplit(again);
  expect(await members(sessionId)).toEqual(["a", "b", "c"]);
  expect(await members(again.sessionId)).toEqual(["d"]);
});

test("a split that fails after the checks leaves no session and moves nothing", async () => {
  await store.solves.add(solve("1", 1));
  await store.solves.add(solve("2", 2));
  await store.solves.add(solve("3", 3));
  // Another connection deletes solve 1 for good just before the split's transaction.
  let interfere = true;
  const racing: Db = {
    ...db,
    async batch(statements) {
      if (interfere) {
        interfere = false;
        await db.batch([{ sql: "DELETE FROM solve WHERE id = '1'" }]);
      }
      return db.batch(statements);
    },
  };
  const raced = createStore(racing, () => clock++);
  await expect(
    raced.sessions.splitBefore(sessionId, "3", "Old"),
  ).rejects.toMatchObject({ reason: "changed" });
  expect((await store.sessions.list()).map(({ id }) => id)).toEqual([
    sessionId,
  ]);
  expect(await store.solves.count(sessionId)).toBe(2);
});

test("settings upsert leaves one row and missing keys are null", async () => {
  expect(await store.settings.get("theme")).toBeNull();
  await store.settings.set("theme", "light");
  expect(await store.settings.get("theme")).toBe("light");
  await store.settings.set("theme", "dark");
  expect(await store.settings.get("theme")).toBe("dark");
  expect(await db.all("SELECT count(*) AS n FROM setting")).toEqual([{ n: 1 }]);
});

test("columns preserve duplicate selected names and reject nonnumeric values", async () => {
  expect(await db.columns("SELECT 1, 2 UNION ALL SELECT 3, 4")).toEqual([
    new Float64Array([1, 3]),
    new Float64Array([2, 4]),
  ]);
  expect(await db.columns("SELECT 1, 2 WHERE 0")).toEqual([
    new Float64Array(),
    new Float64Array(),
  ]);
  await expect(db.columns("SELECT 'text'")).rejects.toThrow();
  await expect(db.columns("SELECT NULL")).rejects.toThrow();
});

test("import skipped counts duplicate import identities, not unrelated id conflicts", async () => {
  await store.solves.add(solve("existing", 1));
  expect(
    await store.solves.addImported([
      {
        ...solve("existing", 1),
        importSource: "synthetic",
        importHash: "different",
      },
    ]),
  ).toEqual({ added: 0, skipped: 0 });
  expect(await store.solves.addImported([])).toEqual({ added: 0, skipped: 0 });
});

test("duplicate import identities within a chunk are counted once as added", async () => {
  const imported = {
    ...solve("first", 1),
    importSource: "synthetic",
    importHash: "same",
  };
  expect(
    await store.solves.addImported([imported, { ...imported, id: "second" }]),
  ).toEqual({ added: 1, skipped: 1 });
});

test("switch rows give every session its newest live solve in one read", async () => {
  await store.sessions.remove(sessionId);
  const a = await store.sessions.create({ name: "A", event: "333" });
  const b = await store.sessions.create({ name: "B", event: "333fm" });
  const empty = await store.sessions.create({ name: "Empty", event: "222" });
  const at = (id: string, session: string, startedAt: number, over = {}) =>
    store.solves.add({ ...solve(id, startedAt), sessionId: session, ...over });
  await at("a1", a.id, 10);
  await at("a2", a.id, 30, { dnf: true });
  await at("a3", a.id, 40);
  await store.solves.remove("a3");
  await at("b1", b.id, 20, { event: "333fm", timeMs: 0, moves: 27 });
  const reads: string[] = [];
  const traced = createStore({
    ...db,
    all: (sql, params) => {
      reads.push(sql);
      return db.all(sql, params);
    },
  });
  const rows = await traced.sessions.switchRows();
  expect(reads).toHaveLength(1);
  expect(rows.map(({ name, last }) => [name, last?.id ?? null])).toEqual([
    ["A", "a2"],
    ["B", "b1"],
    ["Empty", null],
  ]);
  expect(rows[0]?.last).toMatchObject({ dnf: true, sessionId: a.id });
  expect(rows[1]?.last).toMatchObject({ moves: 27, timeMs: 0 });
  expect(rows[2]).toMatchObject({ id: empty.id, archived: false, last: null });
});

test("folders group, place, rename and collapse in one order with root sessions and survive reopening", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cubehaus-folders-"));
  let fileDb: Db | undefined;
  try {
    const path = join(dir, "test.sqlite");
    fileDb = createNodeDb(path);
    await migrate(fileDb);
    let fileStore = createStore(fileDb);
    const A = await fileStore.sessions.create({ name: "A", event: "333" });
    const B = await fileStore.sessions.create({ name: "B", event: "222" });
    const C = await fileStore.sessions.create({ name: "C", event: "444" });
    const root = async () => {
      const [folders, sessions] = await Promise.all([
        fileStore.folders.list(),
        fileStore.sessions.list(),
      ]);
      return [
        ...folders.map((f) => ({ key: f.orderKey, name: `[${f.name}]` })),
        ...sessions
          .filter((s) => s.folderId === null)
          .map((s) => ({ key: s.orderKey, name: s.name })),
      ]
        .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0))
        .map(({ name }) => name);
    };
    const inside = async (folderId: string) =>
      (await fileStore.sessions.list())
        .filter((s) => s.folderId === folderId)
        .map((s) => s.name);

    // Dropping A on B makes a folder where B stood, holding B then A.
    const F = await fileStore.folders.create("Folder", [B.id, A.id]);
    expect(F).toMatchObject({ name: "Folder", collapsed: false });
    expect(await root()).toEqual(["[Folder]", "C"]);
    expect(await inside(F.id)).toEqual(["B", "A"]);

    // A goes back to the top level before C, then to the end.
    await fileStore.folders.place({ kind: "session", id: A.id }, null, C.id);
    expect(await root()).toEqual(["[Folder]", "A", "C"]);
    await fileStore.folders.place({ kind: "session", id: A.id }, null, null);
    expect(await root()).toEqual(["[Folder]", "C", "A"]);
    // The folder moves among top-level sessions; a session joins it before B.
    await fileStore.folders.place({ kind: "folder", id: F.id }, null, null);
    expect(await root()).toEqual(["C", "A", "[Folder]"]);
    await fileStore.folders.place({ kind: "session", id: C.id }, F.id, B.id);
    expect(await inside(F.id)).toEqual(["C", "B"]);
    expect(await root()).toEqual(["A", "[Folder]"]);

    // Invalid places are refused before anything is written.
    const before = await fileDb.all("SELECT * FROM session ORDER BY id");
    const G = await fileStore.folders.create("Other", [A.id]);
    await expect(
      fileStore.folders.place({ kind: "folder", id: F.id }, F.id, null),
    ).rejects.toThrow(RangeError);
    await expect(
      fileStore.folders.place({ kind: "folder", id: F.id }, G.id, null),
    ).rejects.toThrow(RangeError);
    // `before` must sit where the item goes.
    await expect(
      fileStore.folders.place({ kind: "session", id: A.id }, null, B.id),
    ).rejects.toThrow(RangeError);
    await expect(
      fileStore.folders.place({ kind: "session", id: A.id }, "missing", null),
    ).rejects.toThrow(RangeError);
    await fileStore.folders.place({ kind: "session", id: A.id }, null, null);
    // The folder its last session left goes with it.
    expect((await fileStore.folders.list()).map(({ name }) => name)).toEqual([
      "Folder",
    ]);
    expect(
      (await fileDb.all("SELECT id, folder_id FROM session ORDER BY id")).map(
        (row) => row,
      ),
    ).toEqual(
      (before as { id: string; folder_id: string | null }[]).map(
        ({ id, folder_id }) => ({ id, folder_id }),
      ),
    );

    // A new session lands at the end of the top level, after the folder.
    await fileStore.sessions.create({ name: "D", event: "333" });
    expect((await root()).slice(-1)).toEqual(["D"]);

    await fileStore.folders.rename(F.id, "Cubes");
    await fileStore.folders.collapse(F.id, true);
    const layout = await root();
    await fileDb.close();
    fileDb = createNodeDb(path);
    fileStore = createStore(fileDb);
    expect(await root()).toEqual(
      layout.map((name) => (name === "[Folder]" ? "[Cubes]" : name)),
    );
    expect(
      (await fileStore.folders.list()).find(({ id }) => id === F.id),
    ).toMatchObject({ name: "Cubes", collapsed: true });
    expect(await inside(F.id)).toEqual(["C", "B"]);
  } finally {
    if (fileDb) await fileDb.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a layout put back restores parents, keys and folders exactly", async () => {
  const B = await store.sessions.create({ name: "B", event: "222" });
  const sessions = await store.sessions.list();
  const layout = {
    sessions: sessions.map(({ id, folderId, orderKey }) => ({
      id,
      folderId,
      orderKey,
    })),
    folders: [],
  };
  const F = await store.folders.create("F", [B.id, sessionId]);
  await store.folders.restoreLayout({
    ...layout,
    folders: [
      { id: F.id, orderKey: F.orderKey, collapsed: false, deleted: true },
    ],
  });
  expect(await store.folders.list()).toEqual([]);
  expect(
    (await store.sessions.list()).map(({ id, folderId, orderKey }) => ({
      id,
      folderId,
      orderKey,
    })),
  ).toEqual(layout.sessions);
});

test("repeats stay out of the series and follow their root", async () => {
  await store.solves.add(
    solve("1", 1000, { timeMs: 10000, scramble: "R U F" }),
  );
  await store.solves.add(
    solve("r1", 5000, { timeMs: 8000, scramble: "ignored", repeatOf: "1" }),
  );
  await store.solves.add(
    solve("r2", 4000, { timeMs: 7500, scramble: "ignored", repeatOf: "1" }),
  );
  // A journal replay writes the same attempt again.
  await store.solves.add(solve("r1", 5000, { timeMs: 8000, repeatOf: "1" }));
  await store.solves.add(solve("2", 2000, { timeMs: 12000 }));

  const series = await store.solves.series(sessionId);
  expect([...series.values]).toEqual([10000, 12000]);
  expect(await store.solves.count(sessionId)).toBe(2);
  expect(await store.solves.progressCounts()).toEqual({ [sessionId]: 2 });
  const page = await store.solves.page(sessionId, { limit: 10 });
  expect(page.map(({ id, repeats }) => [id, repeats])).toEqual([
    ["2", undefined],
    ["1", 2],
  ]);
  const attempts = async () =>
    (await store.repeats.list("1")).map(({ id, timeMs, repeatOf }) => [
      id,
      timeMs,
      repeatOf,
    ]);
  expect(await attempts()).toEqual([
    ["r2", 7500, "1"],
    ["r1", 8000, "1"],
  ]);
  const [first] = await store.repeats.list("1");
  expect(first).toMatchObject({ scramble: "R U F", sessionId, event: "333" });

  await store.repeats.setPenalty("r2", { plus2: 1, dnf: false });
  await store.repeats.setComment("r2", "lucky");
  expect((await store.repeats.list("1"))[0]).toMatchObject({
    plus2: 1,
    comment: "lucky",
  });
  await store.repeats.remove("r2");
  expect(await attempts()).toEqual([["r1", 8000, "1"]]);
  await store.repeats.restore("r2");
  expect((await attempts()).length).toBe(2);

  const other = await store.sessions.create({ name: "Other", event: "333" });
  await store.solves.move(["1"], other.id);
  expect(
    (await store.repeats.list("1")).map(({ sessionId: id }) => id),
  ).toEqual([other.id, other.id]);
  await store.solves.move(["1"], sessionId);
  const receipt = await store.sessions.splitBefore(sessionId, "2", "Before");
  expect((await store.repeats.list("1")).length).toBe(2);
  await store.sessions.undoSplit(receipt);
  await store.sessions.merge([other.id], sessionId);
  expect((await store.repeats.list("1")).length).toBe(2);

  await store.solves.remove("1");
  expect(await store.repeats.list("1")).toEqual([]);
  await store.solves.restore("1");
  expect((await store.repeats.list("1")).length).toBe(2);

  // Deleted for good with its root, after the trash's 30 days.
  await store.solves.remove("1");
  await store.repeats.remove("r1");
  await store.trash.expire(Date.now() + 31 * 86_400_000);
  expect(
    await db.all("SELECT id FROM solve_repeat WHERE solve_id = '1'"),
  ).toEqual([]);
});

test("a repeat of a missing solve or of another repeat is refused", async () => {
  await store.solves.add(solve("1", 1000));
  await store.solves.add(solve("r1", 2000, { repeatOf: "1" }));
  await expect(
    store.solves.add(solve("r2", 3000, { repeatOf: "r1" })),
  ).rejects.toThrow();
  await expect(
    store.solves.add(solve("r3", 3000, { repeatOf: "nothing" })),
  ).rejects.toThrow();
});

test("trainer attempts stay apart from solves and survive a backup", async () => {
  await store.solves.add(solve("1", 1000, { timeMs: 10000 }));
  await store.trainer.putCase({
    setId: "pll",
    caseId: "pll-T",
    card: '{"due":1}',
    dueAt: 9000,
  });
  await store.trainer.putCase({
    setId: "pll",
    caseId: "pll-Y",
    card: '{"due":2}',
    dueAt: 8000,
  });
  await store.trainer.addAttempt({
    id: "t1",
    setId: "pll",
    caseId: "pll-T",
    mode: "picture",
    auf: 2,
    scramble: null,
    recogMs: 640,
    execMs: 1830,
    missed: false,
    grade: "good",
    at: 3000,
  });
  await store.trainer.addAttempt({
    id: "t2",
    setId: "pll",
    caseId: "pll-Y",
    mode: "scramble",
    auf: 0,
    scramble: "R U R' U'",
    recogMs: null,
    execMs: 2400,
    missed: false,
    grade: "good",
    at: 4000,
  });
  // A split attempt: recognition marked by a press, execution from it to the stop.
  await store.trainer.addAttempt({
    id: "t3",
    setId: "pll",
    caseId: "pll-T",
    mode: "scramble",
    auf: 1,
    scramble: "R U R' U'",
    recogMs: 520,
    execMs: 1700,
    split: true,
    missed: false,
    grade: "good",
    at: 5000,
  });
  await store.trainer.markAttempt("t2", { missed: true, grade: "again" });
  // A saved schedule replaces the old one; a case taken out keeps its attempts.
  await store.trainer.putCase({
    setId: "pll",
    caseId: "pll-T",
    card: '{"due":3}',
    dueAt: 20000,
  });
  await store.trainer.removeCase("pll", "pll-Y");

  // Solves see none of it.
  expect([...(await store.solves.series(sessionId)).values]).toEqual([10000]);
  expect(await store.solves.count(sessionId)).toBe(1);
  expect(await store.solves.progressCounts()).toEqual({ [sessionId]: 1 });

  const cases = await store.trainer.cases("pll");
  expect(cases.map((c) => [c.caseId, c.card, c.dueAt])).toEqual([
    ["pll-T", '{"due":3}', 20000],
  ]);
  const attempts = await store.trainer.attempts("pll");
  expect(
    attempts.map((a) => [
      a.id,
      a.recogMs,
      a.execMs,
      a.split,
      a.missed,
      a.grade,
    ]),
  ).toEqual([
    ["t1", 640, 1830, false, false, "good"],
    ["t2", null, 2400, false, true, "again"],
    ["t3", 520, 1700, true, false, "good"],
  ]);
  expect(await store.trainer.attempts("oll")).toEqual([]);

  // The backup carries both tables, and a restore into a fresh file gives them back.
  const { snapshot, restore } = await import("./backup");
  const backup = await snapshot(db);
  const other = createNodeDb(":memory:");
  await migrate(other);
  await restore(other, backup);
  const back = createStore(other);
  expect((await back.trainer.cases("pll")).map((c) => c.caseId)).toEqual([
    "pll-T",
  ]);
  expect(await back.trainer.attempts("pll")).toEqual(attempts);
  // Taken out stays taken out after the restore; putting it back keeps its attempts.
  await back.trainer.putCase({
    setId: "pll",
    caseId: "pll-Y",
    card: "{}",
    dueAt: 1,
  });
  expect((await back.trainer.cases("pll")).map((c) => c.caseId)).toEqual([
    "pll-T",
    "pll-Y",
  ]);
  await other.close();
});

test("a case taken out and put back keeps its schedule", async () => {
  const db = createNodeDb(":memory:");
  await migrate(db);
  const store = createStore(db);
  await store.trainer.putCase({
    setId: "pll",
    caseId: "pll-T",
    card: '{"reps":4}',
    dueAt: 500,
  });
  await store.trainer.removeCase("pll", "pll-T");
  expect(await store.trainer.cases("pll")).toEqual([]);
  expect(await store.trainer.restoreCase("pll", "pll-T")).toBe(true);
  const [back] = await store.trainer.cases("pll");
  expect(back).toMatchObject({
    caseId: "pll-T",
    card: '{"reps":4}',
    dueAt: 500,
  });
  // A case never added, or one in already, has nothing to bring back.
  expect(await store.trainer.restoreCase("pll", "pll-Y")).toBe(false);
  expect(await store.trainer.restoreCase("pll", "pll-T")).toBe(false);
  await db.close();
});

test("a solve keeps its cross colour; one without reads with none", async () => {
  await store.solves.add(solve("1", 1, { crossColour: "yellow" }));
  await store.solves.add(solve("2", 2));
  expect(await store.solves.get("1")).toMatchObject({ crossColour: "yellow" });
  expect(await store.solves.get("2")).not.toHaveProperty("crossColour");
  const page = await store.solves.page(sessionId, { limit: 10 });
  expect(page.map((s) => s.crossColour ?? null)).toEqual([null, "yellow"]);
});

test("colour series: the scope's solves with a cross colour, oldest first, DNF infinite", async () => {
  await store.solves.add(solve("1", 1, { crossColour: "white" }));
  await store.solves.add(solve("2", 2));
  await store.solves.add(
    solve("3", 3, { crossColour: "yellow", plus2: 1, timeMs: 12000 }),
  );
  await store.solves.add(solve("4", 4, { crossColour: "yellow", dnf: true }));
  await store.solves.add(solve("5", 5, { crossColour: "white" }));
  await store.solves.remove("5");
  const other = await store.sessions.create({ name: "B", event: "333" });
  await store.solves.add({
    ...solve("6", 6, { crossColour: "green" }),
    sessionId: other.id,
  });
  const series = await store.solves.colourSeries({
    kind: "session",
    id: sessionId,
    event: "333",
  });
  expect(series.colours).toEqual(["white", "yellow", "yellow"]);
  expect([...series.values]).toEqual([10000, 14000, Infinity]);
  expect([...series.startedAt]).toEqual([1, 3, 4]);
  const both = await store.solves.colourSeries({
    kind: "selection",
    ids: [sessionId, other.id],
    event: "333",
  });
  expect(both.colours).toEqual(["white", "yellow", "yellow", "green"]);
});

test("batching trainer membership matches individual writes and rolls back on failure", async () => {
  const other = createNodeDb(":memory:");
  await migrate(other);
  const single = createStore(other, () => clock);
  const batch = createStore(db, () => clock);
  const setId = "pll";
  const seed = (caseId: string, card: string, dueAt: number) => ({
    caseId,
    card,
    dueAt,
  });
  const rows = (from: Db) =>
    from.all("SELECT * FROM trainer_case ORDER BY set_id, case_id");
  try {
    for (const { trainer } of [single, batch]) {
      await trainer.putCase({ setId, ...seed("pll-T", "active", 500) });
      await trainer.putCase({ setId, ...seed("pll-Y", "scheduled", 900) });
      await trainer.removeCase(setId, "pll-Y");
    }
    clock += 100;
    const added = [
      seed("pll-T", "unused", clock),
      seed("pll-Y", "unused", clock),
      seed("pll-Ua", "fresh", clock),
    ];
    const active = new Set(
      (await single.trainer.cases(setId)).map((r) => r.caseId),
    );
    for (const entry of added) {
      if (active.has(entry.caseId)) continue;
      if (!(await single.trainer.restoreCase(setId, entry.caseId)))
        await single.trainer.putCase({ setId, ...entry });
    }
    await batch.trainer.setCaseMembership(setId, added, []);
    expect(await rows(db)).toEqual(await rows(other));

    clock += 100;
    for (const { caseId } of added)
      await single.trainer.removeCase(setId, caseId);
    await batch.trainer.setCaseMembership(
      setId,
      [],
      added.map((r) => r.caseId),
    );
    expect(await rows(db)).toEqual(await rows(other));

    await db.batch([
      {
        sql: `CREATE TRIGGER reject_case BEFORE INSERT ON trainer_case
        WHEN NEW.case_id = 'rejected' BEGIN SELECT RAISE(ABORT, 'test rejection'); END`,
      },
    ]);
    const before = await rows(db);
    await expect(
      batch.trainer.setCaseMembership(
        setId,
        [
          seed("pll-T", "unused", clock),
          seed("new", "fresh", clock),
          seed("rejected", "fresh", clock),
        ],
        [],
      ),
    ).rejects.toThrow("test rejection");
    expect(await rows(db)).toEqual(before);
  } finally {
    await other.close();
  }
});
