import {
  type BackupV1,
  backupTables,
  type Db,
  NewerSchemaError,
  SCHEMA_VERSION,
  type SqlValue,
} from "@cubehaus/storage";
import type { RestoreFileResult } from "../backup-file";

export type RecoveryResult = RestoreFileResult | { restored: true };

export type ReadableData = string | Blob;

export type DbRecovery = {
  restoreLatest?: () => Promise<RecoveryResult>;
  restoreFile?: (file: File) => Promise<RecoveryResult>;
  saveReadable?: () => Promise<ReadableData | null>;
};

export async function readSchema(db: Db): Promise<number> {
  const [row] = await db.all<{ user_version: number }>("PRAGMA user_version");
  const version = row?.user_version ?? 0;
  if (version > SCHEMA_VERSION) {
    throw new NewerSchemaError(
      `Database schema ${version} is newer than ${SCHEMA_VERSION}`,
    );
  }
  return version;
}

// quick_check(1) stops at the first error but still scans a healthy file.
const startupCheckBytes = 1024 * 1024;

export async function checkIntegrity(db: Db): Promise<void> {
  const [size] = await db.all<{ bytes: number }>(
    "SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()",
  );
  if (!size || size.bytes > startupCheckBytes) return;
  const [check] = await db.all<{ quick_check: string }>(
    "PRAGMA quick_check(1)",
  );
  if (check?.quick_check !== "ok") {
    throw new Error(check?.quick_check ?? "Database integrity check failed");
  }
}

/** A failed table read should not prevent exporting other readable tables. */
export async function saveReadable(db: Db): Promise<string | null> {
  const schema = await readSchema(db);
  if (schema < 3) return null;
  const tables: BackupV1["tables"] = {};
  for (const [name, { columns }] of backupTables(schema)) {
    try {
      tables[name] = await db.all<Record<string, SqlValue>>(
        `SELECT ${columns.join(", ")} FROM ${name} NOT INDEXED`,
      );
    } catch {
      tables[name] = [];
    }
  }

  // Keep only rows whose parents can also be restored. A session can stand alone.
  const ids = (name: string) => new Set(tables[name]?.map((row) => row.id));
  const folders = ids("folder");
  for (const row of tables.session ?? [])
    if ("folder_id" in row && !folders.has(row.folder_id)) row.folder_id = null;
  const sessions = ids("session");
  tables.solve =
    tables.solve?.filter((row) => sessions.has(row.session_id)) ?? [];
  if (tables.import_session)
    tables.import_session = tables.import_session.filter((row) =>
      sessions.has(row.session_id),
    );
  const solves = ids("solve");
  if (tables.solve_repeat)
    tables.solve_repeat = tables.solve_repeat.filter((row) =>
      solves.has(row.solve_id),
    );

  if (!Object.values(tables).some((rows) => rows.length > 0)) return null;
  return JSON.stringify({
    format: "cubehaus",
    version: 1,
    schema,
    exportedAt: Date.now(),
    tables,
  } satisfies BackupV1);
}
