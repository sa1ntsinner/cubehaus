import type { EventId } from "@cubehaus/core";
import { eventOfScrType } from "./cstimer-events";

export interface SolveDraft {
  timeMs: number;
  plus2: number;
  dnf: boolean;
  scramble: string;
  comment: string | null;
  startedAt: number;
  /** The row's position in its session in the file, counted from 1. */
  row: number;
  /**
   * csTimer's split times after the total, as in the file: for a multi-phase solve, the
   * time at which each earlier phase ended, latest first.
   */
  phases?: number[];
  /** Row items after the date that cubehaus does not read, kept unchanged. */
  extra?: unknown[];
  /** Original cells from a CubeTime CSV row. */
  csv?: string[];
  /** Original cells from a Twisty Timer backup row. */
  twisty?: string[];
  /** Original object from a CubeDesk solve. */
  cubedesk?: Record<string, unknown>;
}

export interface SessionDraft {
  /** The session's key in the file, such as `session3`. */
  key: string;
  name: string;
  event: EventId;
  solves: SolveDraft[];
  /** The session's own entry in the file's session data, every field kept. */
  meta?: Record<string, unknown>;
}

/**
 * Something in the file that the import handles in a way the person should know about.
 * `unknown-event`: the session's scramble type is not a puzzle cubehaus knows, so it
 * becomes a 3×3 session (`value` holds the type, absent when the file names none).
 * `invalid-row`: a row that cannot be read and is left out.
 */
export interface ImportIssue {
  sessionKey: string;
  /** The row in the session, counted from 1, or null for the whole session. */
  row: number | null;
  code:
    | "unknown-event"
    | "invalid-row"
    | "missing-session"
    | "invalid-time"
    | "invalid-date"
    | "ambiguous-local-date"
    | "nonexistent-local-date"
    | "missing-dnf-time"
    | "ambiguous-plus2";
  /** The original event type or offending CSV cell, when known. */
  value?: string;
}

export interface ImportResult {
  source: "cstimer" | "cubetime" | "twisty" | "cubedesk";
  sessions: SessionDraft[];
  issues: ImportIssue[];
  /** CSV rows whose date had no offset and were read in the chosen time zone. */
  localDates?: number;
}

/** A file or selection the picker cannot use. */
export type ImportFormatProblem =
  | "json"
  | "object"
  | "sessions"
  | "cubetime-csv"
  | "cubetime-selection"
  | "twisty-backup"
  | "cubedesk"
  | "unsupported-shape";

export class ImportFormatError extends Error {
  constructor(
    readonly problem: ImportFormatProblem,
    message: string,
  ) {
    super(message);
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
}

function sessionMetadata(value: unknown) {
  if (typeof value !== "string") return record(value);
  try {
    return record(JSON.parse(value));
  } catch {
    return undefined;
  }
}

/** Newer csTimer keeps the type in `opt.scrType`, older versions beside the name. */
function scrambleType(meta: Record<string, unknown> | undefined) {
  const nested = record(meta?.opt)?.scrType;
  if (typeof nested === "string") return nested;
  return typeof meta?.scrType === "string" ? meta.scrType : undefined;
}

function parseSolve(row: unknown, index: number): SolveDraft | undefined {
  if (!Array.isArray(row)) return;
  const [timing, scramble, comment, unixSeconds] = row;
  if (
    !Array.isArray(timing) ||
    timing.length < 2 ||
    typeof scramble !== "string" ||
    typeof comment !== "string" ||
    typeof unixSeconds !== "number"
  )
    return;

  const [penalty, timeMs, ...phases] = timing as unknown[];
  const startedAt = unixSeconds * 1000;
  if (
    !Number.isSafeInteger(startedAt) ||
    typeof timeMs !== "number" ||
    !Number.isSafeInteger(timeMs) ||
    timeMs < 0 ||
    typeof penalty !== "number" ||
    !Number.isSafeInteger(penalty) ||
    (penalty !== -1 && (penalty < 0 || penalty % 2000 !== 0)) ||
    !phases.every(
      (phase) => typeof phase === "number" && Number.isFinite(phase),
    )
  )
    return;

  const draft: SolveDraft = {
    timeMs,
    plus2: penalty === -1 ? 0 : penalty / 2000,
    dnf: penalty === -1,
    scramble,
    comment: comment === "" ? null : comment,
    startedAt,
    row: index + 1,
  };
  if (phases.length > 0) draft.phases = phases as number[];
  if (row.length > 4) draft.extra = row.slice(4);
  return draft;
}

export function parseCsTimer(text: string): ImportResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ImportFormatError("json", "This file is not valid JSON.");
  }
  return parseCsTimerData(value);
}

export function parseCsTimerData(value: unknown): ImportResult {
  const data = record(value);
  if (!data)
    throw new ImportFormatError(
      "object",
      "A csTimer export must be a JSON object.",
    );

  const entries = Object.entries(data)
    .filter(
      (entry): entry is [string, unknown[]] =>
        /^session[0-9]+$/.test(entry[0]) && Array.isArray(entry[1]),
    )
    .sort(([a], [b]) => Number(a.slice(7)) - Number(b.slice(7)));
  if (entries.length === 0)
    throw new ImportFormatError(
      "sessions",
      "This file has no csTimer session arrays.",
    );

  const metadata = sessionMetadata(record(data.properties)?.sessionData);
  const issues: ImportIssue[] = [];
  const sessions = entries.map(([key, rows]): SessionDraft => {
    const meta = record(metadata?.[key.slice(7)]);
    const label = meta?.name;
    // csTimer names a new session by its number.
    const name =
      typeof label === "string" && label.trim() !== ""
        ? label.replace(/^CubeTime Export - /, "")
        : typeof label === "number" && Number.isFinite(label)
          ? String(label)
          : key;
    const scrType = scrambleType(meta);
    const event = eventOfScrType(scrType, name);
    if (!event.known)
      issues.push(
        scrType === undefined
          ? { sessionKey: key, row: null, code: "unknown-event" }
          : {
              sessionKey: key,
              row: null,
              code: "unknown-event",
              value: scrType,
            },
      );

    const solves: SolveDraft[] = [];
    rows.forEach((row, index) => {
      const solve = parseSolve(row, index);
      if (solve) solves.push(solve);
      else
        issues.push({ sessionKey: key, row: index + 1, code: "invalid-row" });
    });
    const draft: SessionDraft = { key, name, event: event.id, solves };
    if (meta) draft.meta = meta;
    return draft;
  });
  return { source: "cstimer", sessions, issues };
}
