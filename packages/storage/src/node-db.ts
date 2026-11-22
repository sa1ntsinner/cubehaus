import { DatabaseSync } from "node:sqlite";
import type { Db, SqlValue } from "./db";

// This module is deliberately absent from the browser entry point.
export function createNodeDb(path: string): Db {
  const database = new DatabaseSync(path, {
    enableForeignKeyConstraints: true,
  });
  // @types/node 26.6.6 predates StatementSync.close(), added in Node 26.8.
  function prepare(sql: string) {
    return database.prepare(sql) as ReturnType<typeof database.prepare> & {
      close(): void;
    };
  }
  return {
    async all<T extends Record<string, SqlValue>>(
      sql: string,
      params: readonly SqlValue[] = [],
    ): Promise<T[]> {
      const statement = prepare(sql);
      try {
        return statement.all(...params) as T[];
      } finally {
        statement.close();
      }
    },
    async columns(sql, params = []) {
      const statement = prepare(sql);
      try {
        statement.setReturnArrays(true);
        const rows = statement.all(...params) as unknown as SqlValue[][];
        return statement.columns().map((_, index) =>
          Float64Array.from(rows, (row) => {
            const value = row[index];
            if (typeof value !== "number")
              throw new TypeError("columns requires numeric SQL values");
            return value;
          }),
        );
      } finally {
        statement.close();
      }
    },
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      // Reuse identical SQL within a batch, especially the 5,000-row imports.
      const prepared = new Map<string, ReturnType<typeof prepare>>();
      try {
        for (const { sql, params = [] } of statements) {
          let statement = prepared.get(sql);
          if (!statement) {
            statement = prepare(sql);
            prepared.set(sql, statement);
          }
          statement.run(...params);
        }
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      } finally {
        for (const statement of prepared.values()) statement.close();
      }
    },
    async close() {
      database.close();
    },
  };
}
