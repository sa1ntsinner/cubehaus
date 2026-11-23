import {
  encodeCsTimer,
  encodeCsv,
  ImportFormatError,
} from "@cubehaus/importers";
import {
  BackupFormatError,
  BackupReferenceError,
  createStore,
  type Db,
  NewerBackupError,
  restore,
  snapshot,
} from "@cubehaus/storage";
import type { ExportFileResult, RestoreFileResult } from "../backup-file";
import {
  type ImportFileResult,
  type ImportInput,
  type ImportPreviewResult,
  parseImport,
  reviewFile,
  runImport,
} from "../import";
import { createProgressReader } from "../progress-worker";

/**
 * Import, export, restore and progress over one database connection. The web runs them
 * in its database worker over SQLite in OPFS; the desktop app over the native file.
 */
export function createDbServices(db: Db) {
  const store = createStore(db);
  const progress = createProgressReader(store);

  async function previewFile(file: ImportInput): Promise<ImportPreviewResult> {
    try {
      return await reviewFile(store, await parseImport(file));
    } catch (error) {
      if (error instanceof ImportFormatError)
        return { formatError: error.problem };
      throw error;
    }
  }

  async function importFile(file: ImportInput): Promise<ImportFileResult> {
    try {
      return await runImport(store, await parseImport(file));
    } catch (error) {
      if (error instanceof ImportFormatError)
        return { formatError: error.problem };
      throw error;
    }
  }

  // Parsing and serialising whole histories stays off the page's thread.
  async function exportBackup(): Promise<string> {
    return JSON.stringify(await snapshot(db));
  }

  /** Another timer's file, with what it could not hold counted rather than listed. */
  async function exportFile(
    format: "cstimer" | "csv",
    sessionId?: string,
  ): Promise<ExportFileResult> {
    const backup = await snapshot(db);
    const options = sessionId === undefined ? {} : { sessionId };
    const { text, issues } =
      format === "csv"
        ? encodeCsv(backup, options)
        : encodeCsTimer(backup, options);
    return {
      text,
      solves: new Set(issues.map(({ id }) => id)).size,
      fields: [...new Set(issues.map(({ field }) => field))],
    };
  }

  return {
    store,
    progress,
    previewImport: previewFile,
    importFile,
    exportBackup,
    exportFile,
    restoreBackup: (file: File) => restoreFromFile(db, file),
  };
}

export async function restoreFromFile(
  db: Db,
  file: File,
): Promise<RestoreFileResult> {
  let doc: unknown;
  try {
    doc = JSON.parse(await file.text());
  } catch {
    return { problem: "format" };
  }
  try {
    return await restore(db, doc);
  } catch (error) {
    if (error instanceof NewerBackupError) return { problem: "newer" };
    if (error instanceof BackupFormatError) return { problem: "format" };
    if (error instanceof BackupReferenceError) return { problem: "reference" };
    throw error;
  }
}

export type DbServices = ReturnType<typeof createDbServices>;
