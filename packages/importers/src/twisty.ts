import type { EventId } from "@cubehaus/core";
import {
  ImportFormatError,
  type ImportIssue,
  type ImportResult,
  type SessionDraft,
} from "./cstimer";
import { eventOfScrType } from "./cstimer-events";
import { readDelimited } from "./delimited";

const header =
  "Puzzle,Category,Time(millis),Date(millis),Scramble,Penalty,Comment";

const eventByPuzzle = new Map<string, EventId>([
  ["222", "222"],
  ["333", "333"],
  ["444", "444"],
  ["555", "555"],
  ["666", "666"],
  ["777", "777"],
  ["clock", "clock"],
  ["mega", "minx"],
  ["pyra", "pyram"],
  ["skewb", "skewb"],
  ["sq1", "sq1"],
]);

export function hasTwistyBackupHeader(text: string): boolean {
  const firstLine = text.split(/\r\n?|\n/, 1)[0]?.replace(/^\uFEFF/, "");
  return firstLine === header;
}

export function parseTwistyBackup(text: string): ImportResult {
  if (!hasTwistyBackupHeader(text))
    throw new ImportFormatError(
      "unsupported-shape",
      "Expected a Twisty Timer backup header.",
    );

  let rows: string[][];
  try {
    rows = readDelimited(text, ";");
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new ImportFormatError("twisty-backup", error.message);
  }

  const sessions = new Map<string, SessionDraft>();
  const issues: ImportIssue[] = [];
  // Records seen per session, read or not: a row number counts within its session.
  const seen = new Map<string, number>();
  for (const [index, cells] of rows.entries()) {
    if (index === 0) continue;
    const [
      puzzle = "",
      category = "",
      duration = "",
      date = "",
      scramble = "",
      penalty = "",
      comment = "",
    ] = cells;
    const key = JSON.stringify([puzzle, category]);
    let session = sessions.get(key);
    if (!session) {
      const known = eventByPuzzle.get(puzzle);
      // Twisty Timer has no one-handed puzzle: people keep it as a 3×3 category.
      const event =
        known === "333" ? eventOfScrType("333", category).id : known;
      if (!event)
        issues.push({
          sessionKey: key,
          row: null,
          code: "unknown-event",
          value: puzzle,
        });
      // Every Twisty puzzle starts with a category called "Normal": an unknown puzzle keeps
      // its own name in front, so it does not read as a second 3×3 "Normal".
      const name = category.trim();
      session = {
        key,
        name: event ? name || puzzle : [puzzle, name].filter(Boolean).join(" "),
        event: event ?? "333",
        meta: { puzzle, category },
        solves: [],
      };
      sessions.set(key, session);
    }
    const row = (seen.get(key) ?? 0) + 1;
    seen.set(key, row);
    const timeMs = Number(duration);
    const plus2 = Number(penalty === "1");
    if (
      cells.length !== 7 ||
      !/^\d+$/.test(duration) ||
      !Number.isSafeInteger(timeMs + 2000 * plus2) ||
      !/^[1-9]\d{12}$/.test(date) ||
      !/^[012]$/.test(penalty)
    ) {
      issues.push({ sessionKey: key, row, code: "invalid-row" });
      continue;
    }
    session.solves.push({
      timeMs,
      plus2,
      dnf: penalty === "2",
      scramble,
      comment: comment || null,
      startedAt: Number(date),
      row,
      twisty: cells,
    });
  }
  return { source: "twisty", sessions: [...sessions.values()], issues };
}
