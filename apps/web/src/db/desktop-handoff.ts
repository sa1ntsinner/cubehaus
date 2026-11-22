import {
  type BackupV1,
  backupTables,
  type Db,
  migrate,
  restore,
  type Statement,
  type Store,
  snapshot,
} from "@cubehaus/storage";
import { flushPending } from "./flow";
import type { PendingJournal } from "./pending";

/**
 * The desktop app before 0.1 kept its history where the web does, in the webview's own
 * storage. Once, the first time the native file opens, that history is carried into the
 * file. The webview's database is only ever read, through a copy, and stays as it was.
 *
 * The marker `desktop.handoff.v1` is written in the same native transaction as the
 * carried rows, so a start that dies after that commit finds the marker and carries
 * nothing twice; pending solves are replayed on every start, and a replay is idempotent.
 */
export const HANDOFF_KEY = "desktop.handoff.v1";

/** What the webview's own database holds. */
export type LegacyRead =
  | { kind: "absent" }
  | { kind: "empty" }
  | { kind: "failed"; reason: string }
  | { kind: "present"; backup: BackupV1 };

export interface LegacySnapshotSource {
  read(): Promise<LegacyRead>;
}

export type NativeStore = {
  db: Db;
  store: Store;
  /** Keeps the carried history as a backup file beside the native one. */
  keepSource?: (backup: string) => Promise<void>;
};

export type HandoffResult = "migrated" | "new" | "already" | "needs-recovery";

/**
 * Reads a copy of the webview's database: an untouched schema is empty, an older one is
 * migrated (on the copy) and read whole, a newer or broken one fails.
 */
export async function readLegacyCopy(db: Db): Promise<LegacyRead> {
  try {
    const [row] = await db.all<{ user_version: number }>("PRAGMA user_version");
    if (!row?.user_version) return { kind: "empty" };
    await migrate(db);
    const backup = await snapshot(db);
    return Object.values(backup.tables).some((rows) => rows.length > 0)
      ? { kind: "present", backup }
      : { kind: "empty" };
  } catch (error) {
    return {
      kind: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

const marker = (): Statement => ({
  sql: `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  params: [HANDOFF_KEY, JSON.stringify({ at: Date.now() }), Date.now()],
});

/** Marks the handoff done (again, after a restore replaced the settings). */
export async function markHandedOff(db: Db): Promise<void> {
  if (!(await handedOff(db))) await db.batch([marker()]);
}

async function handedOff(db: Db): Promise<boolean> {
  const rows = await db.all("SELECT 1 FROM setting WHERE key = ?", [
    HANDOFF_KEY,
  ]);
  return rows.length > 0;
}

/** Nothing of the person's yet: at most the session the app makes on its own. */
async function pristine(db: Db): Promise<boolean> {
  const [counts] = await db.all<{
    solves: number;
    folders: number;
    sessions: number;
  }>(
    "SELECT (SELECT count(*) FROM solve) AS solves, (SELECT count(*) FROM folder) AS folders, (SELECT count(*) FROM session) AS sessions",
  );
  return (
    !!counts &&
    counts.solves === 0 &&
    counts.folders === 0 &&
    counts.sessions <= 1
  );
}

/** The restore's own single transaction, with the marker as its last statement. */
const withMarker = (db: Db): Db => ({
  ...db,
  batch: (statements) => db.batch([...statements, marker()]),
});

/** The file now holds exactly what the webview held (and the marker). */
async function sameAs(db: Db, backup: BackupV1): Promise<boolean> {
  const now = await snapshot(db);
  return backupTables().every(([name]) => {
    const here = (now.tables[name] ?? []).filter(
      (row) => !(name === "setting" && row.key === HANDOFF_KEY),
    );
    return JSON.stringify(here) === JSON.stringify(backup.tables[name] ?? []);
  });
}

/** Pending solves whose session is in the file go in; others wait for the app's own replay. */
async function replay(store: Store, journal: PendingJournal) {
  const sessions = new Set((await store.sessions.list()).map(({ id }) => id));
  const ready = {
    ...journal,
    all: () =>
      journal
        .all()
        .filter(
          (solve) =>
            solve.repeatOf === undefined && sessions.has(solve.sessionId),
        ),
  };
  await flushPending(
    ready,
    async (solve) => solve,
    (solve) => store.solves.add(solve),
  );
}

export async function handoffDesktop(
  legacy: LegacySnapshotSource,
  native: NativeStore,
  journal: PendingJournal,
): Promise<HandoffResult> {
  const result = await carry(legacy, native);
  await replay(native.store, journal);
  return result;
}

async function carry(
  legacy: LegacySnapshotSource,
  { db, keepSource }: NativeStore,
): Promise<HandoffResult> {
  if (await handedOff(db)) return "already";
  const found = await legacy.read();
  // Unreadable is not absent: ask again on the next start, change nothing.
  if (found.kind === "failed") return "needs-recovery";
  if (found.kind !== "present") {
    await db.batch([marker()]);
    return "new";
  }
  // A file with history of its own is never overwritten.
  if (!(await pristine(db))) return "needs-recovery";
  await keepSource?.(JSON.stringify(found.backup));
  try {
    await restore(withMarker(db), found.backup);
  } catch {
    return "needs-recovery";
  }
  if (!(await sameAs(db, found.backup))) {
    // Unexpected; the webview's history is still there, so ask rather than trust this.
    await db.batch([
      { sql: "DELETE FROM setting WHERE key = ?", params: [HANDOFF_KEY] },
    ]);
    return "needs-recovery";
  }
  return "migrated";
}

/**
 * The recovery choice for a file with history of its own: the webview's history merged
 * in as a restore merges (a missing row added, the newer edit of a row kept), then marked.
 */
export async function mergeLegacy(
  legacy: LegacySnapshotSource,
  { db }: NativeStore,
): Promise<boolean> {
  const found = await legacy.read();
  if (found.kind === "failed") return false;
  if (found.kind === "present") await restore(withMarker(db), found.backup);
  await markHandedOff(db);
  return true;
}
