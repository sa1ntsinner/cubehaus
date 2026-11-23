import {
  createStore,
  migrate,
  SCHEMA_VERSION,
  type Store,
} from "@cubehaus/storage";
import type { ExportFileResult, RestoreFileResult } from "../backup-file";
import type {
  ImportFileResult,
  ImportInput,
  ImportPreviewResult,
} from "../import";
import type { ProgressReader } from "../progress-worker";
import { createDbClient } from "./client";
import {
  type HandoffResult,
  handoffDesktop,
  type LegacyRead,
  type LegacySnapshotSource,
  markHandedOff,
  mergeLegacy,
  readLegacyCopy,
} from "./desktop-handoff";
import { readTestHooks } from "./hooks";
import {
  createNativeBackups,
  createNativeDb,
  createNativeUpdates,
  inDesktopApp,
  LAST_CHANGE_SQL,
  type NativeBackups,
  type NativeUpdates,
} from "./native";
import type { PendingJournal } from "./pending";
import { createDbServices } from "./services";

type WritableDb = {
  store: Store;
  previewImport?: (file: ImportInput) => Promise<ImportPreviewResult>;
  importFile?: (file: ImportInput) => Promise<ImportFileResult>;
  exportBackup?: () => Promise<string>;
  exportFile?: (
    format: "cstimer" | "csv",
    sessionId?: string,
  ) => Promise<ExportFileResult>;
  restoreBackup?: (file: File) => Promise<RestoreFileResult>;
  progress?: ProgressReader;
  /** Desktop: how the webview's earlier history went into the file on this start. */
  handoff?: HandoffResult;
  /** Desktop, when the file had history of its own: merges the earlier history in. */
  mergeEarlier?: () => Promise<boolean>;
  /** Desktop: the automatic copies of the file. */
  backups?: NativeBackups;
  /** Desktop: signed updates, installed only when the timer is safe. */
  updates?: NativeUpdates;
};

type SettledDbState =
  | ({ kind: "persistent" } & WritableDb)
  | ({ kind: "memory"; reason: string } & WritableDb)
  | { kind: "failed"; reason: string };

export type DbState = SettledDbState | { kind: "busy" };

export const LOCK_GRACE_MS = 1500;

type DatabaseOpening = {
  initial: Promise<DbState>;
  ready: Promise<SettledDbState>;
};

let opening: DatabaseOpening | undefined;

/** The desktop app keeps its history in the native file; the plain web never does. */
export function nativeDatabase(): boolean {
  return inDesktopApp();
}

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
async function openNative(journal?: PendingJournal): Promise<SettledDbState> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const call = (command: string, args?: Record<string, unknown>) =>
      invoke(command, args);
    const db = createNativeDb(call);
    await db.open();
    const backups = createNativeBackups(
      call,
      async () =>
        (await db.all<{ m: number | null }>(LAST_CHANGE_SQL))[0]?.m ?? null,
    );
    // A copy before a migration changes the file; a failed one does not stop it.
    const [schema] = await db.all<{ user_version: number }>(
      "PRAGMA user_version",
    );
    const version = schema?.user_version ?? 0;
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
        if (handoff !== "needs-recovery") await markHandedOff(db);
        return outcome;
      },
      ...(handoff ? { handoff } : {}),
      ...(handoff === "needs-recovery"
        ? { mergeEarlier: () => mergeLegacy(webviewHistory, native) }
        : {}),
    };
  } catch (error) {
    // A file that cannot be opened is reported, never replaced by another database.
    return {
      kind: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function openDatabase({
  memory = false,
  journal,
}: {
  memory?: boolean;
  journal?: PendingJournal;
} = {}): DatabaseOpening {
  if (opening) return opening;
  if (!memory && nativeDatabase()) {
    const ready = openNative(journal);
    opening = { initial: ready, ready };
    return opening;
  }
  let busy: Promise<{ kind: "busy" }> | undefined;
  const ready = new Promise<SettledDbState>((resolve) => {
    const waiting = new AbortController();
    let grace: ReturnType<typeof setTimeout> | undefined;
    let release = () => {};
    let worker: Worker | undefined;
    let client: ReturnType<typeof createDbClient> | undefined;
    const cleanup = () => {
      worker?.terminate();
      client?.dispose();
      release();
    };
    // A document in the back/forward cache must neither hold the SAH pool
    // nor acquire it while hidden. A restored document reopens by reload.
    window.addEventListener(
      "pagehide",
      () => {
        clearTimeout(grace);
        waiting.abort();
        cleanup();
      },
      { once: true },
    );
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) location.reload();
    });
    const fail = (error: unknown) => {
      if (waiting.signal.aborted) return;
      clearTimeout(grace);
      cleanup();
      resolve({
        kind: "failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    };
    async function open(locked: boolean) {
      try {
        worker = new Worker(new URL("./worker.ts", import.meta.url), {
          type: "module",
        });
        client = createDbClient(worker, {
          dropSolveOnce: readTestHooks(location.search).drop,
        });
        const result = await client.open({
          opfs: locked && typeof navigator.storage?.getDirectory === "function",
          delay: readTestHooks(location.search).delay,
        });
        await migrate(client);
        const store = createStore(client);
        resolve({
          ...result,
          store,
          previewImport: client.previewImport,
          importFile: client.importFile,
          exportBackup: client.exportBackup,
          exportFile: client.exportFile,
          restoreBackup: client.restoreBackup,
          progress: client.progress,
        });
        try {
          if (!memory) void navigator.storage?.persist?.().catch(() => {});
        } catch {
          /* Best effort. */
        }
      } catch (error) {
        fail(error);
      }
    }
    if (memory || !navigator.locks) {
      void open(false);
      return;
    }
    // The grace period only measures lock acquisition. Opening and migrating
    // the database can take longer once the document has the lock.
    busy = new Promise((report) => {
      grace = setTimeout(() => report({ kind: "busy" }), LOCK_GRACE_MS);
    });
    try {
      void navigator.locks
        .request("cubehaus-db", { signal: waiting.signal }, async () => {
          clearTimeout(grace);
          if (waiting.signal.aborted) return;
          const held = new Promise<void>((done) => {
            release = done;
          });
          await open(true);
          await held;
        })
        .catch(fail);
    } catch (error) {
      fail(error);
    }
  });
  opening = { initial: busy ? Promise.race([ready, busy]) : ready, ready };
  return opening;
}
