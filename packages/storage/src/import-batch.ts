import { type EventId, newId, type Solve } from "@cubehaus/core";
import { generateKeyBetween } from "fractional-indexing";
import type { Db, Statement } from "./db";

/** The setting naming the session the app made on its own; it goes once an import fills the list. */
export const starterKey = "session.generatedStarter";

export type ImportPlanSolve = Omit<
  Solve,
  "id" | "sessionId" | "event" | "input"
> & {
  importHash: string;
  /** Versioned JSON of what the source row held beyond the solve's columns. */
  importExtra: string | null;
};

export interface ImportPlanSession {
  /** The session's key in the source file. */
  sourceKey: string;
  name: string;
  event: EventId;
  /** The source's own entry for the session, as JSON. */
  meta: string;
  solves: readonly ImportPlanSolve[];
}

export interface ImportPlan {
  source: string;
  /** Keeps unrelated histories from one source apart; "" for the usual one. */
  scope?: string;
  sessions: readonly ImportPlanSession[];
  /** Import sources whose clean solves can take this file's penalties. */
  penaltiesFor?: readonly string[];
  /** Remove the generated empty session if it is still untouched. */
  retireStarter?: boolean;
}

export interface ImportCounts {
  added: number;
  skipped: number;
  penalized: number;
  /** Sessions the import created. */
  sessions: number;
  /**
   * The session each source session went into, in plan order; null where none was made
   * (see `ImportReview`).
   */
  sessionIds: (string | null)[];
  removedStarter: boolean;
}

export interface ImportReview {
  /**
   * Per source session, in plan order: where it goes (null: a new session, made only
   * when `create`: never for one whose solves are all here already or purged, nor again
   * for one the trash purged that brings nothing new).
   */
  sessions: {
    target: string | null;
    create: boolean;
    added: number;
    here: number;
  }[];
  added: number;
  /** Solves already here or purged. */
  skipped: number;
  penalized: number;
}

const chunk = 500;

/** The ledger's source for solves timed here, which have no import identity. */
export const timedSource = "timed";

/**
 * A solve timed here, by its values to the second: what finds it again when a file this
 * app exported comes back, and its ledger hash once the trash purged it.
 */
export function valueKey(
  event: string,
  solve: Pick<ImportPlanSolve, "timeMs" | "plus2" | "dnf" | "scramble">,
  second: number,
): string {
  return JSON.stringify([
    event,
    solve.timeMs,
    solve.plus2,
    Number(solve.dnf),
    solve.scramble,
    second,
  ]);
}

/** A source session's binding as a ledger hash, its scope and key in one string. */
export function bindingHash(scope: string, key: string): string {
  return JSON.stringify(["session", scope, key]);
}

type Candidate = {
  id: string;
  session_id: string;
  event: string;
  time_ms: number;
  plus2: number;
  dnf: number;
  scramble: string;
  started_at: number;
  import_hash: string | null;
  import_source: string | null;
};

function rawKey(
  event: string,
  timeMs: number,
  scramble: string,
  second: number,
): string {
  return JSON.stringify([event, timeMs, scramble, second]);
}

interface Decision {
  scope: string;
  mapped: Map<string, { session_id: string; source_meta: string }>;
  events: Map<string, string>;
  orderKey: string | null;
  penalties: { row: Candidate; plus2: number; dnf: boolean }[];
  /**
   * `skip`: no session is made for it: every solve it holds is here already (or was
   * purged for good), or the trash purged the session itself and it brings nothing new.
   */
  sessions: { target: string | undefined; insert: boolean[]; skip: boolean }[];
}

/** Which of these hashes the trash purged for good under this source. */
async function retired(
  db: Db,
  source: string,
  hashes: readonly string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < hashes.length; i += chunk) {
    const part = hashes.slice(i, i + chunk);
    for (const { hash } of await db.all<{ hash: string }>(
      `SELECT hash FROM import_seen WHERE source = ? AND hash IN (${part
        .map(() => "?")
        .join(", ")})`,
      [source, ...part],
    ))
      found.add(hash);
  }
  return found;
}

/**
 * Reads what the import would do, writing nothing. A solve is already here when its
 * import identity is (hidden or moved, too), or when a solve timed here has the same
 * puzzle, time, penalties and scramble in the same second: a file this app exported,
 * imported back. Solves from another import source match by raw values, in the same
 * second or an adjacent one. Each solve here answers for one row only.
 * What the trash purged for good counts as here too (the `import_seen` ledger).
 */
async function decide(db: Db, plan: ImportPlan): Promise<Decision> {
  const scope = plan.scope ?? "";
  const events = new Map(
    (
      await db.all<{ id: string; event: string }>(
        "SELECT id, event FROM session",
      )
    ).map(({ id, event }) => [id, event]),
  );
  const [last] = await db.all<{ order_key: string | null }>(
    "SELECT MAX(order_key) AS order_key FROM session",
  );
  const mapped = new Map(
    (
      await db.all<{
        source_key: string;
        session_id: string;
        source_meta: string;
      }>(
        "SELECT source_key, session_id, source_meta FROM import_session WHERE source = ? AND source_scope = ?",
        [plan.source, scope],
      )
    ).map((row) => [row.source_key, row]),
  );

  const solves = plan.sessions.flatMap(({ solves }) => solves);
  const known = new Map<string, string>();
  for (let i = 0; i < solves.length; i += chunk) {
    const part = solves.slice(i, i + chunk).map(({ importHash }) => importHash);
    for (const row of await db.all<{ import_hash: string; session_id: string }>(
      `SELECT import_hash, session_id FROM solve WHERE import_source = ? AND import_hash IN (${part
        .map(() => "?")
        .join(", ")})`,
      [plan.source, ...part],
    ))
      known.set(row.import_hash, row.session_id);
  }

  // The ledger is read only when it holds anything: nearly always empty for a source.
  const [ledger] = await db.all<{ source: number; timed: number }>(
    `SELECT EXISTS (SELECT 1 FROM import_seen WHERE source = ?) AS source,
      EXISTS (SELECT 1 FROM import_seen WHERE source = ?) AS timed`,
    [plan.source, timedSource],
  );
  const purged = ledger?.source
    ? await retired(db, plan.source, [
        ...solves.map(({ importHash }) => importHash),
        ...plan.sessions.map(({ sourceKey }) => bindingHash(scope, sourceKey)),
      ])
    : new Set<string>();
  const purgedTimed = ledger?.timed
    ? await retired(
        db,
        timedSource,
        plan.sessions.flatMap(({ event, solves }) =>
          solves.map((solve) =>
            valueKey(event, solve, Math.floor(solve.startedAt / 1000)),
          ),
        ),
      )
    : new Set<string>();

  const timed = new Map<string, Candidate[]>();
  const other = new Map<string, Candidate[]>();
  const consumed = new Set<string>();
  function collect(map: Map<string, Candidate[]>, key: string, row: Candidate) {
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  function take(rows: Candidate[] | undefined): Candidate | undefined {
    let row = rows?.pop();
    while (row && consumed.has(row.id)) row = rows?.pop();
    // A sourced row with no hash can be in both maps.
    if (row?.import_hash === null && row.import_source !== null)
      consumed.add(row.id);
    return row;
  }
  if (solves.length) {
    let first = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;
    for (const { startedAt } of solves) {
      first = Math.min(first, startedAt);
      end = Math.max(end, startedAt);
    }
    for (const row of await db.all<Candidate>(
      `SELECT id, session_id, event, time_ms, plus2, dnf, scramble, started_at,
          import_hash, import_source FROM solve
        WHERE started_at >= ? AND started_at < ?
          AND (import_hash IS NULL OR (import_source IS NOT NULL AND import_source <> ?))
        ORDER BY started_at DESC, id DESC`,
      [
        (Math.floor(first / 1000) - 1) * 1000,
        (Math.floor(end / 1000) + 2) * 1000,
        plan.source,
      ],
    )) {
      const second = Math.floor(row.started_at / 1000);
      if (row.import_hash === null)
        collect(
          timed,
          valueKey(
            row.event,
            { ...row, timeMs: row.time_ms, dnf: row.dnf !== 0 },
            second,
          ),
          row,
        );
      if (row.import_source !== null && row.import_source !== plan.source)
        collect(
          other,
          rawKey(row.event, row.time_ms, row.scramble, second),
          row,
        );
    }
  }

  const seen = new Set<string>();
  const penalties: Decision["penalties"] = [];
  const sessions = plan.sessions.map((draft) => {
    const here: (string | undefined)[] = draft.solves.map((solve) => {
      if (seen.has(solve.importHash)) return "";
      seen.add(solve.importHash);
      const imported = known.get(solve.importHash);
      if (imported !== undefined) return imported;
      if (purged.has(solve.importHash)) return "";
      const second = Math.floor(solve.startedAt / 1000);
      const values = valueKey(draft.event, solve, second);
      const local = take(timed.get(values));
      if (local) return local.session_id;
      if (purgedTimed.has(values)) return "";
      if (other.size === 0) return undefined;

      for (const at of [second, second - 1, second + 1]) {
        const row = take(
          other.get(rawKey(draft.event, solve.timeMs, solve.scramble, at)),
        );
        if (!row) continue;
        if (
          row.import_source !== null &&
          plan.penaltiesFor?.includes(row.import_source) &&
          row.plus2 === 0 &&
          row.dnf === 0 &&
          (solve.plus2 > 0 || solve.dnf)
        )
          penalties.push({ row, plus2: solve.plus2, dnf: solve.dnf });
        return row.session_id;
      }
      return undefined;
    });
    const mapping = mapped.get(draft.sourceKey);
    let target =
      mapping && events.get(mapping.session_id) === draft.event
        ? mapping.session_id
        : undefined;
    if (target === undefined) {
      // Not imported with its key before: the session holding most of its solves.
      const votes = new Map<string, number>();
      for (const id of here)
        if (id && events.get(id) === draft.event)
          votes.set(id, (votes.get(id) ?? 0) + 1);
      let best = 0;
      for (const [id, n] of votes)
        if (n > best) {
          best = n;
          target = id;
        }
    }
    const insert = here.map((id) => id === undefined);
    return {
      target,
      insert,
      skip:
        target === undefined &&
        !insert.includes(true) &&
        (insert.length > 0 || purged.has(bindingHash(scope, draft.sourceKey))),
    };
  });
  return {
    scope,
    mapped,
    events,
    orderKey: last?.order_key ?? null,
    penalties,
    sessions,
  };
}

/** What `importBatch` would do with this plan now. */
export async function reviewImport(
  db: Db,
  plan: ImportPlan,
): Promise<ImportReview> {
  const decision = await decide(db, plan);
  const sessions = decision.sessions.map(({ target, insert, skip }) => {
    const added = insert.filter(Boolean).length;
    return {
      target: target ?? null,
      create: target === undefined && !skip,
      added,
      here: insert.length - added,
    };
  });
  return {
    sessions,
    added: sessions.reduce((sum, { added }) => sum + added, 0),
    skipped: sessions.reduce((sum, { here }) => sum + here, 0),
    penalized: decision.penalties.length,
  };
}

/**
 * Writes a whole import in one transaction: nothing of it lands unless all of it does.
 * A source session goes into the session it went into before (by its key in the source),
 * else into the session that already holds its solves, else into a new one. A solve
 * already here can take a missing penalty (see `decide`).
 */
export async function importBatch(
  db: Db,
  plan: ImportPlan,
  now: number,
): Promise<ImportCounts> {
  const decision = await decide(db, plan);
  const { scope, mapped, events } = decision;
  let { orderKey } = decision;
  const counts: ImportCounts = {
    added: 0,
    skipped: 0,
    penalized: decision.penalties.length,
    sessions: 0,
    sessionIds: [],
    removedStarter: false,
  };
  const statements: Statement[] = [];
  if (decision.penalties.length) {
    // Roll back the import if a target moved or gained a penalty before the write.
    statements.push({
      sql: "CREATE TEMP TABLE import_penalty_guard (ok INTEGER NOT NULL CHECK (ok = 1))",
    });
    for (const { row, plus2, dnf } of decision.penalties)
      statements.push(
        {
          sql: `UPDATE solve SET plus2 = ?, dnf = ?, updated_at = ?
            WHERE id = ? AND session_id = ? AND import_source = ? AND plus2 = 0 AND dnf = 0`,
          params: [
            plus2,
            Number(dnf),
            now,
            row.id,
            row.session_id,
            row.import_source,
          ],
        },
        { sql: "INSERT INTO import_penalty_guard VALUES (changes() = 1)" },
      );
    statements.push({ sql: "DROP TABLE import_penalty_guard" });
  }
  plan.sessions.forEach((draft, index) => {
    const decided = decision.sessions[index];
    if (!decided) return;
    if (decided.skip) {
      counts.sessionIds.push(null);
      counts.skipped += decided.insert.length;
      return;
    }
    let target = decided.target;
    if (target === undefined) {
      target = newId(now);
      orderKey = generateKeyBetween(orderKey, null);
      statements.push({
        sql: `INSERT INTO session (id, name, event, order_key, archived, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, ?)`,
        params: [target, draft.name, draft.event, orderKey, now, now],
      });
      events.set(target, draft.event);
      counts.sessions++;
    }
    const mapping = mapped.get(draft.sourceKey);
    if (
      !mapping ||
      mapping.session_id !== target ||
      mapping.source_meta !== draft.meta
    )
      statements.push({
        sql: `INSERT INTO import_session (source, source_scope, source_key, session_id, source_meta, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (source, source_scope, source_key) DO UPDATE SET
          session_id = excluded.session_id, source_meta = excluded.source_meta,
          updated_at = excluded.updated_at`,
        params: [plan.source, scope, draft.sourceKey, target, draft.meta, now],
      });
    counts.sessionIds.push(target);

    draft.solves.forEach((solve, i) => {
      if (!decided.insert[i]) {
        counts.skipped++;
        return;
      }
      statements.push({
        sql: `INSERT INTO solve (
          id, session_id, event, time_ms, plus2, dnf, scramble, started_at, inspection_ms,
          comment, input, import_source, import_hash, import_extra, updated_at,
          moves, solution, cubes_solved, cubes_attempted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'imported', ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          newId(solve.startedAt),
          target,
          draft.event,
          solve.timeMs,
          solve.plus2,
          Number(solve.dnf),
          solve.scramble,
          solve.startedAt,
          solve.inspectionMs,
          solve.comment,
          plan.source,
          solve.importHash,
          solve.importExtra,
          now,
          solve.moves ?? null,
          solve.solution ?? null,
          solve.cubesSolved ?? null,
          solve.cubesAttempted ?? null,
        ],
      });
      counts.added++;
    });
  });

  // The starter goes only while it is exactly as the app made it: never renamed (its
  // edit time is its creation time), no solve ever, still marked, and with another
  // session to show. Explicit choices clear the mark (see the app's state).
  let starter: string | undefined;
  if (plan.retireStarter) {
    const [marked] = await db.all<{ value: string }>(
      "SELECT value FROM setting WHERE key = ?",
      [starterKey],
    );
    starter = marked?.value;
    if (starter)
      statements.push(
        {
          sql: `DELETE FROM session WHERE id = ? AND deleted_at IS NULL AND updated_at = created_at
            AND NOT EXISTS (SELECT 1 FROM solve WHERE session_id = ?)
            AND NOT EXISTS (SELECT 1 FROM import_session WHERE session_id = ?)
            AND EXISTS (SELECT 1 FROM session WHERE id <> ? AND deleted_at IS NULL)`,
          params: [starter, starter, starter, starter],
        },
        {
          sql: "DELETE FROM setting WHERE key = ? AND value = ? AND NOT EXISTS (SELECT 1 FROM session WHERE id = ?)",
          params: [starterKey, starter, starter],
        },
      );
  }

  if (statements.length) await db.batch(statements);
  if (starter) {
    const [left] = await db.all<{ n: number }>(
      "SELECT count(*) AS n FROM session WHERE id = ?",
      [starter],
    );
    counts.removedStarter = left?.n === 0;
  }
  return counts;
}
