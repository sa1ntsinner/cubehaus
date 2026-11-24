import { type Db, NewerSchemaError, SCHEMA_VERSION } from "@cubehaus/storage";
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
