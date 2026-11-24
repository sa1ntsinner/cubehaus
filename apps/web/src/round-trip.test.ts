import { encodeCsTimer, parseCsTimer } from "@cubehaus/importers";
import { createStore, migrate, snapshot } from "@cubehaus/storage";
import { createNodeDb } from "@cubehaus/storage/node";
import { expect, test } from "vitest";
import fixture from "../../../packages/importers/src/fixtures/cstimer-small.json";
import { runImport } from "./import";

/** A csTimer file into a fresh database, and that database out as a csTimer file. */
async function through(text: string): Promise<string> {
  const db = createNodeDb(":memory:");
  try {
    await migrate(db);
    await runImport(createStore(db), parseCsTimer(text));
    return encodeCsTimer(await snapshot(db)).text;
  } finally {
    await db.close();
  }
}

/** What a person sees of each session: its name, puzzle and every solve in order. */
const solvesOf = (text: string) =>
  parseCsTimer(text).sessions.map(({ name, event, solves }) => ({
    name,
    event,
    solves: solves.map(
      ({ timeMs, plus2, dnf, scramble, comment, startedAt, phases }) => ({
        timeMs,
        plus2,
        dnf,
        scramble,
        comment,
        startedAt,
        phases,
      }),
    ),
  }));

test("a csTimer file imported and saved for csTimer again keeps every solve", async () => {
  const original = JSON.stringify(fixture);
  const once = await through(original);
  // Names, penalties, comments, dates, the duplicate solve and the empty session.
  expect(solvesOf(once)).toEqual(solvesOf(original));
  // And the file made here goes round unchanged, to the byte.
  expect(await through(once)).toBe(once);
});
