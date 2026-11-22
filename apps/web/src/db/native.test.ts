import { createStore, migrate } from "@cubehaus/storage";
import { createNodeDb } from "@cubehaus/storage/node";
import { expect, test } from "vitest";
import {
  backupDue,
  createNativeBackups,
  createNativeDb,
  decodeColumns,
  inDesktopApp,
  LAST_CHANGE_SQL,
} from "./native";

/** The Rust commands' contract, played by Node's SQLite: rows tagged, columns binary. */
function fakeBridge() {
  const db = createNodeDb(":memory:");
  const calls: string[] = [];
  const tag = (value: unknown) =>
    typeof value === "number" && !Number.isFinite(value)
      ? { $float: value > 0 ? "Infinity" : "-Infinity" }
      : value;
  const invoke = async (
    command: string,
    args: Record<string, unknown> = {},
  ) => {
    calls.push(command);
    const { sql, params, statements } = args as {
      sql: string;
      params: never[];
      statements: never[];
    };
    if (command === "db_open") return "/data/cubehaus.sqlite3";
    if (command === "db_all")
      return (await db.all(sql, params)).map((row) =>
        Object.fromEntries(Object.entries(row).map(([k, v]) => [k, tag(v)])),
      );
    if (command === "db_columns") {
      const columns = await db.columns(sql, params);
      const length = columns[0]?.length ?? 0;
      const out = new DataView(
        new ArrayBuffer(8 + columns.length * length * 8),
      );
      out.setUint32(0, columns.length, true);
      out.setUint32(4, length, true);
      for (const [c, column] of columns.entries())
        for (const [r, value] of column.entries())
          out.setFloat64(8 + (c * length + r) * 8, value, true);
      return out.buffer;
    }
    if (command === "db_batch") return db.batch(statements);
    if (command === "db_close") return db.close();
    throw new Error(command);
  };
  return { invoke, calls };
}

test("the native adapter runs the shared migrations and keeps a DNF as Infinity", async () => {
  const { invoke, calls } = fakeBridge();
  const native = createNativeDb(invoke);
  expect(await native.open()).toBe("/data/cubehaus.sqlite3");
  await migrate(native);
  const store = createStore(native);
  const session = await store.sessions.create({ event: "333", name: "A" });
  expect((await store.sessions.list()).map((s) => s.id)).toEqual([session.id]);
  expect(await native.all("SELECT 1e999 AS dnf")).toEqual([{ dnf: Infinity }]);
  const [values] = await native.columns(
    "SELECT CASE WHEN ? = 1 THEN 1e999 ELSE 12345 END",
    [1],
  );
  expect(Array.from(values ?? [])).toEqual([Infinity]);
  await expect(native.all("SELECT ?", [Infinity])).rejects.toThrow(TypeError);
  await native.close();
  expect(calls).toContain("db_batch");
  expect(() => decodeColumns(new ArrayBuffer(4))).toThrow(TypeError);
  // The plain web is never the desktop app.
  expect(inDesktopApp()).toBe(false);
});

test("an automatic copy is due once a day, and only after a change", async () => {
  const noon = new Date(2026, 10, 22, 12).getTime();
  const hour = 3_600_000;
  expect(backupDue(null, null, noon)).toBe(false);
  expect(backupDue(null, noon - hour, noon)).toBe(true);
  // Already copied today.
  expect(backupDue(noon - hour, noon - 1000, noon)).toBe(false);
  // Yesterday's copy, a change since: due; no change since: not.
  expect(backupDue(noon - 24 * hour, noon - hour, noon)).toBe(true);
  expect(backupDue(noon - 24 * hour, noon - 25 * hour, noon)).toBe(false);

  // The last change leaves out the open session's bookkeeping.
  const db = createNodeDb(":memory:");
  await migrate(db);
  const store = createStore(db);
  expect((await db.all<{ m: number | null }>(LAST_CHANGE_SQL))[0]?.m).toBe(
    null,
  );
  await store.settings.set("session.current", "x");
  expect((await db.all<{ m: number | null }>(LAST_CHANGE_SQL))[0]?.m).toBe(
    null,
  );
  await store.sessions.create({ event: "333", name: "A" });
  expect(
    (await db.all<{ m: number | null }>(LAST_CHANGE_SQL))[0]?.m,
  ).toBeGreaterThan(0);

  // A failed copy is remembered until one succeeds.
  let fail = true;
  const calls: [string, unknown][] = [];
  const backups = createNativeBackups(
    async (command, args) => {
      calls.push([command, args]);
      if (command === "backup_now") {
        if (fail) throw new Error("No space left on device");
        return {
          id: "20261122T120000Z-0a1b2c",
          createdAt: noon,
          bytes: 4096,
          status: "complete",
        };
      }
      if (command === "choose_backup_directory") return null;
      return undefined;
    },
    async () => null,
  );
  await expect(backups.now()).rejects.toThrow("No space");
  expect(backups.lastError).toBe("No space left on device");
  fail = false;
  expect((await backups.now()).bytes).toBe(4096);
  expect(backups.lastError).toBe(null);
  expect(await backups.choose()).toBe(null);
  await backups.restore("20261122T120000Z-0a1b2c");
  expect(calls.at(-1)).toEqual([
    "restore_backup",
    { id: "20261122T120000Z-0a1b2c" },
  ]);
});
