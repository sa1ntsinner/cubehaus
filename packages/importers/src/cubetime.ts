import type { EventId } from "@cubehaus/core";
import {
  ImportFormatError,
  type ImportIssue,
  type ImportResult,
  type SolveDraft,
} from "./cstimer";
import { readDelimited } from "./delimited";
import { duration } from "./duration";

export interface CubeTimeOptions {
  name: string;
  event: EventId;
  timeZone: string;
}

const headings = ["Time", "Comment", "Scramble", "Date"];

const hour = 3_600_000;
const day = 24 * hour;

function offsetMs(offset: string): number | undefined {
  if (offset === "Z" || offset === "") return 0;
  const match = /^([+-])(\d{2}):?(\d{2})(?::(\d{2}))?$/.exec(offset);
  if (!match) return;
  const [, sign, hh, mm, ss = "0"] = match;
  const hours = Number(hh);
  const minutes = Number(mm);
  const seconds = Number(ss);
  if (hours > 23 || minutes > 59 || seconds > 59) return;
  return (
    (sign === "-" ? -1 : 1) * ((hours * 60 + minutes) * 60 + seconds) * 1000
  );
}

function dates(timeZone: string) {
  let formatter: Intl.DateTimeFormat | undefined;
  const byDay = new Map<number, Set<number>>();
  function offsetAt(instant: number): number | undefined {
    formatter ??= new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    });
    const label = formatter
      .formatToParts(instant)
      .find(({ type }) => type === "timeZoneName")?.value;
    return label?.startsWith("GMT") ? offsetMs(label.slice(3)) : undefined;
  }

  return (
    text: string,
  ): {
    at:
      | number
      | "invalid-date"
      | "ambiguous-local-date"
      | "nonexistent-local-date";
    /** Read in the chosen time zone: the text named no offset. */
    local: boolean;
  } => {
    const match =
      /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?(?: ?(Z|[+-]\d{2}:?\d{2}))?$/.exec(
        text,
      );
    if (!match) return { at: "invalid-date", local: false };
    const [, date, time, fraction = "", offset] = match;
    const civil = `${date}T${time}.${fraction.padEnd(3, "0")}Z`;
    const wall = Date.parse(civil);
    if (!Number.isFinite(wall) || new Date(wall).toISOString() !== civil)
      return { at: "invalid-date", local: false };
    if (offset !== undefined) {
      const explicit = offsetMs(offset);
      return {
        at: explicit === undefined ? "invalid-date" : wall - explicit,
        local: false,
      };
    }

    const midnight = Math.floor(wall / day) * day;
    let offsets = byDay.get(midnight);
    if (!offsets) {
      // Include both sides of local clock changes, including offsets on adjacent UTC dates.
      offsets = new Set();
      for (
        let instant = midnight - day;
        instant <= midnight + 2 * day;
        instant += 6 * hour
      ) {
        const found = offsetAt(instant);
        if (found !== undefined) offsets.add(found);
      }
      byDay.set(midnight, offsets);
    }
    const instants = [...offsets]
      .map((candidate) => wall - candidate)
      .filter(
        (instant) => instant + (offsetAt(instant) ?? Number.NaN) === wall,
      );
    if (instants.length > 1) return { at: "ambiguous-local-date", local: true };
    return { at: instants[0] ?? "nonexistent-local-date", local: true };
  };
}

/** CubeTime CSV stores decimal seconds, four cells per row and no penalty field. */
export function parseCubeTimeCsv(
  text: string,
  options: CubeTimeOptions,
): ImportResult {
  let records: string[][];
  try {
    records = readDelimited(text, ",");
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new ImportFormatError("cubetime-csv", error.message);
  }
  const [header, ...rows] = records;
  if (
    header?.length !== headings.length ||
    !headings.every((name, i) => header[i] === name)
  )
    throw new ImportFormatError(
      "cubetime-csv",
      "Unexpected CubeTime CSV headings.",
    );

  const key = options.name;
  const dateOf = dates(options.timeZone);
  const issues: ImportIssue[] = [];
  const solves: SolveDraft[] = [];
  let localDates = 0;
  for (const [i, cells] of rows.entries()) {
    const row = i + 1;
    const issue = (code: ImportIssue["code"], value?: string) =>
      issues.push({
        sessionKey: key,
        row,
        code,
        ...(value === undefined ? {} : { value }),
      });
    const [time, comment, scramble, date] = cells;
    if (
      cells.length !== 4 ||
      time === undefined ||
      comment === undefined ||
      scramble === undefined ||
      date === undefined
    ) {
      issue("invalid-row");
      continue;
    }
    // CubeTime’s csTimer export also truncates to whole milliseconds.
    const timeMs = duration(time.trim());
    if (timeMs === undefined) {
      // Flag penalty-shaped input as unreadable. The CSV format gives no interpretation.
      const value = time.trim();
      issue(
        /^DNF\b/i.test(value)
          ? "missing-dnf-time"
          : /\+$|\+2\b/i.test(value)
            ? "ambiguous-plus2"
            : "invalid-time",
        time,
      );
      continue;
    }
    const { at: startedAt, local } = dateOf(date.trim());
    if (typeof startedAt !== "number") {
      issue(startedAt, date);
      continue;
    }
    if (local) localDates++;
    solves.push({
      row,
      timeMs,
      startedAt,
      plus2: 0,
      dnf: false,
      comment: comment || null,
      scramble,
      csv: cells,
    });
  }
  return {
    source: "cubetime",
    sessions: [{ key, name: options.name, event: options.event, solves }],
    issues,
    localDates,
  };
}
