import {
  type EventId,
  eventInfo,
  type Folder,
  newId,
  resultValue,
  type Session,
  type Solve,
} from "@cubehaus/core";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import type { Db, Statement } from "./db";
import {
  bindingHash,
  type ImportCounts,
  type ImportPlan,
  type ImportReview,
  importBatch,
  reviewImport,
  starterKey,
  timedSource,
  valueKey,
} from "./import-batch";

/** How long the trash keeps what was deleted. */
export const trashMs = 30 * 86_400_000;

/**
 * One thing in the trash: a deleted session, or a solve deleted on its own from a session
 * that is not itself in the trash. It goes for good at `expiresAt`.
 */
export type TrashEntry = {
  id: string;
  deletedAt: number;
  expiresAt: number;
} & (
  | { kind: "session"; session: Session; count: number }
  | { kind: "solve"; solve: Solve; sessionName: string }
);

export type ImportedSolve = Solve & {
  importSource: string;
  importHash: string;
};

/** Where sessions and folders stand, as an undo puts them back. */
export interface Layout {
  sessions: readonly {
    id: string;
    folderId: string | null;
    orderKey: string;
  }[];
  folders: readonly {
    id: string;
    orderKey: string;
    collapsed: boolean;
    deleted: boolean;
  }[];
}

/** A session or a folder, as one row of the top level or of a folder. */
export interface LayoutItem {
  kind: "folder" | "session";
  id: string;
}

/** A repeat names a solve that is not in the database. */
export class RepeatError extends Error {}

export type ProgressScope =
  | { kind: "session" | "folder"; id: string; event: EventId }
  | { kind: "selection"; ids: readonly string[]; event: EventId };

export type ProgressSeries = { values: Float64Array; startedAt: Float64Array };

export interface Store {
  sessions: {
    list(): Promise<Session[]>;
    /** `starter`: the app made this session on its own; an import may remove it. */
    create(
      input: { name: string; event: EventId },
      options?: { starter?: boolean },
    ): Promise<Session>;
    /** The person chose this session: it is no longer the generated starter. */
    adopt(id: string): Promise<void>;
    /** Every session in order with its newest live solve, in one query. */
    switchRows(): Promise<(Session & { last: Solve | null })[]>;
    rename(id: string, name: string): Promise<void>;
    /** Out of the list, still found by search and counted with its puzzle. */
    setArchived(id: string, value: boolean): Promise<void>;
    /** Into the trash; its solves stay as they are, hidden with it. */
    remove(id: string): Promise<void>;
    restore(id: string): Promise<void>;
    /**
     * Moves every solve of the sources, hidden ones too, into the target, a live session
     * of their puzzle, and hides the sources (not into the trash: the receipt is their
     * way back), in one transaction; import bindings follow the solves, and a folder the
     * sources leave empty hides with them. Throws `MergeError`, changing nothing, when a
     * source is not a live session (`missing`), the target is not one or is among the
     * sources (`target`), a puzzle differs (`event`), or a source gained or lost a solve
     * between the checks and the write (`changed`).
     */
    merge(
      sourceIds: readonly string[],
      targetId: string,
    ): Promise<MergeReceipt>;
    /**
     * Puts a merge back: the sources and their folders as they were, and each moved solve
     * still in the target back in its source; what came to the target since stays.
     * `MergeError("gone")` when the receipt was used already or a source is gone.
     */
    undoMerge(receipt: MergeReceipt): Promise<void>;
    /**
     * Moves every solve before the pivot in (started_at, id) order, hidden ones too, into
     * a new session of the same puzzle named `name`, placed just before the session in
     * its folder, in one transaction; the pivot and what follows stay. With `settingKey`,
     * the session's own settings row is copied to the new one. Throws `SplitError`,
     * changing nothing, when the session is not live or the pivot is not one of its live
     * solves (`missing`), no live solve comes before the pivot (`first`), or a solve
     * before it came or went between the checks and the write (`changed`).
     */
    splitBefore(
      sessionId: string,
      pivotId: string,
      name: string,
      options?: { settingKey?: (sessionId: string) => string },
    ): Promise<SplitReceipt>;
    /**
     * Puts a split back: each moved solve still in the new session returns, and the new
     * session goes, its settings with it, unless something was added to it since.
     * `SplitError("gone")` when the receipt was used already or either session is gone.
     */
    undoSplit(receipt: SplitReceipt): Promise<void>;
  };
  trash: {
    /** What is in the trash and not yet due, newest first (solves: the newest 500). */
    list(now: number): Promise<TrashEntry[]>;
    /** Back where it was; nothing when it is no longer in the trash. */
    restore(kind: "session" | "solve", id: string): Promise<void>;
    /**
     * Removes for good what has been in the trash 30 days, in bounded transactions,
     * solves before their sessions and sessions before their folders. What an import
     * could bring back goes into the `import_seen` ledger first. Resolves to the number
     * of sessions and solves removed.
     */
    expire(now: number): Promise<number>;
  };
  /**
   * Folders and the top level are one order: folders and the sessions outside them share
   * one sequence of keys; a folder holds sessions only. Every change is one transaction,
   * checked before it writes.
   */
  folders: {
    list(): Promise<Folder[]>;
    /** A folder where the first session stood, holding the sessions in this order. */
    create(name: string, sessionIds: readonly string[]): Promise<Folder>;
    rename(id: string, name: string): Promise<void>;
    collapse(id: string, value: boolean): Promise<void>;
    /**
     * Moves a session into a folder (`parent`) or to the top level (null), or a folder
     * within the top level, before `before` (null: at the end). A folder its last session
     * leaves goes too.
     */
    place(
      item: LayoutItem,
      parent: string | null,
      before: string | null,
    ): Promise<void>;
    restoreLayout(layout: Layout): Promise<void>;
  };
  solves: {
    add(solve: Solve): Promise<void>;
    addImported(
      solves: readonly ImportedSolve[],
    ): Promise<{ added: number; skipped: number }>;
    setPenalty(
      id: string,
      penalty: { plus2: number; dnf: boolean },
    ): Promise<void>;
    setComment(id: string, comment: string | null): Promise<void>;
    /**
     * Moves live solves into another live session of their event, in one transaction:
     * only their session changes. Returns where each moved one came from (already there:
     * left out), which moved back by ID is the undo. Throws `MoveError`, moving nothing,
     * when an ID is not a live solve, the destination is not a live session, an event
     * differs, or a solve changed between the checks and the write.
     */
    move(
      ids: readonly string[],
      toSessionId: string,
    ): Promise<Array<{ id: string; from: string }>>;
    remove(id: string): Promise<void>;
    restore(id: string): Promise<void>;
    get(id: string): Promise<Solve | undefined>;
    page(
      sessionId: string,
      options: {
        limit: number;
        before?: { startedAt: number; id: string };
        atOrBefore?: number;
        offset?: number;
      },
    ): Promise<Solve[]>;
    count(sessionId: string): Promise<number>;
    getStatWindow(
      sessionId: string,
      end: { startedAt: number; id: string },
      n: number,
    ): Promise<Solve[]>;
    /**
     * The live solve next to `from` in (started_at, id) order: the one before it (-1) or
     * after it (1). Equal timestamps keep their id order.
     */
    near(
      sessionId: string,
      from: { startedAt: number; id: string },
      step: 1 | -1,
    ): Promise<Solve | undefined>;
    /** The live solves from one to another (either way round, both in), oldest first. */
    ids(
      sessionId: string,
      a: { startedAt: number; id: string },
      b: { startedAt: number; id: string },
    ): Promise<string[]>;
    series(
      sessionId: string,
    ): Promise<{ values: Float64Array; startedAt: Float64Array }>;
    scopedSeries(scope: ProgressScope): Promise<ProgressSeries>;
    progressCounts(): Promise<Record<string, number>>;
  };
  /**
   * Further attempts on a solve's scramble (`Solve.repeatOf`), written by `solves.add`.
   * They follow their root through moves, merges, splits and the trash, and count in
   * no series, statistic, page or export.
   */
  repeats: {
    /** The live repeats of a solve, oldest first, with its session, puzzle and scramble. */
    list(rootId: string): Promise<Solve[]>;
    setPenalty(
      id: string,
      penalty: { plus2: number; dnf: boolean },
    ): Promise<void>;
    setComment(id: string, comment: string | null): Promise<void>;
    remove(id: string): Promise<void>;
    restore(id: string): Promise<void>;
  };
  /**
   * The algorithm trainer: cases being learnt with their schedules, and attempts. Kept
   * apart from solves; nothing here counts in a session, statistic, progress or export
   * of solves. Only the backup carries it.
   */
  trainer: {
    /** The cases of a set being learnt (not taken out). */
    cases(setId: string): Promise<TrainerCase[]>;
    /** Adds a case to learning, or saves its schedule. */
    putCase(entry: Omit<TrainerCase, "addedAt">): Promise<void>;
    /** Takes a case out of learning; its attempts stay. */
    removeCase(setId: string, caseId: string): Promise<void>;
    /**
     * Puts a case taken out back into learning with the schedule it had; false when
     * there is none to bring back (never added, or in already).
     */
    restoreCase(setId: string, caseId: string): Promise<boolean>;
    addAttempt(attempt: TrainerAttempt): Promise<void>;
    /** Marks an attempt missed or not, with the grade that follows. */
    markAttempt(
      id: string,
      change: { missed: boolean; grade: TrainerGrade },
    ): Promise<void>;
    /** Every attempt of a set, oldest first. */
    attempts(setId: string): Promise<TrainerAttempt[]>;
  };
  settings: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    /** Several keys in one transaction. */
    setAll(values: Readonly<Record<string, string>>): Promise<void>;
  };
  /** One import, in one transaction. */
  importBatch(plan: ImportPlan): Promise<ImportCounts>;
  /** What `importBatch` would do now; writes nothing. */
  reviewImport(plan: ImportPlan): Promise<ImportReview>;
}

export type TrainerGrade = "again" | "hard" | "good" | "easy";
export interface TrainerCase {
  setId: string;
  caseId: string;
  /** The scheduler's card, as JSON. */
  card: string;
  dueAt: number;
  addedAt: number;
}
export interface TrainerAttempt {
  id: string;
  setId: string;
  caseId: string;
  /** How the case was shown: as its picture, or as a scramble to set up. */
  mode: "picture" | "scramble";
  /** The U turns the case was shown turned by. */
  auf: number;
  scramble: string | null;
  /**
   * From the picture appearing to the key going down (a picture only); or, split, from
   * the clock starting to the press that marked the case recognised.
   */
  recogMs: number | null;
  /** From the release that started the clock to the stop; split, from the mark. */
  execMs: number;
  /** Recognition marked by a press while the clock ran (schema 8); absent is false. */
  split?: boolean;
  missed: boolean;
  grade: TrainerGrade;
  at: number;
}

/** What a merge did, enough to put it back. */
export interface MergeReceipt {
  targetId: string;
  /** The sources in the order asked for, each once. */
  sources: readonly string[];
  /** When the sources were hidden: the undo finds them by it. */
  at: number;
  /** Every solve that moved, hidden ones too, and where it came from. */
  moved: readonly { id: string; from: string }[];
  /** Import bindings that pointed at a source and now point at the target. */
  bindings: readonly {
    source: string;
    scope: string;
    key: string;
    from: string;
  }[];
  /** Folders the sources left empty, hidden with them. */
  folders: readonly string[];
}

/** Why a merge, or its undo, changed nothing. */
export class MergeError extends Error {
  constructor(
    readonly reason: "missing" | "target" | "event" | "changed" | "gone",
  ) {
    super(`Merge refused: ${reason}`);
    this.name = "MergeError";
  }
}

/** What a split did, enough to put it back. */
export interface SplitReceipt {
  /** The session that was split; it keeps the pivot and what follows. */
  from: string;
  /** The new session, holding what came before the pivot. */
  sessionId: string;
  /** Every solve that moved, hidden ones too. */
  moved: readonly string[];
  /** The new session's copied settings row, if one was made. */
  settingKey: string | null;
}

/** Why a split, or its undo, changed nothing. */
export class SplitError extends Error {
  constructor(readonly reason: "missing" | "first" | "changed" | "gone") {
    super(`Split refused: ${reason}`);
    this.name = "SplitError";
  }
}

/** The setting that marks a session hidden by a merge, out of the trash's list. */
const mergedKey = (id: string) => `merged.${id}`;

/** Why a move of solves changed nothing. */
export class MoveError extends Error {
  constructor(
    readonly reason: "missing" | "destination" | "event" | "changed",
  ) {
    super(`Solves not moved: ${reason}`);
    this.name = "MoveError";
  }
}

type SessionRow = Omit<Session, "archived"> & { archived: number };
type FolderRow = Omit<Folder, "collapsed"> & { collapsed: number };
const folderFields = "id, name, order_key AS orderKey, collapsed";
type SolveRow = Omit<Solve, "dnf"> & { dnf: number };
const sessionFields =
  "id, name, event, order_key AS orderKey, folder_id AS folderId, archived, created_at AS createdAt";
const solveFields = `id, session_id AS sessionId, event, time_ms AS timeMs, plus2, dnf,
  scramble, started_at AS startedAt, inspection_ms AS inspectionMs, comment, input,
  moves, solution, cubes_solved AS cubesSolved, cubes_attempted AS cubesAttempted`;
const insertSolve = `INSERT OR IGNORE INTO solve (
  id, session_id, event, time_ms, plus2, dnf, scramble, started_at, inspection_ms,
  comment, input, import_source, import_hash, updated_at,
  moves, solution, cubes_solved, cubes_attempted
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

// Serialize compound operations across stores sharing a connection. This also
// keeps import counts and append keys correct when callers do not await writes.
const pending = new WeakMap<Db, Promise<unknown>>();

export function createStore(db: Db, now: () => number = Date.now): Store {
  function run<T>(operation: () => Promise<T>): Promise<T> {
    const result = (pending.get(db) ?? Promise.resolve()).then(operation);
    pending.set(
      db,
      result.catch(() => {}),
    );
    return result;
  }

  function insertion(
    solve: Solve,
    source: string | null = null,
    hash: string | null = null,
  ): Statement {
    return {
      sql: insertSolve,
      params: [
        solve.id,
        solve.sessionId,
        solve.event,
        solve.timeMs,
        solve.plus2,
        Number(solve.dnf),
        solve.scramble,
        solve.startedAt,
        solve.inspectionMs,
        solve.comment,
        solve.input,
        source,
        hash,
        now(),
        solve.moves ?? null,
        solve.solution ?? null,
        solve.cubesSolved ?? null,
        solve.cubesAttempted ?? null,
      ],
    };
  }

  function deletion(
    table: "session" | "solve",
    id: string,
    restore: boolean,
  ): Promise<void> {
    return run(async () => {
      const at = now();
      await db.batch([
        {
          sql: `UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`,
          params: [restore ? null : at, at, id],
        },
      ]);
    });
  }

  async function liveSessions(ids: readonly string[]) {
    const rows = await db.all<{
      id: string;
      folder_id: string | null;
      order_key: string;
    }>(
      `SELECT id, folder_id, order_key FROM session
        WHERE deleted_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`,
      [...ids],
    );
    return new Map(rows.map((row) => [row.id, row]));
  }

  /**
   * The rows of one place in key order, hidden ones included: the top level (folders and
   * the sessions outside them) or one folder's sessions.
   */
  async function scope(parent: string | null) {
    const rows = await db.all<{ id: string; key: string; deleted: number }>(
      parent === null
        ? `SELECT id, order_key AS key, deleted_at IS NOT NULL AS deleted FROM folder
          UNION ALL SELECT id, order_key, deleted_at IS NOT NULL FROM session WHERE folder_id IS NULL
          ORDER BY key, id`
        : `SELECT id, order_key AS key, deleted_at IS NOT NULL AS deleted FROM session
          WHERE folder_id = ? ORDER BY key, id`,
      parent === null ? [] : [parent],
    );
    return rows.map((row) => ({ ...row, deleted: row.deleted !== 0 }));
  }

  /** Puts a session back; a folder hidden since it left comes back with it. */
  function restoration(id: string, at: number): Statement[] {
    return [
      {
        sql: `UPDATE folder SET deleted_at = NULL, updated_at = ?
          WHERE id = (SELECT folder_id FROM session WHERE id = ? AND deleted_at IS NOT NULL)
          AND deleted_at IS NOT NULL`,
        params: [at, id],
      },
      {
        sql: "UPDATE session SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL",
        params: [at, id],
      },
    ];
  }

  /** A solve is due when it, or its session, has been in the trash since `cutoff`. */
  const dueSolve = `((deleted_at IS NOT NULL AND deleted_at <= ?)
    OR session_id IN (SELECT id FROM session WHERE deleted_at IS NOT NULL AND deleted_at <= ?))`;
  const purgeChunk = 500;

  /** One transaction of due solves, their identities into the ledger first. */
  async function purgeSolves(cutoff: number): Promise<number> {
    const rows = await db.all<{
      id: string;
      event: string;
      time_ms: number;
      plus2: number;
      dnf: number;
      scramble: string;
      started_at: number;
      import_source: string | null;
      import_hash: string | null;
    }>(
      `SELECT id, event, time_ms, plus2, dnf, scramble, started_at, import_source, import_hash
        FROM solve WHERE deleted_at IS NOT NULL AND deleted_at <= ?
        UNION SELECT id, event, time_ms, plus2, dnf, scramble, started_at, import_source, import_hash
        FROM solve WHERE session_id IN (
          SELECT id FROM session WHERE deleted_at IS NOT NULL AND deleted_at <= ?)
        LIMIT ?`,
      [cutoff, cutoff, purgeChunk],
    );
    if (rows.length === 0) return 0;
    const ids = rows.map(({ id }) => id);
    await db.batch([
      ...rows.map((row) => ({
        sql: "INSERT OR IGNORE INTO import_seen (source, hash) VALUES (?, ?)",
        params:
          row.import_hash === null
            ? [
                timedSource,
                valueKey(
                  row.event,
                  { ...row, timeMs: row.time_ms, dnf: row.dnf !== 0 },
                  Math.floor(row.started_at / 1000),
                ),
              ]
            : [row.import_source ?? "", row.import_hash],
      })),
      {
        sql: `DELETE FROM solve_repeat WHERE solve_id IN (SELECT id FROM solve
          WHERE id IN (${ids.map(() => "?").join(",")}) AND ${dueSolve})`,
        params: [...ids, cutoff, cutoff],
      },
      {
        sql: `DELETE FROM solve WHERE id IN (${ids.map(() => "?").join(",")}) AND ${dueSolve}`,
        params: [...ids, cutoff, cutoff],
      },
    ]);
    return rows.length;
  }

  /** One transaction of due sessions with no solve left, their source bindings retired. */
  async function purgeSessions(cutoff: number): Promise<number> {
    const rows = await db.all<{ id: string; folder_id: string | null }>(
      `SELECT id, folder_id FROM session WHERE deleted_at IS NOT NULL AND deleted_at <= ?
        AND NOT EXISTS (SELECT 1 FROM solve WHERE session_id = session.id) LIMIT ?`,
      [cutoff, purgeChunk],
    );
    if (rows.length === 0) return 0;
    const ids = rows.map(({ id }) => id);
    const marks = ids.map(() => "?").join(",");
    const bindings = await db.all<{
      source: string;
      source_scope: string;
      source_key: string;
    }>(
      `SELECT source, source_scope, source_key FROM import_session WHERE session_id IN (${marks})`,
      ids,
    );
    const folders = [
      ...new Set(rows.flatMap(({ folder_id }) => folder_id ?? [])),
    ];
    await db.batch([
      ...bindings.map((row) => ({
        sql: "INSERT OR IGNORE INTO import_seen (source, hash) VALUES (?, ?)",
        params: [row.source, bindingHash(row.source_scope, row.source_key)],
      })),
      {
        sql: `DELETE FROM import_session WHERE session_id IN (${marks})`,
        params: ids,
      },
      {
        sql: `DELETE FROM session WHERE id IN (${marks}) AND deleted_at IS NOT NULL
          AND deleted_at <= ? AND NOT EXISTS (SELECT 1 FROM solve WHERE session_id = session.id)`,
        params: [...ids, cutoff],
      },
      // A merge's mark goes with the session it marked.
      {
        sql: `DELETE FROM setting WHERE key LIKE 'merged.%'
          AND substr(key, 8) NOT IN (SELECT id FROM session)`,
      },
      // A folder left with no session at all can never show again.
      ...(folders.length
        ? [
            {
              sql: `DELETE FROM folder WHERE id IN (${folders.map(() => "?").join(",")})
                AND NOT EXISTS (SELECT 1 FROM session WHERE folder_id = folder.id)`,
              params: folders,
            },
          ]
        : []),
    ]);
    return rows.length;
  }

  /** The folders the given sessions leave with nothing live in them. */
  async function emptiedFolders(
    folders: readonly (string | null)[],
    leaving: readonly string[],
  ): Promise<string[]> {
    const ids = [...new Set(folders)].filter((id) => id !== null);
    if (ids.length === 0) return [];
    const kept = await db.all<{ folder_id: string }>(
      `SELECT DISTINCT folder_id FROM session WHERE deleted_at IS NULL
        AND folder_id IN (${ids.map(() => "?").join(",")})
        AND id NOT IN (${leaving.map(() => "?").join(",")})`,
      [...ids, ...leaving],
    );
    const live = new Set(kept.map(({ folder_id }) => folder_id));
    return ids.filter((id) => !live.has(id));
  }

  /** Statements that hide each folder the given sessions leave with nothing live in it. */
  async function emptied(
    folders: readonly (string | null)[],
    leaving: readonly string[],
    at: number,
  ): Promise<Statement[]> {
    return (await emptiedFolders(folders, leaving)).map((id) => ({
      sql: "UPDATE folder SET deleted_at = ?, updated_at = ? WHERE id = ?",
      params: [at, at, id],
    }));
  }

  return {
    sessions: {
      list: () =>
        run(async () =>
          (
            await db.all<SessionRow>(
              `SELECT ${sessionFields} FROM session WHERE deleted_at IS NULL ORDER BY order_key, id`,
            )
          ).map((row) => ({ ...row, archived: row.archived !== 0 })),
        ),
      create: (input, options) =>
        run(async () => {
          // Tombstones reserve their position so restoring a session never collides
          // with a key assigned while it was hidden. No deleted row is returned.
          // A folder can stand last at the top level, so its key counts too.
          const [last] = await db.all<{ order_key: string | null }>(
            `SELECT MAX(order_key) AS order_key FROM (
              SELECT order_key FROM session UNION ALL SELECT order_key FROM folder)`,
          );
          const at = now();
          const session: Session = {
            id: newId(at),
            ...input,
            orderKey: generateKeyBetween(last?.order_key ?? null, null),
            folderId: null,
            archived: false,
            createdAt: at,
          };
          await db.batch([
            {
              sql: `INSERT INTO session (id, name, event, order_key, archived, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, ?)`,
              params: [
                session.id,
                session.name,
                session.event,
                session.orderKey,
                at,
                at,
              ],
            },
            ...(options?.starter
              ? [
                  {
                    sql: `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
                    params: [starterKey, session.id, at],
                  },
                ]
              : []),
          ]);
          return session;
        }),
      switchRows: () =>
        run(async () =>
          (
            await db.all<SessionRow & { last: string | null }>(
              `SELECT ${sessionFields},
            (SELECT json_object('id', v.id, 'sessionId', v.session_id, 'event', v.event,
              'timeMs', v.time_ms, 'plus2', v.plus2, 'dnf', v.dnf, 'scramble', v.scramble,
              'startedAt', v.started_at, 'inspectionMs', v.inspection_ms, 'comment', v.comment,
              'input', v.input, 'moves', v.moves, 'solution', v.solution,
              'cubesSolved', v.cubes_solved, 'cubesAttempted', v.cubes_attempted)
              FROM solve AS v WHERE v.session_id = session.id AND v.deleted_at IS NULL
              ORDER BY v.started_at DESC, v.id DESC LIMIT 1) AS last
          FROM session WHERE deleted_at IS NULL ORDER BY order_key, id`,
            )
          ).map(({ last, ...row }) => {
            const solve = last === null ? null : (JSON.parse(last) as SolveRow);
            return {
              ...row,
              archived: row.archived !== 0,
              last: solve && { ...solve, dnf: solve.dnf !== 0 },
            };
          }),
        ),
      adopt: (id) =>
        run(() =>
          db.batch([
            {
              sql: "DELETE FROM setting WHERE key = ? AND value = ?",
              params: [starterKey, id],
            },
          ]),
        ),
      rename: (id, name) =>
        run(() =>
          db.batch([
            {
              sql: "UPDATE session SET name = ?, updated_at = ? WHERE id = ?",
              params: [name, now(), id],
            },
            // A name the person gave is a choice: the session is theirs now.
            {
              sql: "DELETE FROM setting WHERE key = ? AND value = ?",
              params: [starterKey, id],
            },
          ]),
        ),
      setArchived: (id, value) =>
        run(() =>
          db.batch([
            {
              sql: "UPDATE session SET archived = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
              params: [Number(value), now(), id],
            },
            {
              sql: "DELETE FROM setting WHERE key = ? AND value = ?",
              params: [starterKey, id],
            },
          ]),
        ),
      remove: (id) => deletion("session", id, false),
      restore: (id) => run(() => db.batch(restoration(id, now()))),
      merge: (sourceIds, targetId) =>
        run(async () => {
          const sources = [...new Set(sourceIds)];
          if (sources.includes(targetId)) throw new MergeError("target");
          if (sources.length === 0) throw new MergeError("missing");
          const marks = sources.map(() => "?").join(",");
          const live = await db.all<{
            id: string;
            event: string;
            folder_id: string | null;
          }>(
            `SELECT id, event, folder_id FROM session WHERE deleted_at IS NULL AND id IN (${marks})`,
            sources,
          );
          if (live.length !== sources.length) throw new MergeError("missing");
          const [target] = await db.all<{ event: string }>(
            "SELECT event FROM session WHERE id = ? AND deleted_at IS NULL",
            [targetId],
          );
          if (!target) throw new MergeError("target");
          if (live.some(({ event }) => event !== target.event))
            throw new MergeError("event");
          const moved = await db.all<{ id: string; from: string }>(
            `SELECT id, session_id AS "from" FROM solve WHERE session_id IN (${marks})
              ORDER BY started_at, id`,
            sources,
          );
          const bindings = await db.all<{
            source: string;
            scope: string;
            key: string;
            from: string;
          }>(
            `SELECT source, source_scope AS scope, source_key AS key, session_id AS "from"
              FROM import_session WHERE session_id IN (${marks})`,
            sources,
          );
          const folders = await emptiedFolders(
            live.map(({ folder_id }) => folder_id),
            sources,
          );
          const at = now();
          const perSource = new Map(sources.map((id) => [id, 0]));
          for (const { from } of moved)
            perSource.set(from, (perSource.get(from) ?? 0) + 1);

          // As with a move, each statement's row count must be what was read, or the
          // guard's CHECK fails and the whole merge rolls back.
          const statements: Statement[] = [
            {
              sql: "CREATE TEMP TABLE IF NOT EXISTS move_guard (ok INTEGER NOT NULL CHECK (ok = 1))",
            },
            {
              sql: `INSERT INTO move_guard VALUES ((SELECT count(*) FROM session
                WHERE id = ? AND deleted_at IS NULL AND event = ?) = 1)`,
              params: [targetId, target.event],
            },
          ];
          for (const [from, count] of perSource)
            statements.push(
              {
                sql: "UPDATE solve SET session_id = ?, updated_at = ? WHERE session_id = ?",
                params: [targetId, at, from],
              },
              {
                sql: "INSERT INTO move_guard VALUES (changes() = ?)",
                params: [count],
              },
            );
          statements.push(
            {
              sql: `UPDATE session SET deleted_at = ?, updated_at = ?
                WHERE deleted_at IS NULL AND id IN (${marks})`,
              params: [at, at, ...sources],
            },
            {
              sql: "INSERT INTO move_guard VALUES (changes() = ?)",
              params: [sources.length],
            },
            {
              sql: `UPDATE import_session SET session_id = ?, updated_at = ?
                WHERE session_id IN (${marks})`,
              params: [targetId, at, ...sources],
            },
            {
              sql: "INSERT INTO move_guard VALUES (changes() = ?)",
              params: [bindings.length],
            },
            ...folders.map((id) => ({
              sql: "UPDATE folder SET deleted_at = ?, updated_at = ? WHERE id = ?",
              params: [at, at, id],
            })),
            ...sources.map((id) => ({
              sql: `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
                ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
              params: [mergedKey(id), targetId, at],
            })),
            { sql: "DELETE FROM move_guard" },
          );
          try {
            await db.batch(statements);
          } catch (error) {
            if (String(error).includes("CHECK constraint failed"))
              throw new MergeError("changed");
            throw error;
          }
          return { targetId, sources, at, moved, bindings, folders };
        }),
      undoMerge: (receipt) =>
        run(async () => {
          const { targetId, sources, at: hiddenAt } = receipt;
          const marks = sources.map(() => "?").join(",");
          const at = now();
          const back = new Map<string, string[]>();
          for (const { id, from } of receipt.moved) {
            const list = back.get(from);
            if (list) list.push(id);
            else back.set(from, [id]);
          }
          const statements: Statement[] = [
            {
              sql: "CREATE TEMP TABLE IF NOT EXISTS move_guard (ok INTEGER NOT NULL CHECK (ok = 1))",
            },
            // Every source is still the one this merge hid.
            {
              sql: `INSERT INTO move_guard VALUES ((SELECT count(*) FROM session
                WHERE id IN (${marks}) AND deleted_at = ?) = ?)`,
              params: [...sources, hiddenAt, sources.length],
            },
            {
              sql: `UPDATE session SET deleted_at = NULL, updated_at = ?
                WHERE id IN (${marks}) AND deleted_at = ?`,
              params: [at, ...sources, hiddenAt],
            },
            ...receipt.folders.map((id) => ({
              sql: "UPDATE folder SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at = ?",
              params: [at, id, hiddenAt],
            })),
          ];
          for (const [from, ids] of back)
            for (let start = 0; start < ids.length; start += 500) {
              const part = ids.slice(start, start + 500);
              statements.push({
                sql: `UPDATE solve SET session_id = ?, updated_at = ?
                  WHERE session_id = ? AND id IN (${part.map(() => "?").join(",")})`,
                params: [from, at, targetId, ...part],
              });
            }
          statements.push(
            ...receipt.bindings.map(({ source, scope, key, from }) => ({
              sql: `UPDATE import_session SET session_id = ?, updated_at = ?
                WHERE source = ? AND source_scope = ? AND source_key = ? AND session_id = ?`,
              params: [from, at, source, scope, key, targetId],
            })),
            {
              sql: `DELETE FROM setting WHERE key IN (${marks})`,
              params: sources.map(mergedKey),
            },
            { sql: "DELETE FROM move_guard" },
          );
          try {
            await db.batch(statements);
          } catch (error) {
            if (String(error).includes("CHECK constraint failed"))
              throw new MergeError("gone");
            throw error;
          }
        }),
      splitBefore: (sessionId, pivotId, name, options) =>
        run(async () => {
          const [session] = await db.all<{
            event: EventId;
            folder_id: string | null;
            order_key: string;
          }>(
            "SELECT event, folder_id, order_key FROM session WHERE id = ? AND deleted_at IS NULL",
            [sessionId],
          );
          const [pivot] = await db.all<{ started_at: number }>(
            "SELECT started_at FROM solve WHERE id = ? AND session_id = ? AND deleted_at IS NULL",
            [pivotId, sessionId],
          );
          if (!session || !pivot) throw new SplitError("missing");
          const before = `session_id = ? AND (started_at < ? OR (started_at = ? AND id < ?))`;
          const params = [
            sessionId,
            pivot.started_at,
            pivot.started_at,
            pivotId,
          ];
          const earlier = await db.all<{ id: string; live: number }>(
            `SELECT id, deleted_at IS NULL AS live FROM solve WHERE ${before}`,
            params,
          );
          if (!earlier.some(({ live }) => live)) throw new SplitError("first");

          // Just before the session in its place; tombstones keep their keys.
          const rows = await scope(session.folder_id);
          const index = rows.findIndex(({ id }) => id === sessionId);
          const previous = rows
            .slice(0, Math.max(index, 0))
            .findLast(({ key }) => key < session.order_key);
          const at = now();
          const id = newId(at);
          const orderKey = generateKeyBetween(
            previous?.key ?? null,
            session.order_key,
          );
          const fromKey = options?.settingKey?.(sessionId);
          const toKey = options?.settingKey?.(id) ?? null;
          const statements: Statement[] = [
            {
              sql: "CREATE TEMP TABLE IF NOT EXISTS move_guard (ok INTEGER NOT NULL CHECK (ok = 1))",
            },
            {
              sql: `INSERT INTO move_guard VALUES ((SELECT count(*) FROM solve
                WHERE id = ? AND session_id = ? AND deleted_at IS NULL AND started_at = ?) = 1)`,
              params: [pivotId, sessionId, pivot.started_at],
            },
            {
              sql: `INSERT INTO session (id, name, event, order_key, folder_id, archived, created_at, updated_at)
                SELECT ?, ?, event, ?, folder_id, 0, ?, ? FROM session WHERE id = ? AND deleted_at IS NULL`,
              params: [id, name, orderKey, at, at, sessionId],
            },
            { sql: "INSERT INTO move_guard VALUES (changes() = 1)" },
            {
              sql: `UPDATE solve SET session_id = ?, updated_at = ? WHERE ${before}`,
              params: [id, at, ...params],
            },
            {
              sql: "INSERT INTO move_guard VALUES (changes() = ?)",
              params: [earlier.length],
            },
            ...(fromKey && toKey
              ? [
                  {
                    sql: `INSERT INTO setting (key, value, updated_at)
                      SELECT ?, value, ? FROM setting WHERE key = ?`,
                    params: [toKey, at, fromKey],
                  },
                ]
              : []),
            { sql: "DELETE FROM move_guard" },
          ];
          try {
            await db.batch(statements);
          } catch (error) {
            if (String(error).includes("CHECK constraint failed"))
              throw new SplitError("changed");
            throw error;
          }
          return {
            from: sessionId,
            sessionId: id,
            moved: earlier.map((row) => row.id),
            settingKey: toKey,
          };
        }),
      undoSplit: (receipt) =>
        run(async () => {
          const { from, sessionId: made, moved } = receipt;
          const at = now();
          const statements: Statement[] = [
            {
              sql: "CREATE TEMP TABLE IF NOT EXISTS move_guard (ok INTEGER NOT NULL CHECK (ok = 1))",
            },
            // Both sessions are still there, the one split live.
            {
              sql: `INSERT INTO move_guard VALUES ((SELECT count(*) FROM session
                WHERE (id = ? AND deleted_at IS NULL) OR id = ?) = 2)`,
              params: [from, made],
            },
          ];
          for (let start = 0; start < moved.length; start += 500) {
            const part = moved.slice(start, start + 500);
            statements.push({
              sql: `UPDATE solve SET session_id = ?, updated_at = ?
                WHERE session_id = ? AND id IN (${part.map(() => "?").join(",")})`,
              params: [from, at, made, ...part],
            });
          }
          statements.push(
            // A session given solves since stays with them.
            {
              sql: `DELETE FROM session WHERE id = ?
                AND NOT EXISTS (SELECT 1 FROM solve WHERE session_id = ?)`,
              params: [made, made],
            },
            ...(receipt.settingKey
              ? [
                  {
                    sql: `DELETE FROM setting WHERE key = ?
                      AND NOT EXISTS (SELECT 1 FROM session WHERE id = ?)`,
                    params: [receipt.settingKey, made],
                  },
                ]
              : []),
            { sql: "DELETE FROM move_guard" },
          );
          try {
            await db.batch(statements);
          } catch (error) {
            if (String(error).includes("CHECK constraint failed"))
              throw new SplitError("gone");
            throw error;
          }
        }),
    },
    trash: {
      list: (at) =>
        run(async () => {
          const cutoff = at - trashMs;
          const sessions = await db.all<
            SessionRow & { deletedAt: number; count: number }
          >(
            `SELECT ${sessionFields}, deleted_at AS deletedAt,
              (SELECT count(*) FROM solve WHERE session_id = session.id AND deleted_at IS NULL) AS count
              FROM session WHERE deleted_at IS NOT NULL AND deleted_at > ?
              AND NOT EXISTS (SELECT 1 FROM setting WHERE key = 'merged.' || session.id)`,
            [cutoff],
          );
          const solves = await db.all<
            SolveRow & { deletedAt: number; sessionName: string }
          >(
            `SELECT ${solveFields}, deleted_at AS deletedAt,
              (SELECT name FROM session WHERE id = solve.session_id) AS sessionName
              FROM solve WHERE deleted_at IS NOT NULL AND deleted_at > ?
              AND session_id IN (SELECT id FROM session WHERE deleted_at IS NULL)
              ORDER BY deleted_at DESC, id DESC LIMIT 500`,
            [cutoff],
          );
          const entries: TrashEntry[] = [
            ...sessions.map(({ deletedAt, count, ...row }) => ({
              kind: "session" as const,
              id: row.id,
              deletedAt,
              expiresAt: deletedAt + trashMs,
              session: { ...row, archived: row.archived !== 0 },
              count,
            })),
            ...solves.map(({ deletedAt, sessionName, ...row }) => ({
              kind: "solve" as const,
              id: row.id,
              deletedAt,
              expiresAt: deletedAt + trashMs,
              solve: { ...row, dnf: row.dnf !== 0 },
              sessionName,
            })),
          ];
          return entries.sort(
            (a, b) =>
              b.deletedAt - a.deletedAt ||
              (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
          );
        }),
      restore: (kind, id) =>
        run(() =>
          db.batch(
            kind === "session"
              ? restoration(id, now())
              : [
                  {
                    sql: "UPDATE solve SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL",
                    params: [now(), id],
                  },
                ],
          ),
        ),
      expire: async (at) => {
        const cutoff = at - trashMs;
        let total = 0;
        // Each batch is its own transaction, so timing and edits go on in between.
        for (const purge of [purgeSolves, purgeSessions])
          for (;;) {
            const n = await run(() => purge(cutoff));
            if (n === 0) break;
            total += n;
          }
        await run(() =>
          db.batch([
            {
              sql: "DELETE FROM solve_repeat WHERE deleted_at IS NOT NULL AND deleted_at <= ?",
              params: [cutoff],
            },
            {
              sql: `DELETE FROM folder WHERE deleted_at IS NOT NULL AND deleted_at <= ?
                AND NOT EXISTS (SELECT 1 FROM session WHERE folder_id = folder.id)`,
              params: [cutoff],
            },
          ]),
        );
        return total;
      },
    },
    folders: {
      list: () =>
        run(async () =>
          (
            await db.all<FolderRow>(
              `SELECT ${folderFields} FROM folder WHERE deleted_at IS NULL ORDER BY order_key, id`,
            )
          ).map((row) => ({ ...row, collapsed: row.collapsed !== 0 })),
        ),
      create: (name, sessionIds) =>
        run(async () => {
          if (!name.trim() || sessionIds.length === 0)
            throw new RangeError("A folder needs a name and a session");
          const rows = await liveSessions(sessionIds);
          const first = rows.get(sessionIds[0] ?? "");
          if (!first || rows.size !== new Set(sessionIds).size)
            throw new RangeError("A folder holds live sessions only");
          // Where the first session stood: its own key at the top level, or just after
          // the folder it was in (folders do not nest).
          let orderKey = first.order_key;
          if (first.folder_id !== null) {
            const top = await scope(null);
            const host = top.find(({ id }) => id === first.folder_id);
            const next = top.find(
              ({ key }) => host !== undefined && key > host.key,
            );
            orderKey = generateKeyBetween(host?.key ?? null, next?.key ?? null);
          }
          const at = now();
          const folder: Folder = {
            id: newId(at),
            name: name.trim(),
            orderKey,
            collapsed: false,
          };
          const keys = generateNKeysBetween(null, null, sessionIds.length);
          await db.batch([
            {
              sql: `INSERT INTO folder (id, name, order_key, collapsed, created_at, updated_at)
          VALUES (?, ?, ?, 0, ?, ?)`,
              params: [folder.id, folder.name, folder.orderKey, at, at],
            },
            ...sessionIds.map((id, index) => ({
              sql: "UPDATE session SET folder_id = ?, order_key = ?, updated_at = ? WHERE id = ?",
              params: [folder.id, keys[index] ?? null, at, id],
            })),
            ...(await emptied(
              [...rows.values()].map(({ folder_id }) => folder_id),
              sessionIds,
              at,
            )),
          ]);
          return folder;
        }),
      rename: (id, name) =>
        run(() =>
          db.batch([
            {
              sql: "UPDATE folder SET name = ?, updated_at = ? WHERE id = ?",
              params: [name, now(), id],
            },
          ]),
        ),
      collapse: (id, value) =>
        run(() =>
          db.batch([
            {
              sql: "UPDATE folder SET collapsed = ?, updated_at = ? WHERE id = ?",
              params: [Number(value), now(), id],
            },
          ]),
        ),
      place: (item, parent, before) =>
        run(async () => {
          if (item.kind === "folder" && parent !== null)
            throw new RangeError("Folders do not nest");
          const [row] = await db.all<{ folder_id: string | null }>(
            item.kind === "folder"
              ? "SELECT NULL AS folder_id FROM folder WHERE id = ? AND deleted_at IS NULL"
              : "SELECT folder_id FROM session WHERE id = ? AND deleted_at IS NULL",
            [item.id],
          );
          if (!row) throw new RangeError(`No ${item.kind} ${item.id}`);
          if (parent !== null) {
            const [folder] = await db.all(
              "SELECT id FROM folder WHERE id = ? AND deleted_at IS NULL",
              [parent],
            );
            if (!folder) throw new RangeError(`No folder ${parent}`);
          }
          if (before === item.id) return;
          const siblings = (await scope(parent)).filter(
            ({ id }) => id !== item.id,
          );
          let low: string | null = null;
          let high: string | null = null;
          if (before === null) {
            low = siblings.at(-1)?.key ?? null;
          } else {
            const next = siblings.find(({ id }) => id === before);
            if (!next || next.deleted)
              throw new RangeError(`${before} is not in that place`);
            high = next.key;
            // Hidden rows keep their keys, so one restored later finds its place free.
            low =
              siblings.filter(({ key }) => key < next.key).at(-1)?.key ?? null;
          }
          const at = now();
          const orderKey = generateKeyBetween(low, high);
          await db.batch([
            item.kind === "folder"
              ? {
                  sql: "UPDATE folder SET order_key = ?, updated_at = ? WHERE id = ?",
                  params: [orderKey, at, item.id],
                }
              : {
                  sql: "UPDATE session SET folder_id = ?, order_key = ?, updated_at = ? WHERE id = ?",
                  params: [parent, orderKey, at, item.id],
                },
            ...(item.kind === "session" && row.folder_id !== parent
              ? await emptied([row.folder_id], [item.id], at)
              : []),
          ]);
        }),
      restoreLayout: (layout) =>
        run(async () => {
          const at = now();
          await db.batch([
            ...layout.folders.map(({ id, orderKey, collapsed, deleted }) => ({
              sql: `UPDATE folder SET order_key = ?, collapsed = ?,
          deleted_at = CASE WHEN ? THEN coalesce(deleted_at, ?) END, updated_at = ? WHERE id = ?`,
              params: [
                orderKey,
                Number(collapsed),
                Number(deleted),
                at,
                at,
                id,
              ],
            })),
            ...layout.sessions.map(({ id, folderId, orderKey }) => ({
              sql: "UPDATE session SET folder_id = ?, order_key = ?, updated_at = ? WHERE id = ?",
              params: [folderId, orderKey, at, id],
            })),
          ]);
        }),
    },
    solves: {
      add: (solve) =>
        run(async () => {
          if (solve.repeatOf === undefined) {
            await db.batch([insertion(solve)]);
            return;
          }
          const [root] = await db.all<{ id: string }>(
            "SELECT id FROM solve WHERE id = ?",
            [solve.repeatOf],
          );
          if (!root)
            throw new RepeatError(`No solve ${solve.repeatOf} to repeat`);
          await db.batch([
            {
              sql: `INSERT OR IGNORE INTO solve_repeat (id, solve_id, time_ms, plus2, dnf,
                started_at, inspection_ms, comment, input, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              params: [
                solve.id,
                solve.repeatOf,
                solve.timeMs,
                solve.plus2,
                Number(solve.dnf),
                solve.startedAt,
                solve.inspectionMs,
                solve.comment,
                solve.input,
                now(),
              ],
            },
          ]);
        }),
      addImported: (solves) =>
        run(async () => {
          let added = 0;
          let skipped = 0;
          for (let offset = 0; offset < solves.length; offset += 5000) {
            // total_changes includes hidden rows and remains independent of session
            // filters; INSERT OR IGNORE contributes zero for either unique key.
            const [before] = await db.all<{ n: number }>(
              "SELECT total_changes() AS n",
            );
            const chunk = solves.slice(offset, offset + 5000);
            await db.batch(
              chunk.map((solve) =>
                insertion(solve, solve.importSource, solve.importHash),
              ),
            );
            const [after] = await db.all<{ n: number }>(
              "SELECT total_changes() AS n",
            );
            const inserted = (after?.n ?? 0) - (before?.n ?? 0);
            added += inserted;
            // Count matching import identities, including hidden rows and repeated
            // identities in this chunk. Unrelated id conflicts are not duplicates.
            const [matched] = await db.all<{ n: number }>(
              `WITH incoming(source, hash) AS (VALUES ${chunk.map(() => "(?, ?)").join(",")})
                SELECT count(*) AS n FROM incoming JOIN solve
                ON solve.import_source = incoming.source AND solve.import_hash = incoming.hash`,
              chunk.flatMap((solve) => [solve.importSource, solve.importHash]),
            );
            skipped += (matched?.n ?? 0) - inserted;
          }
          return { added, skipped };
        }),
      setPenalty: (id, penalty) =>
        run(() =>
          db.batch([
            {
              sql: "UPDATE solve SET plus2 = ?, dnf = ?, updated_at = ? WHERE id = ?",
              params: [penalty.plus2, Number(penalty.dnf), now(), id],
            },
          ]),
        ),
      setComment: (id, comment) =>
        run(() =>
          db.batch([
            {
              sql: "UPDATE solve SET comment = ?, updated_at = ? WHERE id = ?",
              params: [comment, now(), id],
            },
          ]),
        ),
      move: (ids, to) =>
        run(async () => {
          const unique = [...new Set(ids)];
          if (unique.length === 0) return [];
          const found: { id: string; sessionId: string; event: string }[] = [];
          for (let at = 0; at < unique.length; at += 500) {
            const part = unique.slice(at, at + 500);
            found.push(
              ...(await db.all<{
                id: string;
                sessionId: string;
                event: string;
              }>(
                `SELECT id, session_id AS sessionId, event FROM solve
                  WHERE deleted_at IS NULL AND id IN (${part.map(() => "?").join(",")})`,
                part,
              )),
            );
          }
          if (found.length !== unique.length) throw new MoveError("missing");
          const [destination] = await db.all<{ event: string }>(
            "SELECT event FROM session WHERE id = ? AND deleted_at IS NULL",
            [to],
          );
          if (!destination) throw new MoveError("destination");
          if (found.some((row) => row.event !== destination.event))
            throw new MoveError("event");
          // In the order asked for, those not already there.
          const byId = new Map(found.map((row) => [row.id, row]));
          const moving = unique.flatMap((id) => {
            const row = byId.get(id);
            return row && row.sessionId !== to
              ? [{ id, from: row.sessionId }]
              : [];
          });
          if (moving.length === 0) return [];

          // The checks hold inside the write: each statement's row count must match, or
          // the CHECK on the guard row fails and the transaction rolls back.
          const at = now();
          const statements: Statement[] = [
            {
              sql: "CREATE TEMP TABLE IF NOT EXISTS move_guard (ok INTEGER NOT NULL CHECK (ok = 1))",
            },
            {
              sql: `INSERT INTO move_guard VALUES ((SELECT count(*) FROM session
                WHERE id = ? AND deleted_at IS NULL AND event = ?) = 1)`,
              params: [to, destination.event],
            },
          ];
          const bySource = new Map<string, typeof moving>();
          for (const entry of moving) {
            const list = bySource.get(entry.from);
            if (list) list.push(entry);
            else bySource.set(entry.from, [entry]);
          }
          for (const [from, entries] of bySource) {
            for (let start = 0; start < entries.length; start += 500) {
              const part = entries
                .slice(start, start + 500)
                .map(({ id }) => id);
              statements.push(
                {
                  sql: `UPDATE solve SET session_id = ?, updated_at = ?
                    WHERE deleted_at IS NULL AND session_id = ? AND event = ?
                    AND id IN (${part.map(() => "?").join(",")})`,
                  params: [to, at, from, destination.event, ...part],
                },
                {
                  sql: "INSERT INTO move_guard VALUES (changes() = ?)",
                  params: [part.length],
                },
              );
            }
          }
          statements.push({ sql: "DELETE FROM move_guard" });
          try {
            await db.batch(statements);
          } catch (error) {
            if (String(error).includes("CHECK constraint failed"))
              throw new MoveError("changed");
            throw error;
          }
          return moving;
        }),
      remove: (id) => deletion("solve", id, false),
      restore: (id) => deletion("solve", id, true),
      get: (id) =>
        run(async () => {
          const [row] = await db.all<SolveRow>(
            `SELECT ${solveFields} FROM solve WHERE id = ? AND deleted_at IS NULL`,
            [id],
          );
          return row && { ...row, dnf: row.dnf !== 0 };
        }),
      page: (sessionId, { limit, before, atOrBefore, offset = 0 }) =>
        run(async () =>
          (
            await db.all<SolveRow>(
              `SELECT ${solveFields}, (SELECT count(*) FROM solve_repeat
            WHERE solve_repeat.solve_id = solve.id AND solve_repeat.deleted_at IS NULL) AS repeats
          FROM solve WHERE session_id = ? AND deleted_at IS NULL
          ${before ? "AND (started_at, id) < (?, ?)" : ""}
          ${atOrBefore === undefined ? "" : "AND started_at <= ?"}
          ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?`,
              [
                sessionId,
                ...(before ? [before.startedAt, before.id] : []),
                ...(atOrBefore === undefined ? [] : [atOrBefore]),
                limit,
                offset,
              ],
            )
          ).map(({ repeats, ...row }) =>
            repeats
              ? { ...row, dnf: row.dnf !== 0, repeats }
              : { ...row, dnf: row.dnf !== 0 },
          ),
        ),
      near: (sessionId, from, step) =>
        run(async () => {
          const [row] = await db.all<SolveRow>(
            `SELECT ${solveFields} FROM solve WHERE session_id = ? AND deleted_at IS NULL
              AND (started_at, id) ${step < 0 ? "<" : ">"} (?, ?)
              ORDER BY started_at ${step < 0 ? "DESC" : "ASC"}, id ${step < 0 ? "DESC" : "ASC"}
              LIMIT 1`,
            [sessionId, from.startedAt, from.id],
          );
          return row && { ...row, dnf: row.dnf !== 0 };
        }),
      getStatWindow: (sessionId, end, n) =>
        run(async () => {
          if (!Number.isSafeInteger(n) || n < 1) return [];
          const rows = await db.all<SolveRow>(
            `SELECT ${solveFields} FROM solve WHERE session_id = ? AND deleted_at IS NULL
              AND (started_at, id) <= (?, ?)
              ORDER BY started_at DESC, id DESC LIMIT ?`,
            [sessionId, end.startedAt, end.id, n],
          );
          const newest = rows[0];
          if (newest?.id !== end.id || newest.startedAt !== end.startedAt)
            return [];
          return rows.reverse().map((row) => ({ ...row, dnf: row.dnf !== 0 }));
        }),
      ids: (sessionId, a, b) =>
        run(async () => {
          const [low, high] =
            a.startedAt < b.startedAt ||
            (a.startedAt === b.startedAt && a.id <= b.id)
              ? [a, b]
              : [b, a];
          const rows = await db.all<{ id: string }>(
            `SELECT id FROM solve WHERE session_id = ? AND deleted_at IS NULL
              AND (started_at, id) >= (?, ?) AND (started_at, id) <= (?, ?)
              ORDER BY started_at, id`,
            [sessionId, low.startedAt, low.id, high.startedAt, high.id],
          );
          return rows.map(({ id }) => id);
        }),
      count: (sessionId) =>
        run(async () => {
          const [row] = await db.all<{ n: number }>(
            "SELECT count(*) AS n FROM solve WHERE session_id = ? AND deleted_at IS NULL",
            [sessionId],
          );
          return row?.n ?? 0;
        }),
      progressCounts: () =>
        run(async () =>
          Object.fromEntries(
            // The partial chronological index covers this count. Counting per
            // session through a subquery read every row from the table.
            (
              await db.all<{ id: string; count: number }>(
                `SELECT session_id AS id, count(*) AS count
                 FROM solve INDEXED BY solve_by_session
                 WHERE deleted_at IS NULL GROUP BY session_id`,
              )
            ).map(({ id, count }) => [id, count]),
          ),
        ),
      scopedSeries: (scope) =>
        run(async () => {
          const membership =
            scope.kind === "session"
              ? "id = ?"
              : scope.kind === "folder"
                ? "folder_id = ? AND EXISTS (SELECT 1 FROM folder WHERE folder.id = session.folder_id AND folder.deleted_at IS NULL)"
                : "id IN (SELECT value FROM json_each(?))";
          const sessions = await db.all<{ id: string }>(
            `SELECT id FROM session WHERE deleted_at IS NULL AND event = ? AND ${membership}`,
            [
              scope.event,
              scope.kind === "selection" ? JSON.stringify(scope.ids) : scope.id,
            ],
          );
          if (!sessions.length)
            return {
              values: new Float64Array(),
              startedAt: new Float64Array(),
            };
          // One session reads its chronological index. Several sessions read the
          // table in the order it was written and sort once: following each
          // session's index through interleaved rows jumps across the whole file,
          // and a subquery lets SQLite pick the (session_id, time_ms) index and
          // fetch the rows in time order. Both took seconds on OPFS at 100,000.
          const where = `FROM solve ${sessions.length === 1 ? "INDEXED BY solve_by_session" : "NOT INDEXED"}
            WHERE deleted_at IS NULL AND session_id IN (${sessions.map(() => "?").join(",")})
            ORDER BY started_at, id`;
          const params = sessions.map(({ id }) => id);
          if (eventInfo(scope.event).kind === "time") {
            const [
              values = new Float64Array(),
              startedAt = new Float64Array(),
            ] = await db.columns(
              `SELECT CASE WHEN dnf = 1 THEN 1e999 ELSE time_ms + 2000 * plus2 END, started_at ${where}`,
              params,
            );
            return { values, startedAt };
          }
          const rows = await db.all<SolveRow>(
            `SELECT ${solveFields} ${where}`,
            params,
          );
          return {
            values: Float64Array.from(rows, (row) =>
              resultValue({ ...row, event: scope.event, dnf: row.dnf !== 0 }),
            ),
            startedAt: Float64Array.from(rows, (row) => row.startedAt),
          };
        }),
      series: (sessionId) =>
        run(async () => {
          const [session] = await db.all<{ event: EventId }>(
            "SELECT event FROM session WHERE id = ?",
            [sessionId],
          );
          if (session && eventInfo(session.event).kind !== "time") {
            const rows = await db.all<SolveRow>(
              `SELECT ${solveFields} FROM solve WHERE session_id = ? AND deleted_at IS NULL ORDER BY started_at, id`,
              [sessionId],
            );
            return {
              values: Float64Array.from(rows, (row) =>
                resultValue({
                  ...row,
                  event: session.event,
                  dnf: row.dnf !== 0,
                }),
              ),
              startedAt: Float64Array.from(rows, (row) => row.startedAt),
            };
          }
          const [values = new Float64Array(), startedAt = new Float64Array()] =
            await db.columns(
              `SELECT CASE WHEN dnf = 1 THEN 1e999 ELSE time_ms + 2000 * plus2 END, started_at
            FROM solve WHERE session_id = ? AND deleted_at IS NULL ORDER BY started_at, id`,
              [sessionId],
            );
          return { values, startedAt };
        }),
    },
    repeats: {
      list: (rootId) =>
        run(async () =>
          (
            await db.all<SolveRow & { repeatOf: string }>(
              `SELECT solve_repeat.id, solve.session_id AS sessionId, solve.event,
                solve_repeat.time_ms AS timeMs, solve_repeat.plus2, solve_repeat.dnf,
                solve.scramble, solve_repeat.started_at AS startedAt,
                solve_repeat.inspection_ms AS inspectionMs, solve_repeat.comment,
                solve_repeat.input, solve_repeat.solve_id AS repeatOf
              FROM solve_repeat JOIN solve ON solve.id = solve_repeat.solve_id
              WHERE solve_repeat.solve_id = ? AND solve_repeat.deleted_at IS NULL
                AND solve.deleted_at IS NULL
              ORDER BY solve_repeat.started_at, solve_repeat.id`,
              [rootId],
            )
          ).map((row) => ({ ...row, dnf: row.dnf !== 0 })),
        ),
      setPenalty: (id, penalty) =>
        run(() =>
          db.batch([
            {
              sql: "UPDATE solve_repeat SET plus2 = ?, dnf = ?, updated_at = ? WHERE id = ?",
              params: [penalty.plus2, Number(penalty.dnf), now(), id],
            },
          ]),
        ),
      setComment: (id, comment) =>
        run(() =>
          db.batch([
            {
              sql: "UPDATE solve_repeat SET comment = ?, updated_at = ? WHERE id = ?",
              params: [comment, now(), id],
            },
          ]),
        ),
      remove: (id) =>
        run(() => {
          const at = now();
          return db.batch([
            {
              sql: "UPDATE solve_repeat SET deleted_at = ?, updated_at = ? WHERE id = ?",
              params: [at, at, id],
            },
          ]);
        }),
      restore: (id) =>
        run(() =>
          db.batch([
            {
              sql: "UPDATE solve_repeat SET deleted_at = NULL, updated_at = ? WHERE id = ?",
              params: [now(), id],
            },
          ]),
        ),
    },
    trainer: {
      cases: (setId) =>
        run(async () =>
          (
            await db.all<{
              setId: string;
              caseId: string;
              card: string;
              dueAt: number;
              addedAt: number;
            }>(
              `SELECT set_id AS setId, case_id AS caseId, card, due_at AS dueAt,
                added_at AS addedAt
              FROM trainer_case WHERE set_id = ? AND removed_at IS NULL
              ORDER BY added_at, case_id`,
              [setId],
            )
          ).map((row) => ({ ...row })),
        ),
      putCase: (entry) =>
        run(() => {
          const at = now();
          return db.batch([
            {
              sql: `INSERT INTO trainer_case (set_id, case_id, card, due_at, added_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(set_id, case_id) DO UPDATE SET card = excluded.card,
                  due_at = excluded.due_at, updated_at = excluded.updated_at,
                  added_at = CASE WHEN trainer_case.removed_at IS NULL
                    THEN trainer_case.added_at ELSE excluded.added_at END,
                  removed_at = NULL`,
              params: [
                entry.setId,
                entry.caseId,
                entry.card,
                entry.dueAt,
                at,
                at,
              ],
            },
          ]);
        }),
      removeCase: (setId, caseId) =>
        run(() => {
          const at = now();
          return db.batch([
            {
              sql: "UPDATE trainer_case SET removed_at = ?, updated_at = ? WHERE set_id = ? AND case_id = ?",
              params: [at, at, setId, caseId],
            },
          ]);
        }),
      restoreCase: (setId, caseId) =>
        run(async () => {
          const found = await db.all<{ one: number }>(
            `SELECT 1 AS one FROM trainer_case
              WHERE set_id = ? AND case_id = ? AND removed_at IS NOT NULL`,
            [setId, caseId],
          );
          if (found.length === 0) return false;
          const at = now();
          await db.batch([
            {
              sql: `UPDATE trainer_case SET removed_at = NULL, added_at = ?, updated_at = ?
                WHERE set_id = ? AND case_id = ?`,
              params: [at, at, setId, caseId],
            },
          ]);
          return true;
        }),
      addAttempt: (a) =>
        run(() =>
          db.batch([
            {
              sql: `INSERT INTO trainer_attempt (id, set_id, case_id, mode, auf, scramble,
                recog_ms, exec_ms, missed, grade, at, updated_at, split)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              params: [
                a.id,
                a.setId,
                a.caseId,
                a.mode,
                a.auf,
                a.scramble,
                a.recogMs,
                a.execMs,
                Number(a.missed),
                a.grade,
                a.at,
                now(),
                Number(a.split ?? false),
              ],
            },
          ]),
        ),
      markAttempt: (id, change) =>
        run(() =>
          db.batch([
            {
              sql: "UPDATE trainer_attempt SET missed = ?, grade = ?, updated_at = ? WHERE id = ?",
              params: [Number(change.missed), change.grade, now(), id],
            },
          ]),
        ),
      attempts: (setId) =>
        run(async () =>
          (
            await db.all<
              Omit<TrainerAttempt, "missed" | "mode" | "grade" | "split"> & {
                missed: number;
                split: number;
                mode: string;
                grade: string;
              }
            >(
              `SELECT id, set_id AS setId, case_id AS caseId, mode, auf, scramble,
                recog_ms AS recogMs, exec_ms AS execMs, missed, grade, at, split
              FROM trainer_attempt WHERE set_id = ? ORDER BY at, id`,
              [setId],
            )
          ).map((row) => ({
            ...row,
            mode: row.mode as TrainerAttempt["mode"],
            grade: row.grade as TrainerGrade,
            missed: row.missed !== 0,
            split: row.split !== 0,
          })),
        ),
    },
    settings: {
      get: (key) =>
        run(async () => {
          const [row] = await db.all<{ value: string }>(
            "SELECT value FROM setting WHERE key = ?",
            [key],
          );
          return row?.value ?? null;
        }),
      set: (key, value) =>
        run(() =>
          db.batch([
            {
              sql: `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
              params: [key, value, now()],
            },
          ]),
        ),
      setAll: (values) =>
        run(() => {
          const at = now();
          return db.batch(
            Object.entries(values).map(([key, value]) => ({
              sql: `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
              params: [key, value, at],
            })),
          );
        }),
    },
    importBatch: (plan) => run(() => importBatch(db, plan, now())),
    reviewImport: (plan) => run(() => reviewImport(db, plan)),
  };
}
