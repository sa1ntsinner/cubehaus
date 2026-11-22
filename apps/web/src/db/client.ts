import type { Db } from "@cubehaus/storage";
import type { ExportFileResult, RestoreFileResult } from "../backup-file";
import type {
  ImportFileResult,
  ImportInput,
  ImportPreviewResult,
} from "../import";
import type { ProgressReader } from "../progress-worker";

export interface WorkerPort extends EventTarget {
  postMessage(message: unknown): void;
}
export type OpenResult =
  | { kind: "persistent" }
  | { kind: "memory"; reason: string };
/** The webview's own database, read into memory: none there, a copy open, or failed. */
export type LegacyOpenResult =
  | { kind: "absent" }
  | { kind: "copy" }
  | { kind: "failed"; reason: string };
export type DbClient = Db & {
  open(options: { opfs: boolean; delay: number }): Promise<OpenResult>;
  /** Desktop only: opens a copy of the webview's database, never the database itself. */
  openLegacy(): Promise<LegacyOpenResult>;
  previewImport(file: ImportInput): Promise<ImportPreviewResult>;
  importFile(file: ImportInput): Promise<ImportFileResult>;
  exportBackup(): Promise<string>;
  exportFile(format: "cstimer" | "csv"): Promise<ExportFileResult>;
  restoreBackup(file: File): Promise<RestoreFileResult>;
  progress: ProgressReader;
  dispose(): void;
};

export class DroppedWriteError extends Error {}

export function createDbClient(
  worker: WorkerPort,
  options: { dropSolveOnce?: boolean } = {},
): DbClient {
  let dropSolve = options.dropSolveOnce ?? false;
  let nextId = 0;
  let failure: Error | undefined;
  const pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  function request<T>(method: string, args: unknown[]): Promise<T> {
    if (failure) return Promise.reject(failure);
    return new Promise<T>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve: (value) => resolve(value as T), reject });
      try {
        worker.postMessage({ id, method, args });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  }
  const onMessage = (event: Event) => {
    const message = (event as MessageEvent).data;
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    if (message.error !== undefined) call.reject(new Error(message.error));
    else call.resolve(message.result);
  };
  const onError = () => {
    failure = new Error("Database worker stopped");
    for (const call of pending.values()) call.reject(failure);
    pending.clear();
  };
  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onError);
  worker.addEventListener("messageerror", onError);
  return {
    open: (options) => request("open", [options]),
    openLegacy: () => request("openLegacy", []),
    previewImport: (file) => request("previewImport", [file]),
    importFile: (file) => request("importFile", [file]),
    exportBackup: () => request("exportBackup", []),
    exportFile: (format) => request("exportFile", [format]),
    restoreBackup: (file) => request("restoreBackup", [file]),
    progress: {
      counts: (revision) => request("progress.counts", [revision]),
      readProgress: (scope, options) =>
        request("progress.read", [scope, options]),
      point: (key, index) => request("progress.point", [key, index]),
      distribution: (key) => request("progress.distribution", [key]),
    },
    all: (sql, params = []) => request("all", [sql, params]),
    columns: (sql, params = []) => request("columns", [sql, params]),
    batch: (statements) => {
      if (
        dropSolve &&
        statements.some(({ sql }) =>
          /^INSERT OR IGNORE INTO solve\s*\(/i.test(sql),
        )
      ) {
        dropSolve = false;
        return Promise.reject(
          new DroppedWriteError("Test hook dropped solve insert"),
        );
      }
      return request("batch", [statements]);
    },
    async close() {
      try {
        await request("close", []);
      } finally {
        this.dispose();
      }
    },
    dispose() {
      onError();
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("messageerror", onError);
    },
  };
}
