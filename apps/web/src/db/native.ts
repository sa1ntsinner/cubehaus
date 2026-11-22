import type { Db, SqlValue, Statement } from "@cubehaus/storage";

/**
 * The desktop app's database: the same Db as the web's worker, over Tauri commands to
 * one SQLite file in the app's data directory (apps/desktop/src-tauri/src/database.rs).
 * Rows come as JSON with reals JSON cannot hold tagged (`{"$float":"Infinity"}`: a DNF);
 * numeric columns come as one binary payload, so Infinity crosses as itself.
 */
export type Invoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export type NativeDb = Db & {
  /** Opens the file (once) and returns where it is. */
  open(): Promise<string>;
  /** Writes the webview's carried history as `webview-history.json` beside the file. */
  keepSource(text: string): Promise<string>;
};

const FLOATS: Record<string, number> = {
  Infinity: Number.POSITIVE_INFINITY,
  "-Infinity": Number.NEGATIVE_INFINITY,
  NaN: Number.NaN,
};

function fromNative(value: unknown): SqlValue {
  if (value === null || typeof value === "string" || typeof value === "number")
    return value;
  if (
    value &&
    typeof value === "object" &&
    "$float" in value &&
    typeof (value as { $float: unknown }).$float === "string"
  ) {
    const float = FLOATS[(value as { $float: string }).$float];
    if (float !== undefined) return float;
  }
  throw new TypeError("The database sent a value it does not keep");
}

/** The `db_columns` payload: column and row counts (u32 LE), then f64 LE by column. */
export function decodeColumns(payload: ArrayBuffer): Float64Array[] {
  const view = new DataView(payload);
  if (payload.byteLength < 8) throw new TypeError("Short columns payload");
  const count = view.getUint32(0, true);
  const length = view.getUint32(4, true);
  if (payload.byteLength !== 8 + count * length * 8)
    throw new TypeError("Columns payload size does not match");
  return Array.from({ length: count }, (_, column) => {
    const values = new Float64Array(length);
    const at = 8 + column * length * 8;
    for (let row = 0; row < length; row++)
      values[row] = view.getFloat64(at + row * 8, true);
    return values;
  });
}

const toNative = (params: readonly SqlValue[] = []) =>
  params.map((value) => {
    if (typeof value === "number" && !Number.isFinite(value))
      throw new TypeError("A parameter must be a finite number");
    return value;
  });

export function createNativeDb(invoke: Invoke): NativeDb {
  return {
    async open() {
      return (await invoke("db_open")) as string;
    },
    async all<T extends Record<string, SqlValue>>(
      sql: string,
      params: readonly SqlValue[] = [],
    ) {
      const rows = (await invoke("db_all", {
        sql,
        params: toNative(params),
      })) as Record<string, unknown>[];
      return rows.map(
        (row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [key, fromNative(value)]),
          ) as T,
      );
    },
    async columns(sql, params = []) {
      const payload = await invoke("db_columns", {
        sql,
        params: toNative(params),
      });
      const buffer =
        payload instanceof ArrayBuffer
          ? payload
          : payload instanceof Uint8Array
            ? (payload.buffer.slice(
                payload.byteOffset,
                payload.byteOffset + payload.byteLength,
              ) as ArrayBuffer)
            : Uint8Array.from(payload as number[]).buffer;
      return decodeColumns(buffer);
    },
    async batch(statements: readonly Statement[]) {
      await invoke("db_batch", {
        statements: statements.map(({ sql, params }) => ({
          sql,
          params: toNative(params),
        })),
      });
    },
    async keepSource(text: string) {
      return (await invoke("db_keep_source", { text })) as string;
    },
    async close() {
      await invoke("db_close");
    },
  };
}

/** True inside the desktop app's window (Tauri's bridge is there); never on the web. */
export function inDesktopApp(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)
  );
}

/** A copy in the backup folder (apps/desktop/src-tauri/src/backup.rs). */
export type BackupMeta = {
  id: string;
  /** Epoch milliseconds, to the second. */
  createdAt: number;
  bytes: number;
  status: "complete";
};

/** The desktop app's automatic backups: whole copies of the file, a week of days. */
export type NativeBackups = {
  /** Where copies go. */
  folder(): Promise<string>;
  /** Copies, newest first. */
  list(): Promise<BackupMeta[]>;
  /** A copy now. A failure is also kept in `lastError` until a copy succeeds. */
  now(): Promise<BackupMeta>;
  /** Replaces the history with copy `id`; the current one is copied first. */
  restore(id: string): Promise<void>;
  /** The folder picker; null when the person cancels. */
  choose(): Promise<string | null>;
  /** When the history last changed (epoch ms), or null when it holds nothing. */
  lastChange(): Promise<number | null>;
  lastError: string | null;
};

const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function createNativeBackups(
  invoke: Invoke,
  lastChange: () => Promise<number | null>,
): NativeBackups {
  const backups: NativeBackups = {
    lastError: null,
    async folder() {
      return (await invoke("backup_folder")) as string;
    },
    async list() {
      return (await invoke("list_backups")) as BackupMeta[];
    },
    async now() {
      try {
        const made = (await invoke("backup_now")) as BackupMeta;
        backups.lastError = null;
        return made;
      } catch (error) {
        backups.lastError = reason(error);
        throw error;
      }
    },
    async restore(id) {
      await invoke("restore_backup", { id });
    },
    async choose() {
      return (
        ((await invoke("choose_backup_directory")) as string | null) ?? null
      );
    },
    lastChange,
  };
  return backups;
}

/** What `apply_update_when_idle` did (apps/desktop/src-tauri/src/update.rs). */
export type UpdateState = "waiting" | "applied" | "current";

/**
 * The desktop app's signed updates. Off (check gives null, nothing is fetched) unless the
 * release build carries an updater key.
 */
export type NativeUpdates = {
  /** Looks for a newer release and downloads it; its version, or null. */
  check(): Promise<string | null>;
  /**
   * Installs the downloaded release if `ready` (the timer idle, no edit open, no solve
   * waiting to be written) and nothing natively is writing; the app then relaunches.
   */
  apply(ready: boolean): Promise<UpdateState>;
};

export function createNativeUpdates(invoke: Invoke): NativeUpdates {
  return {
    async check() {
      return ((await invoke("check_update")) as string | null) ?? null;
    },
    async apply(ready) {
      return (await invoke("apply_update_when_idle", { ready })) as UpdateState;
    },
  };
}

const day = (ms: number) => new Date(ms).toDateString();

/**
 * The automatic copy is due at the first chance of a day (local time) on which the
 * history changed since the newest copy; never for a history with nothing in it.
 */
export function backupDue(
  newest: number | null,
  changed: number | null,
  now: number,
): boolean {
  if (changed === null) return false;
  if (newest === null) return true;
  return day(newest) !== day(now) && changed > newest;
}

/** The newest edit of anything a copy keeps (the open session's bookkeeping aside). */
export const LAST_CHANGE_SQL = `SELECT max(m) AS m FROM (
  SELECT max(updated_at) AS m FROM solve
  UNION ALL SELECT max(updated_at) FROM solve_repeat
  UNION ALL SELECT max(updated_at) FROM trainer_case
  UNION ALL SELECT max(updated_at) FROM trainer_attempt
  UNION ALL SELECT max(updated_at) FROM session
  UNION ALL SELECT max(updated_at) FROM folder
  UNION ALL SELECT max(updated_at) FROM import_session
  UNION ALL SELECT max(updated_at) FROM setting
    WHERE key NOT IN ('session.current', 'session.previous')
)`;
