import { migrate, NewerSchemaError, SCHEMA_VERSION } from "@cubehaus/storage";
import { createDbClient } from "./client";
import {
  handoffDesktop,
  type LegacyRead,
  type LegacySnapshotSource,
  markHandedOff,
  mergeLegacy,
  readLegacyCopy,
} from "./desktop-handoff";
import {
  createNativeBackups,
  createNativeDb,
  createNativeUpdates,
  LAST_CHANGE_SQL,
} from "./native";
import type { SettledDbState } from "./open";
import type { PendingJournal } from "./pending";
import { checkIntegrity, readSchema } from "./recovery";
import { saveReadable } from "./save-readable";
import { createDbServices } from "./services";

/**
 * The desktop app's earlier history, in the webview's OPFS: read in a worker of its own
 * into a copy (migrated there if old), and the worker ended, before anything else runs.
 */
const webviewHistory: LegacySnapshotSource = {
  async read(): Promise<LegacyRead> {
    // The SAH pool admits one holder: the same lock the web's database takes.
    if (!navigator.locks) return readWebviewHistory();
    return navigator.locks.request(
      "cubehaus-db",
      { ifAvailable: true },
      (lock): Promise<LegacyRead> =>
        lock
          ? readWebviewHistory()
          : Promise.resolve({ kind: "failed", reason: "busy" }),
    );
  },
};

async function readWebviewHistory(): Promise<LegacyRead> {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
  const client = createDbClient(worker);
  try {
    const opened = await client.openLegacy();
    if (opened.kind !== "copy") return opened;
    return await readLegacyCopy(client);
  } catch (error) {
    return {
      kind: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    worker.terminate();
    client.dispose();
  }
}

/**
 * The desktop file: the shared migrations and services over the native commands, after
 * the webview's earlier history is carried in (once). Solves timed meanwhile stay in the
 * journal and go in after it.
 */
export async function openNative(
  journal?: PendingJournal,
): Promise<SettledDbState> {
  const call = async (command: string, args?: Record<string, unknown>) => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke(command, args);
  };
  const db = createNativeDb(call);
  let readable = false;
  const backups = createNativeBackups(
    call,
    async () =>
      (await db.all<{ m: number | null }>(LAST_CHANGE_SQL))[0]?.m ?? null,
  );
  try {
    await db.open();
    const version = await readSchema(db);
    readable = version > 0;
    await checkIntegrity(db);
    // A copy before a migration changes the file; a failed one does not stop it.
    if (version > 0 && version < SCHEMA_VERSION)
      await backups.now().catch(() => {});
    await migrate(db);
    const { store, ...services } = createDbServices(db);
    const native = {
      db,
      store,
      keepSource: async (text: string) => void (await db.keepSource(text)),
    };
    const handoff = journal
      ? await handoffDesktop(webviewHistory, native, journal)
      : undefined;
    return {
      kind: "persistent",
      store,
      ...services,
      backups,
      updates: createNativeUpdates(call),
      // A restore into an empty file replaces its settings, the handoff mark with them.
      restoreBackup: async (file) => {
        const outcome = await services.restoreBackup(file);
        if (!("problem" in outcome) && handoff !== "needs-recovery")
          await markHandedOff(db);
        return outcome;
      },
      ...(handoff ? { handoff } : {}),
      ...(handoff === "needs-recovery"
        ? { mergeEarlier: () => mergeLegacy(webviewHistory, native) }
        : {}),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (error instanceof NewerSchemaError)
      return { kind: "failed", reason, newer: true };
    const [latest] = await backups.list().catch(() => []);
    return {
      kind: "failed",
      reason,
      recovery: {
        ...(latest && {
          restoreLatest: async () => {
            try {
              await backups.restore(latest.id);
            } catch (error) {
              if (error === "newer_backup_schema")
                return { problem: "newer" as const };
              throw error;
            }
            return { restored: true as const };
          },
        }),
        ...(readable && { saveReadable: () => saveReadable(db) }),
      },
    };
  }
}
