import type { Db, SqlValue, Statement } from "./db";
import { SCHEMA_VERSION } from "./migrations";

/**
 * The native backup: every authoritative row of every table, tombstones included, as
 * plain JSON. The format version changes only when this envelope changes; the schema
 * number says which columns the rows carry.
 */
export interface BackupV1 {
  format: "cubehaus";
  version: 1;
  schema: number;
  exportedAt: number;
  tables: Record<string, Record<string, SqlValue>[]>;
}

export interface RestoreResult {
  /** Rows the target did not have. */
  inserted: number;
  /** Rows the backup had a newer edit of. */
  updated: number;
  /** Rows already identical, or newer in the target, or a solve already imported. */
  unchanged: number;
}

/** The file is not a cubehaus backup, or its rows are malformed. */
export class BackupFormatError extends Error {}
/** The backup was written by a newer version of the app. */
export class NewerBackupError extends Error {}
/** A row points to a session or folder that exists in neither the backup nor here. */
export class BackupReferenceError extends Error {}

/** A table's primary key columns and every column, in the order rows are written. */
type Table = { key: readonly string[]; columns: readonly string[] };

/**
 * Tables in dependency order, per schema the reader understands. A migration that adds
 * an authoritative table or column adds it here (backup.test.ts compares this with the
 * live schema).
 */
const folder: Table = {
  key: ["id"],
  columns: [
    "id",
    "name",
    "order_key",
    "collapsed",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
};
const session: Table = {
  key: ["id"],
  columns: [
    "id",
    "name",
    "event",
    "order_key",
    "folder_id",
    "archived",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
};
const solveV3: Table = {
  key: ["id"],
  columns: [
    "id",
    "session_id",
    "event",
    "time_ms",
    "plus2",
    "dnf",
    "scramble",
    "started_at",
    "inspection_ms",
    "comment",
    "input",
    "import_source",
    "import_hash",
    "moves",
    "solution",
    "cubes_solved",
    "cubes_attempted",
    "updated_at",
    "deleted_at",
  ],
};
const setting: Table = {
  key: ["key"],
  columns: ["key", "value", "updated_at"],
};

const manifest: Record<number, readonly [string, Table][]> = {
  3: [
    ["folder", folder],
    ["session", session],
    ["solve", solveV3],
    ["setting", setting],
  ],
  4: [
    ["folder", folder],
    ["session", session],
    ["solve", { ...solveV3, columns: [...solveV3.columns, "import_extra"] }],
    [
      "import_session",
      {
        key: ["source", "source_scope", "source_key"],
        columns: [
          "source",
          "source_scope",
          "source_key",
          "session_id",
          "source_meta",
          "updated_at",
        ],
      },
    ],
    ["setting", setting],
  ],
};
// 5 adds the ledger of what the trash purged for good.
manifest[5] = [
  ...(manifest[4] ?? []).slice(0, 4),
  ["import_seen", { key: ["source", "hash"], columns: ["source", "hash"] }],
  ["setting", setting],
];

// 6 adds further attempts on a solve's scramble, after the solves they belong to.
manifest[6] = [
  ...(manifest[5] ?? []).slice(0, 3),
  [
    "solve_repeat",
    {
      key: ["id"],
      columns: [
        "id",
        "solve_id",
        "time_ms",
        "plus2",
        "dnf",
        "started_at",
        "inspection_ms",
        "comment",
        "input",
        "updated_at",
        "deleted_at",
      ],
    },
  ],
  ...(manifest[5] ?? []).slice(3),
];

// 7 adds the algorithm trainer's cases and attempts, which refer to nothing else.
manifest[7] = [
  ...(manifest[6] ?? []),
  [
    "trainer_case",
    {
      key: ["set_id", "case_id"],
      columns: [
        "set_id",
        "case_id",
        "card",
        "due_at",
        "added_at",
        "updated_at",
        "removed_at",
      ],
    },
  ],
  [
    "trainer_attempt",
    {
      key: ["id"],
      columns: [
        "id",
        "set_id",
        "case_id",
        "mode",
        "auf",
        "scramble",
        "recog_ms",
        "exec_ms",
        "missed",
        "grade",
        "at",
        "updated_at",
      ],
    },
  ],
];

// 8 marks how a trainer attempt's recognition was timed (split).
manifest[8] = (manifest[7] ?? []).map(([name, table]) =>
  name === "trainer_attempt"
    ? [name, { ...table, columns: [...table.columns, "split"] }]
    : [name, table],
);

// 9 adds the colour a solve's cross was built on.
manifest[9] = (manifest[8] ?? []).map(([name, table]) =>
  name === "solve"
    ? [name, { ...table, columns: [...table.columns, "cross_colour"] }]
    : [name, table],
);

manifest[10] = (manifest[9] ?? []).map(([name, table]) =>
  name === "solve" || name === "solve_repeat"
    ? [name, { ...table, columns: [...table.columns, "splits"] }]
    : [name, table],
);

export function backupTables(
  schema = SCHEMA_VERSION,
): readonly [string, Table][] {
  const tables = manifest[schema];
  if (!tables) throw new Error(`No backup manifest for schema ${schema}`);
  return tables;
}

/** All rows in one statement, so every table comes from the same read snapshot. */
export async function snapshot(
  db: Db,
  now: () => number = Date.now,
): Promise<BackupV1> {
  const tables = backupTables();
  const sql = tables
    .map(
      ([name, { columns }]) =>
        `SELECT '${name}' AS t, json_object(${columns
          .map((column) => `'${column}', ${column}`)
          .join(", ")}) AS r FROM ${name}`,
    )
    .join(" UNION ALL ");
  const rows = await db.all<{ t: string; r: string }>(sql);
  const out: BackupV1["tables"] = Object.fromEntries(
    tables.map(([name]) => [name, []]),
  );
  for (const { t, r } of rows)
    out[t]?.push(JSON.parse(r) as Record<string, SqlValue>);
  for (const [name, { key }] of tables)
    out[name]?.sort((a, b) => compareKeys(keyOf(a, key), keyOf(b, key)));
  return {
    format: "cubehaus",
    version: 1,
    schema: SCHEMA_VERSION,
    exportedAt: now(),
    tables: out,
  };
}

/** One string per row for its primary key, however many columns the key has. */
function keyOf(row: Record<string, SqlValue>, key: readonly string[]) {
  return JSON.stringify(key.map((column) => row[column] ?? null));
}

function compareKeys(x: string, y: string) {
  return x < y ? -1 : x > y ? 1 : 0;
}

function validate(doc: unknown): BackupV1 {
  if (!doc || typeof doc !== "object")
    throw new BackupFormatError("Not a cubehaus backup");
  const d = doc as Record<string, unknown>;
  if (d.format !== "cubehaus" || typeof d.version !== "number")
    throw new BackupFormatError("Not a cubehaus backup");
  if (
    d.version > 1 ||
    (typeof d.schema === "number" && d.schema > SCHEMA_VERSION)
  )
    throw new NewerBackupError("The backup is from a newer version");
  if (d.version !== 1 || typeof d.schema !== "number" || !manifest[d.schema])
    throw new BackupFormatError("Unsupported backup");
  if (!d.tables || typeof d.tables !== "object")
    throw new BackupFormatError("The backup has no tables");
  const tables = d.tables as Record<string, unknown>;
  for (const [name, { columns }] of backupTables(d.schema)) {
    const rows = tables[name] ?? [];
    if (!Array.isArray(rows))
      throw new BackupFormatError(`Table ${name} is not a list`);
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row))
        throw new BackupFormatError(`A row of ${name} is not an object`);
      const keys = Object.keys(row);
      if (
        keys.length !== columns.length ||
        !columns.every((column) => column in row)
      )
        throw new BackupFormatError(`A row of ${name} has other columns`);
      for (const value of Object.values(row))
        if (
          !(
            value === null ||
            typeof value === "string" ||
            (typeof value === "number" && Number.isSafeInteger(value))
          )
        )
          throw new BackupFormatError(`A row of ${name} has a bad value`);
    }
  }
  for (const name of Object.keys(tables))
    if (!backupTables(d.schema).some(([known]) => known === name))
      throw new BackupFormatError(`Unknown table ${name}`);
  return d as unknown as BackupV1;
}

const chunk = 300;
async function existing(
  db: Db,
  name: string,
  { key, columns }: Table,
  rows: readonly Record<string, SqlValue>[],
): Promise<Map<string, Record<string, SqlValue>>> {
  const found = new Map<string, Record<string, SqlValue>>();
  const tuple = `(${key.map(() => "?").join(", ")})`;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const matches = await db.all<Record<string, SqlValue>>(
      `SELECT ${columns.join(", ")} FROM ${name} WHERE (${key.join(", ")}) IN (VALUES ${part
        .map(() => tuple)
        .join(", ")})`,
      part.flatMap((row) => key.map((column) => row[column] ?? null)),
    );
    for (const row of matches) found.set(keyOf(row, key), row);
  }
  return found;
}

const same = (
  a: Record<string, SqlValue>,
  b: Record<string, SqlValue>,
  columns: readonly string[],
) => columns.every((column) => a[column] === b[column]);

/**
 * Restores a backup in one transaction. Into a database that holds nothing but the
 * session the app generates on first start, the backup replaces that state outright.
 * Otherwise rows merge: a missing row is added, an identical one is left, and where both
 * sides changed a row the newer edit (`updated_at`) wins, so nothing newer is lost. A
 * solve already imported here under another ID (same source and hash) is skipped.
 */
export async function restore(db: Db, doc: unknown): Promise<RestoreResult> {
  const backup = validate(doc);
  const tables = backupTables(backup.schema);
  const rowsOf = (name: string) => backup.tables[name] ?? [];

  const [counts] = await db.all<{
    solves: number;
    folders: number;
    sessions: number;
  }>(
    "SELECT (SELECT count(*) FROM solve) AS solves, (SELECT count(*) FROM folder) AS folders, (SELECT count(*) FROM session) AS sessions",
  );
  const pristine =
    !!counts &&
    counts.solves === 0 &&
    counts.folders === 0 &&
    counts.sessions <= 1;

  // References must resolve within the backup or the target before anything is written.
  const known = async (name: string, rows: Record<string, SqlValue>[]) => {
    const ids = new Set(rows.map((row) => row.id));
    if (!pristine)
      for (const { id } of await db.all<{ id: string }>(
        `SELECT id FROM ${name}`,
      ))
        ids.add(id);
    return ids;
  };
  const folders = await known("folder", rowsOf("folder"));
  const sessions = await known("session", rowsOf("session"));
  for (const session of rowsOf("session"))
    if (session.folder_id !== null && !folders.has(session.folder_id))
      throw new BackupReferenceError(
        `Session ${session.id} is in a missing folder`,
      );
  for (const solve of rowsOf("solve"))
    if (!sessions.has(solve.session_id))
      throw new BackupReferenceError(
        `Solve ${solve.id} belongs to a missing session`,
      );
  const solves = await known("solve", rowsOf("solve"));
  for (const repeat of rowsOf("solve_repeat"))
    if (!solves.has(repeat.solve_id))
      throw new BackupReferenceError(
        `Repeat ${repeat.id} belongs to a missing solve`,
      );
  for (const mapping of rowsOf("import_session"))
    if (!sessions.has(mapping.session_id))
      throw new BackupReferenceError(
        `Imported session ${mapping.source_key} points to a missing session`,
      );

  const result: RestoreResult = { inserted: 0, updated: 0, unchanged: 0 };
  const statements: Statement[] = [];
  // A pristine target's first-start rows go; tables it may already have used (the
  // trainer's, drilled before the restore) merge like any other target.
  const cleared = pristine
    ? new Set([
        "setting",
        "import_session",
        "import_seen",
        "session",
        "folder",
        "solve",
        "solve_repeat",
      ])
    : new Set<string>();
  if (pristine)
    statements.push(
      { sql: "DELETE FROM setting" },
      { sql: "DELETE FROM import_session" },
      { sql: "DELETE FROM import_seen" },
      { sql: "DELETE FROM session" },
    );

  // Imported solves already here under another ID.
  const duplicates = new Set<SqlValue>();
  if (!pristine) {
    const imported = rowsOf("solve").filter((row) => row.import_hash !== null);
    for (let i = 0; i < imported.length; i += chunk) {
      const part = imported.slice(i, i + chunk);
      const here = await db.all<{
        id: string;
        import_source: string | null;
        import_hash: string;
      }>(
        `SELECT id, import_source, import_hash FROM solve WHERE import_hash IN (${part
          .map(() => "?")
          .join(", ")})`,
        part.map((row) => row.import_hash ?? null),
      );
      const ids = new Map(
        here.map((row) => [
          `${row.import_source}\u0000${row.import_hash}`,
          row.id,
        ]),
      );
      for (const row of part) {
        const id = ids.get(`${row.import_source}\u0000${row.import_hash}`);
        if (id !== undefined && id !== row.id) duplicates.add(row.id ?? null);
      }
    }
  }

  for (const [name, table] of tables) {
    const rows = rowsOf(name);
    const here = cleared.has(name)
      ? new Map<string, Record<string, SqlValue>>()
      : await existing(db, name, table, rows);
    const { key, columns } = table;
    for (const row of rows) {
      const current = here.get(keyOf(row, key));
      if (
        (name === "solve" && duplicates.has(row.id ?? null)) ||
        // A solve here under another ID keeps its own attempts.
        (name === "solve_repeat" && duplicates.has(row.solve_id ?? null))
      ) {
        result.unchanged++;
      } else if (!current) {
        statements.push({
          sql: `INSERT INTO ${name} (${columns.join(", ")}) VALUES (${columns
            .map(() => "?")
            .join(", ")})`,
          params: columns.map((column) => row[column] ?? null),
        });
        result.inserted++;
      } else if (same(current, row, columns)) {
        result.unchanged++;
      } else if (Number(row.updated_at) > Number(current.updated_at)) {
        const rest = columns.filter((column) => !key.includes(column));
        statements.push({
          sql: `UPDATE ${name} SET ${rest.map((column) => `${column} = ?`).join(", ")} WHERE ${key
            .map((column) => `${column} = ?`)
            .join(" AND ")}`,
          params: [
            ...rest.map((column) => row[column] ?? null),
            ...key.map((column) => row[column] ?? null),
          ],
        });
        result.updated++;
      } else {
        result.unchanged++;
      }
    }
  }
  if (statements.length) await db.batch(statements);
  return result;
}
