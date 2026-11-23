import { type EventId, isEventId } from "@cubehaus/core";
import { eventOfScrType, scrTypeOf } from "./cstimer-events";

type Value = string | number | null | undefined;
type Row = Record<string, string | number | null>;

/** The native backup's tables (see @cubehaus/storage), read structurally. */
export interface ExportSource {
  tables: Record<string, Row[]>;
}

/**
 * Something a row holds that the target format cannot: `whole-seconds`, the date loses
 * its milliseconds; `not-in-format`, the field is left out.
 */
export interface ExportIssue {
  id: string;
  field: string;
  reason: "whole-seconds" | "not-in-format";
}

export interface ExportResult {
  text: string;
  issues: ExportIssue[];
}

interface Session {
  id: string;
  name: string;
  event: EventId;
  meta: Record<string, unknown> | undefined;
  solves: Row[];
}

function compare(a: Value, b: Value) {
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function json(text: Value): Record<string, unknown> | undefined {
  if (typeof text !== "string") return;
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    return;
  }
}

/** What to export: every live session, or one of them. */
export interface ExportOptions {
  sessionId?: string;
}

/** Live sessions in their order, each with its live solves by date. */
function sessions(source: ExportSource, options?: ExportOptions): Session[] {
  const meta = new Map<Value, Record<string, unknown> | undefined>();
  for (const row of source.tables.import_session ?? [])
    if (row.source === "cstimer" && !meta.has(row.session_id))
      meta.set(row.session_id, json(row.source_meta));
  const byId = new Map<Value, Session>();
  const list = (source.tables.session ?? [])
    .filter(
      (row) =>
        row.deleted_at === null &&
        (options?.sessionId === undefined || row.id === options.sessionId),
    )
    .sort((a, b) => compare(a.order_key, b.order_key) || compare(a.id, b.id))
    .map((row): Session => {
      const session: Session = {
        id: String(row.id),
        name: String(row.name),
        event: isEventId(String(row.event)) ? (row.event as EventId) : "333",
        meta: meta.get(row.id),
        solves: [],
      };
      byId.set(row.id, session);
      return session;
    });
  for (const row of source.tables.solve ?? [])
    if (row.deleted_at === null) byId.get(row.session_id)?.solves.push(row);
  for (const session of list)
    session.solves.sort(
      (a, b) =>
        Number(a.started_at) - Number(b.started_at) || compare(a.id, b.id),
    );
  return list;
}

/**
 * csTimer's backup file: `sessionN` arrays of `[[penalty, ms, …splits], scramble,
 * comment, epoch seconds, …]` and the session names and options as serialized JSON. A
 * session that came from csTimer keeps its own options and type; split times and extra
 * row items kept at import go back where they were.
 */
export function encodeCsTimer(
  source: ExportSource,
  options?: ExportOptions,
): ExportResult {
  const issues: ExportIssue[] = [];
  const file: Record<string, unknown> = {};
  const sessionData: Record<string, unknown> = {};
  sessions(source, options).forEach((session, index) => {
    const n = index + 1;
    const opt = session.meta?.opt;
    const options =
      opt && typeof opt === "object" && !Array.isArray(opt)
        ? (opt as Record<string, unknown>)
        : {};
    const original =
      typeof options.scrType === "string" ? options.scrType : undefined;
    // The original type when it still reads as this puzzle, else this puzzle's own.
    const scrType =
      original !== undefined &&
      eventOfScrType(original, session.name).id === session.event
        ? original
        : scrTypeOf(session.event);
    sessionData[n] = { name: session.name, opt: { ...options, scrType } };
    file[`session${n}`] = session.solves.map((row) => {
      const id = String(row.id);
      const extra = json(row.import_extra);
      const startedAt = Number(row.started_at);
      if (startedAt % 1000 !== 0)
        issues.push({ id, field: "started_at", reason: "whole-seconds" });
      for (const field of [
        "inspection_ms",
        "moves",
        "solution",
        "cubes_solved",
        "cubes_attempted",
      ])
        if (row[field] !== null && row[field] !== undefined)
          issues.push({ id, field, reason: "not-in-format" });
      const plus2 =
        Number(row.plus2) ||
        (typeof extra?.plus2 === "number" ? extra.plus2 : 0);
      const timing = [
        Number(row.dnf) ? -1 : plus2 * 2000,
        Number(row.time_ms),
        ...(Array.isArray(extra?.phases) ? extra.phases : []),
      ];
      return [
        timing,
        String(row.scramble),
        row.comment === null ? "" : String(row.comment),
        Math.floor(startedAt / 1000),
        ...(Array.isArray(extra?.extra) ? extra.extra : []),
      ];
    });
  });
  file.properties = { sessionData: JSON.stringify(sessionData) };
  return { text: JSON.stringify(file), issues };
}

export const csvHeadings = [
  "session_id",
  "session_name",
  "event",
  "id",
  "time_ms",
  "plus2",
  "dnf",
  "started_at_utc",
  "scramble",
  "comment",
  "inspection_ms",
  "moves",
  "solution",
  "cubes_solved",
  "cubes_attempted",
] as const;

/** RFC 4180: quoted when it holds a comma, a quote or a line break. */
function cell(value: Value): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * One row per live solve, UTF-8, CRLF lines, dates in RFC 3339 UTC with milliseconds and
 * durations in whole milliseconds. Split times and source-only fields stay out.
 */
export function encodeCsv(
  source: ExportSource,
  options?: ExportOptions,
): ExportResult {
  const issues: ExportIssue[] = [];
  const lines = [csvHeadings.join(",")];
  for (const session of sessions(source, options))
    for (const row of session.solves) {
      if (row.import_extra !== null && row.import_extra !== undefined)
        issues.push({
          id: String(row.id),
          field: "import_extra",
          reason: "not-in-format",
        });
      lines.push(
        [
          session.id,
          session.name,
          session.event,
          row.id ?? null,
          row.time_ms ?? null,
          row.plus2 ?? null,
          row.dnf ?? null,
          new Date(Number(row.started_at)).toISOString(),
          row.scramble ?? null,
          row.comment ?? null,
          row.inspection_ms ?? null,
          row.moves ?? null,
          row.solution ?? null,
          row.cubes_solved ?? null,
          row.cubes_attempted ?? null,
        ]
          .map(cell)
          .join(","),
      );
    }
  return { text: `${lines.join("\r\n")}\r\n`, issues };
}
