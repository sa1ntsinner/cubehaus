import { type EventId, hasTimePenalty } from "@cubehaus/core";
import {
  type CubeTimeOptions,
  hasTwistyBackupHeader,
  ImportFormatError,
  type ImportFormatProblem,
  type ImportIssue,
  type ImportResult,
  importHash,
  parseCsTimerData,
  parseCubeDeskData,
  parseCubeTimeCsv,
  parseTwistyBackup,
} from "@cubehaus/importers";
import type {
  ImportPlan,
  ImportPlanSolve,
  ImportReview,
  Store,
} from "@cubehaus/storage";

export type CubeTimeImport = {
  files: readonly File[];
  sessions: readonly Pick<CubeTimeOptions, "name" | "event">[];
  timeZone: string;
};

export type ImportInput = File | CubeTimeImport;

export const csvIssueCodes = [
  "invalid-time",
  "invalid-date",
  "ambiguous-local-date",
  "nonexistent-local-date",
  "missing-dnf-time",
  "ambiguous-plus2",
] as const satisfies readonly ImportIssue["code"][];

export type CsvIssueCode = (typeof csvIssueCodes)[number];

export async function parseImport(input: ImportInput): Promise<ImportResult> {
  if (input instanceof File) {
    const text = await input.text();
    if (text.trimStart().startsWith("{")) {
      const parsed = parseTimerJson(text);
      if (parsed) return parsed;
    }
    if (hasTwistyBackupHeader(text)) return parseTwistyBackup(text);
    throw new ImportFormatError(
      "unsupported-shape",
      "No supported timer export shape was found.",
    );
  }

  const { files, sessions, timeZone } = input;
  if (
    files.length === 0 ||
    files.length !== sessions.length ||
    new Set(files.map(({ name }) => name)).size !== files.length
  )
    throw new ImportFormatError(
      "cubetime-selection",
      "Select distinct CubeTime CSV filenames.",
    );

  const result: ImportResult = { source: "cubetime", sessions: [], issues: [] };
  for (const [index, file] of files.entries()) {
    const session = sessions[index];
    if (!session?.name.trim())
      throw new ImportFormatError(
        "cubetime-selection",
        "Each CubeTime file needs a session name.",
      );
    const parsed = parseCubeTimeCsv(await file.text(), {
      ...session,
      name: session.name.trim(),
      timeZone,
    });
    // A file can gain rows on the next export. Its name on disk is its source key.
    // Event corrections go into a distinct session, as the store links compatible events.
    const key = JSON.stringify([file.name, session.event]);
    for (const draft of parsed.sessions)
      result.sessions.push({ ...draft, key, meta: { fileName: file.name } });
    for (const issue of parsed.issues)
      result.issues.push({ ...issue, sessionKey: key });
    result.localDates = (result.localDates ?? 0) + (parsed.localDates ?? 0);
  }
  return result;
}

function parseTimerJson(text: string): ImportResult | undefined {
  let data: Record<string, unknown>;
  try {
    // The caller has already checked for an opening object brace.
    data = JSON.parse(text);
  } catch {
    throw new ImportFormatError("json", "This file is not valid JSON.");
  }
  const sessionKeys = Object.keys(data).filter((key) =>
    /^session[0-9]+$/.test(key),
  );
  if (sessionKeys.some((key) => Array.isArray(data[key])))
    return parseCsTimerData(data);
  if (Object.hasOwn(data, "sessions") && Object.hasOwn(data, "solves"))
    return parseCubeDeskData(data);
  const { properties } = data;
  if (
    sessionKeys.length ||
    (properties !== null &&
      typeof properties === "object" &&
      Object.hasOwn(properties, "sessionData"))
  )
    return parseCsTimerData(data);
}

/** What a file holds and what importing it would add, read before anything is written. */
export interface ImportPreview {
  source: ImportResult["source"];
  sessions: { key: string; name: string; event: EventId; solves: number }[];
  /** Solves in the file. */
  solves: number;
  /** Of them, the ones not here yet. */
  added: number;
  penalized: number;
  /** Sessions the import would create. */
  created: number;
  issues: ImportIssue[];
  /** CSV dates with no offset, read in the chosen time zone. */
  localDates: number;
}

export interface ImportSummary {
  /** Sessions in the file. */
  sessions: number;
  /** Sessions the import created. */
  created: number;
  added: number;
  skipped: number;
  penalized: number;
  issues: ImportIssue[];
  /** Where the file's first session went, to show when the open session is gone. */
  firstSession: string | null;
}

export type ImportFileResult =
  | ImportSummary
  | { formatError: ImportFormatProblem };
export type ImportPreviewResult =
  | ImportPreview
  | { formatError: ImportFormatProblem };

export function previewImport(
  result: ImportResult,
  review: ImportReview,
): ImportPreview {
  const sessions = result.sessions.map(({ key, name, event, solves }) => ({
    key,
    name,
    event,
    solves: solves.length,
  }));
  return {
    source: result.source,
    sessions,
    solves: sessions.reduce((sum, { solves }) => sum + solves, 0),
    added: review.added,
    penalized: review.penalized,
    created: review.sessions.filter(({ create }) => create).length,
    issues: result.issues,
    localDates: result.localDates ?? 0,
  };
}

/** The file read against the database: nothing is written. */
export async function reviewFile(
  store: Store,
  result: ImportResult,
): Promise<ImportPreview> {
  return previewImport(
    result,
    await store.reviewImport(await importPlan(result)),
  );
}

/**
 * The parsed selection as one write. Hash occurrences across the whole csTimer file
 * to match earlier imports. Other sources count occurrences within each source session.
 */
export async function importPlan(result: ImportResult): Promise<ImportPlan> {
  const occurrences = new Map<string, number>();
  const sessions: ImportPlan["sessions"][number][] = [];
  for (const { key, name, event, solves, meta } of result.sessions) {
    const allowPlus2 = hasTimePenalty(event);
    const hashSource =
      result.source === "cstimer"
        ? result.source
        : JSON.stringify([result.source, key]);
    const planned: ImportPlanSolve[] = [];
    for (const solve of solves) {
      const identity = JSON.stringify([
        hashSource,
        event,
        solve.timeMs,
        solve.plus2,
        solve.dnf,
        solve.startedAt,
        solve.scramble,
      ]);
      const occurrence = occurrences.get(identity) ?? 0;
      occurrences.set(identity, occurrence + 1);
      // What the row held that the solve's columns do not: kept to export it back.
      const extra: Record<string, unknown> = {};
      if (solve.phases) extra.phases = solve.phases;
      if (solve.extra) extra.extra = solve.extra;
      if (solve.csv) extra.csv = solve.csv;
      if (solve.twisty) extra.twisty = solve.twisty;
      if (solve.cubedesk) extra.cubedesk = solve.cubedesk;
      if (!allowPlus2 && solve.plus2) extra.plus2 = solve.plus2;
      planned.push({
        timeMs: solve.timeMs,
        plus2: allowPlus2 ? solve.plus2 : 0,
        dnf: solve.dnf,
        scramble: solve.scramble,
        comment: solve.comment,
        startedAt: solve.startedAt,
        inspectionMs: null,
        importHash: await importHash(hashSource, event, solve, occurrence),
        importExtra: Object.keys(extra).length
          ? JSON.stringify({ v: 1, ...extra })
          : null,
      });
    }
    sessions.push({
      sourceKey: key,
      name,
      event,
      meta: JSON.stringify(meta ?? {}),
      solves: planned,
    });
  }
  return {
    source: result.source,
    sessions,
    retireStarter: true,
    ...(result.source === "cstimer" ? { penaltiesFor: ["cubetime"] } : {}),
  };
}

const pending = new WeakMap<Store, Promise<ImportSummary>>();

export function runImport(
  store: Store,
  result: ImportResult,
): Promise<ImportSummary> {
  const previous = pending.get(store);
  const current = (
    previous ? previous.catch(() => {}) : Promise.resolve()
  ).then(() => writeImport(store, result));
  pending.set(store, current);
  const clear = () => {
    if (pending.get(store) === current) pending.delete(store);
  };
  void current.then(clear, clear);
  return current;
}

async function writeImport(
  store: Store,
  result: ImportResult,
): Promise<ImportSummary> {
  const counts = await store.importBatch(await importPlan(result));
  return {
    sessions: result.sessions.length,
    created: counts.sessions,
    added: counts.added,
    skipped: counts.skipped,
    penalized: counts.penalized,
    issues: result.issues,
    firstSession: counts.sessionIds.find((id) => id !== null) ?? null,
  };
}
