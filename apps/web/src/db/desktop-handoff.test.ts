import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Solve } from "@cubehaus/core";
import { createStore, type Db, migrate } from "@cubehaus/storage";
import { createNodeDb } from "@cubehaus/storage/node";
import { afterEach, expect, test } from "vitest";
import {
  HANDOFF_KEY,
  handoffDesktop,
  type LegacySnapshotSource,
  mergeLegacy,
  type NativeStore,
  readLegacyCopy,
} from "./desktop-handoff";
import { createPendingJournal, memoryStorage } from "./pending";

const dirs: string[] = [];
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "cubehaus-handoff-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const T = 1_700_000_000_000;

/** The webview's database as version 0.0.5 left it: schema 2, written by hand. */
async function seedLegacyV2(path: string) {
  const db = createNodeDb(path);
  await migrate(db, 2);
  const solve = (id: string, time: number, at: number) => ({
    sql: `INSERT INTO solve (id, session_id, event, time_ms, plus2, dnf, scramble, started_at,
      inspection_ms, comment, input, updated_at) VALUES (?, 'A', '333', ?, 0, 0, 'R U', ?, NULL, NULL, 'keyboard', ?)`,
    params: [id, time, at, at],
  });
  await db.batch([
    {
      sql: "INSERT INTO session (id, name, event, order_key, archived, created_at, updated_at) VALUES ('A', 'Main', '333', 'a0', 0, ?, ?)",
      params: [T, T],
    },
    {
      sql: "INSERT INTO session (id, name, event, order_key, archived, created_at, updated_at) VALUES ('B', 'Old', '222', 'a1', 1, ?, ?)",
      params: [T, T],
    },
    solve("a", 12_345, T + 1000),
    solve("b", 9_870, T + 2000),
    {
      sql: "INSERT INTO setting (key, value, updated_at) VALUES ('session.current', 'A', ?), ('settings.inspection', '\"on\"', ?)",
      params: [T, T],
    },
  ]);
  await db.close();
}

const pendingC: Solve = {
  id: "c",
  sessionId: "A",
  event: "333",
  timeMs: 11_111,
  plus2: 0,
  dnf: false,
  scramble: "F2",
  startedAt: T + 3000,
  inspectionMs: null,
  comment: null,
  input: "keyboard",
};

/** The legacy file, read the way the app does: a copy, migrated, never the original. */
function fileSource(path: string, dir: string): LegacySnapshotSource {
  return {
    async read() {
      const copy = join(dir, `copy-${Math.random().toString(36).slice(2)}`);
      copyFileSync(path, copy);
      const db = createNodeDb(copy);
      try {
        return await readLegacyCopy(db);
      } finally {
        await db.close();
        rmSync(copy, { force: true });
      }
    },
  };
}

async function openNative(dir: string): Promise<NativeStore & { db: Db }> {
  const db = createNodeDb(join(dir, "cubehaus.sqlite3"));
  await migrate(db);
  return { db, store: createStore(db) };
}

const ids = async (db: Db) =>
  (await db.all<{ id: string }>("SELECT id FROM solve ORDER BY id")).map(
    ({ id }) => id,
  );

test("legacy desktop migration can restart after native commit", async () => {
  const work = tempDir();
  const nativeDir = tempDir();
  const legacyPath = join(work, "legacy.sqlite3");
  await seedLegacyV2(legacyPath);
  const legacy = fileSource(legacyPath, work);
  const storage = memoryStorage();
  createPendingJournal(storage).add(pendingC);

  // The process dies after the native commit, before the journal entry is cleared.
  const first = await openNative(nativeDir);
  const real = createPendingJournal(storage);
  const dying = {
    ...real,
    confirm() {
      throw new Error("killed");
    },
  };
  await expect(handoffDesktop(legacy, first, dying)).rejects.toThrow("killed");
  await first.db.close();

  for (const _ of [1, 2]) {
    const native = await openNative(nativeDir);
    expect(
      await handoffDesktop(legacy, native, createPendingJournal(storage)),
    ).toBe("already");
    expect(await ids(native.db)).toEqual(["a", "b", "c"]);
    const sessions = await native.store.sessions.list();
    expect(sessions.map(({ id, archived }) => [id, archived])).toEqual([
      ["A", false],
      ["B", true],
    ]);
    expect(await native.store.settings.get("settings.inspection")).toBe('"on"');
    expect(await native.store.settings.get(HANDOFF_KEY)).not.toBeNull();
    await native.db.close();
  }
  expect(createPendingJournal(storage).all()).toEqual([]);
  // One file, and the webview's own database as it was.
  expect(readdirSync(nativeDir)).toEqual(["cubehaus.sqlite3"]);
  const old = createNodeDb(legacyPath);
  expect(await old.all("PRAGMA user_version")).toEqual([{ user_version: 2 }]);
  expect(await ids(old)).toEqual(["a", "b"]);
  await old.close();
});

test("a migration without a crash says migrated once, then already", async () => {
  const work = tempDir();
  const legacyPath = join(work, "legacy.sqlite3");
  await seedLegacyV2(legacyPath);
  const native = await openNative(tempDir());
  // The app made its first session before the handoff: still nothing of the person's.
  await native.store.sessions.create({ event: "333", name: "Session 1" });
  const kept: string[] = [];
  const journal = createPendingJournal(memoryStorage());
  expect(
    await handoffDesktop(
      fileSource(legacyPath, work),
      { ...native, keepSource: async (text) => void kept.push(text) },
      journal,
    ),
  ).toBe("migrated");
  expect(await ids(native.db)).toEqual(["a", "b"]);
  expect(JSON.parse(kept[0] ?? "{}").tables.solve).toHaveLength(2);
  expect(
    await handoffDesktop(fileSource(legacyPath, work), native, journal),
  ).toBe("already");
  await native.db.close();
});

test("an independently filled file is never overwritten", async () => {
  const work = tempDir();
  const legacyPath = join(work, "legacy.sqlite3");
  await seedLegacyV2(legacyPath);
  const native = await openNative(tempDir());
  const session = await native.store.sessions.create({
    event: "333",
    name: "Desk",
  });
  await native.store.solves.add({
    ...pendingC,
    id: "a",
    sessionId: session.id,
    timeMs: 7_000,
    startedAt: T + 9000,
  });
  const legacy = fileSource(legacyPath, work);
  const journal = createPendingJournal(memoryStorage());
  expect(await handoffDesktop(legacy, native, journal)).toBe("needs-recovery");
  expect(await native.db.all("SELECT id, time_ms FROM solve")).toEqual([
    { id: "a", time_ms: 7_000 },
  ]);
  expect(await native.store.settings.get(HANDOFF_KEY)).toBeNull();
  // Asked again on the next start, until the person adds the earlier history.
  expect(await handoffDesktop(legacy, native, journal)).toBe("needs-recovery");
  expect(await mergeLegacy(legacy, native)).toBe(true);
  expect(
    await native.db.all("SELECT id, time_ms FROM solve ORDER BY id"),
  ).toEqual([
    { id: "a", time_ms: 7_000 },
    { id: "b", time_ms: 9_870 },
  ]);
  expect(await handoffDesktop(legacy, native, journal)).toBe("already");
  await native.db.close();
});

test("no earlier history, an empty one and an unreadable one", async () => {
  const journal = createPendingJournal(memoryStorage());
  const absent = await openNative(tempDir());
  expect(
    await handoffDesktop(
      { read: async () => ({ kind: "absent" }) },
      absent,
      journal,
    ),
  ).toBe("new");
  expect(
    await handoffDesktop(
      { read: async () => ({ kind: "failed", reason: "x" }) },
      absent,
      journal,
    ),
  ).toBe("already");
  await absent.db.close();

  const work = tempDir();
  const emptyPath = join(work, "empty.sqlite3");
  const empty = createNodeDb(emptyPath);
  await migrate(empty, 2);
  await empty.close();
  expect(await fileSource(emptyPath, work).read()).toEqual({ kind: "empty" });

  const failing = await openNative(tempDir());
  expect(
    await handoffDesktop(
      { read: async () => ({ kind: "failed", reason: "denied" }) },
      failing,
      journal,
    ),
  ).toBe("needs-recovery");
  expect(await failing.store.settings.get(HANDOFF_KEY)).toBeNull();
  await failing.db.close();
});
