import { EVENTS, type EventId } from "@cubehaus/core";
import {
  ImportFormatError,
  type ImportIssue,
  type ImportResult,
  type SessionDraft,
  type SolveDraft,
} from "./cstimer";
import { duration } from "./duration";

const timedEvents = new Map<string, EventId>(
  EVENTS.filter(({ kind }) => kind === "time").map(({ id }) => [id, id]),
);

function record(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
}

function formatError(message: string) {
  return new ImportFormatError("cubedesk", message);
}

function parseSolve(
  solve: Record<string, unknown>,
  row: number,
): SolveDraft | undefined {
  const { raw_time, time, started_at, plus_two, dnf, scramble, notes } = solve;
  if (
    typeof raw_time !== "number" ||
    typeof started_at !== "number" ||
    !/^[1-9]\d{12}$/.test(String(started_at)) ||
    typeof plus_two !== "boolean" ||
    typeof dnf !== "boolean" ||
    typeof scramble !== "string" ||
    (notes != null && typeof notes !== "string")
  )
    return;

  const timeMs = duration(String(raw_time));
  if (timeMs === undefined) return;
  const plus2 = Number(plus_two);
  const effective = timeMs + 2000 * plus2;
  if (!Number.isSafeInteger(effective)) return;
  // When the file also supplies the displayed time, it must agree with the
  // raw duration and penalty. A DNF can leave the displayed time empty.
  if (
    time !== undefined &&
    !(time === null && dnf) &&
    (typeof time !== "number" || duration(String(time)) !== effective)
  )
    return;

  return {
    row,
    timeMs,
    startedAt: started_at,
    plus2,
    dnf,
    scramble,
    comment: notes || null,
    cubedesk: solve,
  };
}

type SourceSession = {
  name: string;
  meta: Record<string, unknown>;
  missing: boolean;
  /** By cubehaus event, or by the file's own puzzle name when cubehaus has none. */
  groups: Map<string, { draft: SessionDraft; rows: number }>;
};

function sessionDraft(
  id: string,
  source: SourceSession,
  event: EventId,
  unknown?: string,
): SessionDraft {
  return {
    key: JSON.stringify([id, unknown ?? event]),
    // A puzzle cubehaus has not got becomes 3×3: its name in front keeps it apart from
    // the session's own 3×3 solves.
    name: unknown ? `${unknown} ${source.name}` : source.name,
    event,
    meta: source.meta,
    solves: [],
  };
}

export function parseCubeDesk(text: string): ImportResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw formatError("This CubeDesk export is not valid JSON.");
  }
  return parseCubeDeskData(value);
}

export function parseCubeDeskData(value: unknown): ImportResult {
  const data = record(value);
  if (!Array.isArray(data?.sessions) || !Array.isArray(data.solves))
    throw formatError("Expected CubeDesk session and solve arrays.");

  const sources = new Map<string, SourceSession>();
  for (const value of data.sessions as unknown[]) {
    const meta = record(value);
    if (
      typeof meta?.id !== "string" ||
      !meta.id.trim() ||
      typeof meta.name !== "string" ||
      sources.has(meta.id)
    )
      throw formatError("Invalid or duplicate CubeDesk session entry.");
    sources.set(meta.id, {
      name: meta.name,
      meta,
      missing: false,
      groups: new Map(),
    });
  }

  const issues: ImportIssue[] = [];
  for (const [index, value] of (data.solves as unknown[]).entries()) {
    const original = record(value);
    const id = original?.session_id;
    if (!original || typeof id !== "string" || !id.trim()) {
      issues.push({ sessionKey: "", row: index + 1, code: "invalid-row" });
      continue;
    }

    let source = sources.get(id);
    if (!source) {
      source = {
        name: id,
        meta: { id, name: id },
        missing: true,
        groups: new Map(),
      };
      sources.set(id, source);
    }

    const type = original.cube_type;
    const puzzle = typeof type === "string" && type.trim() ? type : undefined;
    const known = puzzle === undefined ? undefined : timedEvents.get(puzzle);
    const event = known ?? "333";
    const unknown = known ? undefined : puzzle;
    let group = source.groups.get(unknown ?? event);
    if (!group) {
      group = { draft: sessionDraft(id, source, event, unknown), rows: 0 };
      source.groups.set(unknown ?? event, group);
      if (source.missing)
        issues.push({
          sessionKey: group.draft.key,
          row: null,
          code: "missing-session",
        });
      if (unknown !== undefined)
        issues.push({
          sessionKey: group.draft.key,
          row: null,
          code: "unknown-event",
          value: unknown,
        });
    }
    const sessionKey = group.draft.key;

    const row = ++group.rows;
    const solve = puzzle === undefined ? undefined : parseSolve(original, row);
    if (solve) group.draft.solves.push(solve);
    else issues.push({ sessionKey, row, code: "invalid-row" });
  }

  const sessions = [...sources].flatMap(([id, source]) =>
    source.groups.size
      ? [...source.groups.values()].map(({ draft }) => draft)
      : [sessionDraft(id, source, "333")],
  );
  return { source: "cubedesk", sessions, issues };
}
