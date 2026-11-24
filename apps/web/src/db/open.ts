import {
  createStore,
  migrate,
  NewerSchemaError,
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
import type { HandoffResult } from "./desktop-handoff";
import { readTestHooks } from "./hooks";
import { inDesktopApp, type NativeBackups, type NativeUpdates } from "./native";
import type { PendingJournal } from "./pending";
import { checkIntegrity, type DbRecovery, readSchema } from "./recovery";

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

export type SettledDbState =
  | ({ kind: "persistent" } & WritableDb)
  | ({ kind: "memory"; reason: string } & WritableDb)
  | { kind: "failed"; reason: string; newer?: boolean; recovery?: DbRecovery };

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

function reasonOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
    const ready = import("./open-native").then(({ openNative }) =>
      openNative(journal),
    );
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
        reason: reasonOf(error),
        ...(error instanceof NewerSchemaError && { newer: true }),
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
        const { restoreDamaged, saveReadable } = client;
        const recoveryFor = (readable: boolean): DbRecovery => ({
          restoreFile: restoreDamaged,
          ...(readable && { saveReadable }),
        });
        if (result.kind === "failed") {
          resolve({
            kind: "failed",
            reason: result.reason,
            recovery: recoveryFor(result.readable),
          });
          return;
        }
        if (result.kind === "persistent") {
          try {
            await readSchema(client);
            await checkIntegrity(client);
            await migrate(client);
          } catch (error) {
            if (error instanceof NewerSchemaError) throw error;
            resolve({
              kind: "failed",
              reason: reasonOf(error),
              recovery: recoveryFor(true),
            });
            return;
          }
        } else {
          await migrate(client);
        }
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
        // Persistence is asked for once there are solves to keep (db/safety.ts).
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
