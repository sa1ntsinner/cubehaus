import type { Db, SqlValue, Statement } from "@cubehaus/storage";
import sqlite3InitModule, {
  type Database,
  type PreparedStatement,
} from "@sqlite.org/sqlite-wasm";
import wasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import type { ImportInput } from "../import";
import type { LegacyOpenResult } from "./client";
import { createDbServices } from "./services";

let database: Database | undefined;

function connection(): Database {
  if (!database) throw new Error("Database is not open");
  return database;
}

const db: Db = {
  async all<T extends Record<string, SqlValue>>(
    sql: string,
    params: readonly SqlValue[] = [],
  ) {
    return connection().selectObjects(sql, [...params]) as T[];
  },
  async columns(sql, params = []) {
    const names: string[] = [];
    const rows: SqlValue[][] = [];
    connection().exec({
      sql,
      bind: [...params],
      rowMode: "array",
      columnNames: names,
      resultRows: rows,
    });
    return names.map((_, index) =>
      Float64Array.from(rows, (row) => {
        const value = row[index];
        if (typeof value !== "number")
          throw new TypeError("columns requires numeric SQL values");
        return value;
      }),
    );
  },
  async batch(statements) {
    const open = connection();
    // An import repeats one INSERT many thousand times: prepare each text once.
    const prepared = new Map<string, PreparedStatement>();
    open.exec("BEGIN IMMEDIATE");
    try {
      for (const { sql, params = [] } of statements) {
        if (params.length === 0) {
          open.exec(sql);
          continue;
        }
        let statement = prepared.get(sql);
        if (!statement) {
          statement = open.prepare(sql);
          prepared.set(sql, statement);
        }
        statement.bind([...params]).stepReset();
      }
      open.exec("COMMIT");
    } catch (error) {
      open.exec("ROLLBACK");
      throw error;
    } finally {
      for (const statement of prepared.values()) statement.finalize();
    }
  },
  async close() {
    connection().close();
    database = undefined;
  },
};
const {
  progress,
  previewImport: previewFile,
  importFile,
  exportBackup,
  exportFile,
  restoreBackup,
} = createDbServices(db);

// The published initializer type omits Emscripten's documented options.
function initialize() {
  return (
    sqlite3InitModule as (options: {
      locateFile: (path: string) => string;
    }) => ReturnType<typeof sqlite3InitModule>
  )({ locateFile: () => wasmUrl });
}

/** Where the SAH pool keeps its files (its default directory) and the app's name in it. */
const POOL_DIRECTORY = ".opfs-sahpool";
const FILE = "/cubehaus.sqlite3";

/**
 * The desktop app's earlier history in the webview's OPFS, read without changing it: the
 * pool's directory is looked for before the pool is installed (so none is created), the
 * file is opened read-only and serialised, and that copy is what this worker then serves.
 */
async function openLegacy(): Promise<LegacyOpenResult> {
  if (database) throw new Error("Database is already open");
  if (typeof navigator.storage?.getDirectory !== "function")
    return { kind: "absent" };
  try {
    const root = await navigator.storage.getDirectory();
    try {
      await root.getDirectoryHandle(POOL_DIRECTORY);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError")
        return { kind: "absent" };
      throw error;
    }
    const sqlite = await initialize();
    const pool = await sqlite.installOpfsSAHPoolVfs({
      preserveOnInitFailure: true,
    });
    let bytes: Uint8Array;
    try {
      if (!pool.getFileNames().includes(FILE)) return { kind: "absent" };
      const source = new sqlite.oo1.DB({
        filename: FILE,
        flags: "r",
        vfs: pool.vfsName,
      });
      try {
        bytes = sqlite.capi.sqlite3_js_db_export(source);
      } finally {
        source.close();
      }
    } finally {
      pool.pauseVfs();
    }
    const copy = new sqlite.oo1.DB(":memory:");
    const pointer = sqlite.wasm.allocFromTypedArray(bytes);
    copy.checkRc(
      sqlite.capi.sqlite3_deserialize(
        copy,
        "main",
        pointer,
        bytes.byteLength,
        bytes.byteLength,
        sqlite.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
          sqlite.capi.SQLITE_DESERIALIZE_RESIZEABLE,
      ),
    );
    database = copy;
    database.exec("PRAGMA foreign_keys = ON");
    return { kind: "copy" };
  } catch (error) {
    return {
      kind: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function execute(method: string, args: unknown[]): Promise<unknown> {
  if (method === "openLegacy") return openLegacy();
  if (method === "open") {
    if (database) throw new Error("Database is already open");
    const options = args[0] as { opfs: boolean; delay: number };
    if (options.delay > 0)
      await new Promise((resolve) => setTimeout(resolve, options.delay));
    const sqlite = await initialize();
    let result: { kind: "persistent" } | { kind: "memory"; reason: string };
    if (options.opfs) {
      try {
        const pool = await sqlite.installOpfsSAHPoolVfs({
          preserveOnInitFailure: true,
        });
        database = new pool.OpfsSAHPoolDb(FILE);
        result = { kind: "persistent" };
      } catch (error) {
        database = new sqlite.oo1.DB(":memory:");
        result = { kind: "memory", reason: String(error) };
      }
    } else {
      database = new sqlite.oo1.DB(":memory:");
      result = { kind: "memory", reason: "OPFS or Web Locks is unavailable" };
    }
    database.exec("PRAGMA foreign_keys = ON");
    return result;
  }
  connection();
  if (method === "previewImport") return previewFile(args[0] as ImportInput);
  if (method === "importFile") return importFile(args[0] as ImportInput);
  if (method === "exportBackup") return exportBackup();
  if (method === "exportFile")
    return exportFile(
      args[0] === "csv" ? "csv" : "cstimer",
      typeof args[1] === "string" ? args[1] : undefined,
    );
  if (method === "restoreBackup") return restoreBackup(args[0] as File);
  if (method === "progress.counts") return progress.counts(args[0] as number);
  if (method === "progress.read")
    return progress.readProgress(
      ...(args as Parameters<typeof progress.readProgress>),
    );
  if (method === "progress.distribution")
    return progress.distribution(args[0] as string);
  if (method === "progress.point")
    return progress.point(...(args as Parameters<typeof progress.point>));
  if (method === "all") {
    return db.all(args[0] as string, args[1] as SqlValue[]);
  }
  if (method === "columns") {
    return db.columns(args[0] as string, args[1] as SqlValue[]);
  }
  if (method === "batch") {
    return db.batch(args[0] as Statement[]);
  }
  if (method === "close") return db.close();
  throw new Error(`Unknown database method: ${method}`);
}

// Serialize even open/close: no second request can enter an unfinished operation.
let queue = Promise.resolve();
self.addEventListener("message", (event: MessageEvent) => {
  const { id, method, args } = event.data;
  queue = queue.then(async () => {
    try {
      const result = await execute(method, args);
      const transfer =
        method === "columns"
          ? (result as Float64Array[]).map((column) => column.buffer)
          : [];
      self.postMessage({ id, result }, { transfer });
    } catch (error) {
      self.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
});
