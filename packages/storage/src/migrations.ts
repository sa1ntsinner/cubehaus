import type { Db } from "./db";

export const SCHEMA_VERSION = 9;
export class NewerSchemaError extends Error {}

const schemaV1 = [
  `CREATE TABLE session (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, event TEXT NOT NULL, order_key TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, deleted_at INTEGER
  ) STRICT`,
  `CREATE TABLE solve (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES session(id), event TEXT NOT NULL,
    time_ms INTEGER NOT NULL CHECK (time_ms >= 0),
    plus2 INTEGER NOT NULL DEFAULT 0 CHECK (plus2 >= 0),
    dnf INTEGER NOT NULL DEFAULT 0 CHECK (dnf IN (0, 1)),
    scramble TEXT NOT NULL, started_at INTEGER NOT NULL, inspection_ms INTEGER, comment TEXT,
    input TEXT NOT NULL, import_source TEXT, import_hash TEXT,
    updated_at INTEGER NOT NULL, deleted_at INTEGER
  ) STRICT`,
  "CREATE INDEX solve_by_session ON solve (session_id, started_at, id) WHERE deleted_at IS NULL",
  "CREATE INDEX solve_session_time ON solve (session_id, time_ms)",
  "CREATE UNIQUE INDEX solve_import ON solve (import_source, import_hash) WHERE import_hash IS NOT NULL",
  `CREATE TABLE setting (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
  ) STRICT, WITHOUT ROWID`,
];

const migrations: readonly (readonly string[])[] = [
  schemaV1,
  [
    "ALTER TABLE solve ADD COLUMN moves INTEGER",
    "ALTER TABLE solve ADD COLUMN solution TEXT",
    "ALTER TABLE solve ADD COLUMN cubes_solved INTEGER",
    "ALTER TABLE solve ADD COLUMN cubes_attempted INTEGER",
  ],
  [
    `CREATE TABLE folder (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, order_key TEXT NOT NULL,
      collapsed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, deleted_at INTEGER
    ) STRICT`,
    "ALTER TABLE session ADD COLUMN folder_id TEXT REFERENCES folder(id)",
    "CREATE INDEX session_by_folder ON session (folder_id, order_key, id)",
  ],
  [
    // Which session a source file's session went into, so a second import of the same
    // history finds it after a rename and two source sessions with one name stay apart.
    // source_meta keeps the source's own session entry for exporting it back.
    `CREATE TABLE import_session (
      source TEXT NOT NULL, source_scope TEXT NOT NULL, source_key TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES session(id), source_meta TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (source, source_scope, source_key)
    ) STRICT, WITHOUT ROWID`,
    "CREATE INDEX import_session_by_session ON import_session (session_id)",
    // What a source row held beyond the solve's own columns (split times, extra items),
    // as versioned JSON.
    "ALTER TABLE solve ADD COLUMN import_extra TEXT",
  ],
  [
    // What the trash purged for good, so a repeat import does not bring it back: a
    // solve's import identity, a timed solve's values (source 'timed'), and a source
    // session's binding (its scope and key encoded into the hash).
    `CREATE TABLE import_seen (
      source TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (source, hash)
    ) STRICT, WITHOUT ROWID`,
    // The trash, found without reading every live row.
    "CREATE INDEX solve_deleted ON solve (deleted_at) WHERE deleted_at IS NOT NULL",
    "CREATE INDEX session_deleted ON session (deleted_at) WHERE deleted_at IS NOT NULL",
  ],
  [
    // Further attempts on the scramble of a past solve. They live apart from `solve`, so
    // no series, statistic, page, count or export can take one in by mistake; the
    // scramble, session and puzzle are the root's.
    `CREATE TABLE solve_repeat (
      id TEXT PRIMARY KEY, solve_id TEXT NOT NULL REFERENCES solve(id),
      time_ms INTEGER NOT NULL CHECK (time_ms >= 0),
      plus2 INTEGER NOT NULL DEFAULT 0 CHECK (plus2 >= 0),
      dnf INTEGER NOT NULL DEFAULT 0 CHECK (dnf IN (0, 1)),
      started_at INTEGER NOT NULL, inspection_ms INTEGER, comment TEXT, input TEXT NOT NULL,
      updated_at INTEGER NOT NULL, deleted_at INTEGER
    ) STRICT`,
    "CREATE INDEX solve_repeat_by_solve ON solve_repeat (solve_id, started_at, id)",
  ],
  [
    // The algorithm trainer, apart from solves: the cases a person is learning, each with
    // its spaced-repetition card (JSON), and every trainer attempt. Nothing that reads
    // `solve` can take one in.
    `CREATE TABLE trainer_case (
      set_id TEXT NOT NULL, case_id TEXT NOT NULL, card TEXT NOT NULL,
      due_at INTEGER NOT NULL, added_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      removed_at INTEGER, PRIMARY KEY (set_id, case_id)
    ) STRICT, WITHOUT ROWID`,
    `CREATE TABLE trainer_attempt (
      id TEXT PRIMARY KEY, set_id TEXT NOT NULL, case_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('picture', 'scramble')),
      auf INTEGER NOT NULL CHECK (auf BETWEEN 0 AND 3), scramble TEXT,
      recog_ms INTEGER CHECK (recog_ms >= 0), exec_ms INTEGER NOT NULL CHECK (exec_ms >= 0),
      missed INTEGER NOT NULL DEFAULT 0 CHECK (missed IN (0, 1)),
      grade TEXT NOT NULL CHECK (grade IN ('again', 'hard', 'good', 'easy')),
      at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    ) STRICT`,
    "CREATE INDEX trainer_attempt_by_case ON trainer_attempt (set_id, case_id, at, id)",
  ],
  [
    // How a trainer attempt's recognition was marked: 0 from the picture showing to the
    // hold (or none, for a scramble), 1 split, by a press while the clock ran.
    "ALTER TABLE trainer_attempt ADD COLUMN split INTEGER NOT NULL DEFAULT 0 CHECK (split IN (0, 1))",
  ],
  [
    // The colour a 3×3 solve's cross was built on, when the app assigned one; null is
    // unknown, as for every solve made before.
    `ALTER TABLE solve ADD COLUMN cross_colour TEXT CHECK (cross_colour IN
      ('white', 'yellow', 'green', 'blue', 'red', 'orange'))`,
    // Progress by colour reads only the solves with one; without this it would look up
    // every solve of a large folder to find none.
    "CREATE INDEX solve_cross_colour ON solve (session_id, started_at, id) WHERE deleted_at IS NULL AND cross_colour IS NOT NULL",
  ],
];

/** Runs the migrations up to `target` (the current schema unless a test seeds an old one). */
export async function migrate(
  db: Db,
  target = SCHEMA_VERSION,
): Promise<number> {
  const [row] = await db.all<{ user_version: number }>("PRAGMA user_version");
  const version = row?.user_version ?? 0;
  if (version > SCHEMA_VERSION) {
    throw new NewerSchemaError(
      `Database schema ${version} is newer than ${SCHEMA_VERSION}`,
    );
  }
  for (const [index, statements] of migrations.entries()) {
    const step = index + 1;
    if (step <= version || step > target) continue;
    await db.batch([
      ...statements.map((sql) => ({ sql })),
      { sql: `PRAGMA user_version = ${step}` },
    ]);
  }
  return Math.max(version, Math.min(target, SCHEMA_VERSION));
}
