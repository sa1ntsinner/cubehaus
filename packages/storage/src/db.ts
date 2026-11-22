export type SqlValue = string | number | null;

export interface Statement {
  sql: string;
  params?: readonly SqlValue[];
}

export interface Db {
  all<T extends Record<string, SqlValue>>(
    sql: string,
    params?: readonly SqlValue[],
  ): Promise<T[]>;
  columns(sql: string, params?: readonly SqlValue[]): Promise<Float64Array[]>;
  batch(statements: readonly Statement[]): Promise<void>;
  close(): Promise<void>;
}
