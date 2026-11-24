import {
  type BackupV1,
  backupTables,
  type Db,
  type SqlValue,
} from "@cubehaus/storage";
import { readSchema } from "./recovery";

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
