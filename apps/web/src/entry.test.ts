import type { EventId } from "@cubehaus/core";
import { createStore, migrate } from "@cubehaus/storage";
import { createNodeDb } from "@cubehaus/storage/node";
import { expect, test } from "vitest";
import { createAppState } from "./app-state";
import { createPendingJournal, memoryStorage } from "./db/pending";
import { prepareEntry } from "./screens/Entry";
import { text } from "./text";

async function setup(event: EventId) {
  const db = createNodeDb(":memory:");
  await migrate(db);
  const store = createStore(db);
  const app = createAppState(createPendingJournal(memoryStorage()), () => {});
  await app.open({ kind: "persistent", store });
  await app.newSession(event, event);
  const session = app.session();
  if (!session) throw new Error("Missing session");
  return { app, db, session, store };
}

const startedAt = 1234;

test("typed time appears in the session as a manual solve", async () => {
  const { app, db, session } = await setup("333");
  try {
    const result = await prepareEntry(
      session,
      "R U",
      "12.345+2",
      startedAt,
      text,
    );
    if ("error" in result) throw new Error(result.error);
    await app.add(result.solve);
    expect(app.view.rows[0]?.solve).toMatchObject({
      input: "manual",
      sessionId: session.id,
      event: "333",
      scramble: "R U",
      timeMs: 12345,
      plus2: 1,
      dnf: false,
      startedAt,
      inspectionMs: null,
    });
  } finally {
    await db.close();
  }
});

test("an invalid time produces an error sentence and no solve", async () => {
  const { app, db, session } = await setup("333");
  try {
    const result = await prepareEntry(
      session,
      "R U",
      "12.3.4",
      startedAt,
      text,
    );
    if ("solve" in result) await app.add(result.solve);
    expect(result).toEqual({ error: expect.stringMatching(/\.$/) });
    expect(app.view.rows).toHaveLength(0);
  } finally {
    await db.close();
  }
});

test("E2d1: an 81 ETM solution previews a DNF before storage", async () => {
  const { app, db, session } = await setup("333fm");
  try {
    const solution = `${"x ".repeat(80)}R'`;
    const result = await prepareEntry(session, "R", solution, startedAt, text);
    if ("error" in result) throw new Error(result.error);
    expect(result.feedback).toBe(text.fmcOver);
    expect(app.view.rows).toHaveLength(0);
    await app.add(result.solve);
    expect(app.view.rows[0]?.solve).toMatchObject({ dnf: true, solution });
  } finally {
    await db.close();
  }
});

test("E2d, 12a5: an accepted solution previews its OBTM count", async () => {
  const { db, session } = await setup("333fm");
  try {
    const result = await prepareEntry(
      session,
      "U2 x' R U' R'",
      "R U R' x U2",
      startedAt,
      text,
    );
    expect(result).toMatchObject({
      feedback: "4",
      solve: { moves: 4, dnf: false },
    });
  } finally {
    await db.close();
  }
});

test("9f12c, H1b: Multi-Blind 1 of 2 at 20:00 stores a DNF", async () => {
  const { app, db, session } = await setup("333mbf");
  try {
    const result = await prepareEntry(
      session,
      "R\nU",
      "20:00",
      startedAt,
      text,
      { solved: "1", attempted: 2 },
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.feedback).toBe(text.mbfDnf);
    await app.add(result.solve);
    expect(app.view.rows[0]?.solve).toMatchObject({
      dnf: true,
      cubesSolved: 1,
      cubesAttempted: 2,
      scramble: "R\nU",
    });
  } finally {
    await db.close();
  }
});

test("H1b1: Multi-Blind scores 3/3 at the 30:00 limit", async () => {
  const { db, session } = await setup("333mbf");
  try {
    expect(
      await prepareEntry(session, "R\nU\nF", "30:00", startedAt, text, {
        solved: "3",
        attempted: 3,
      }),
    ).toMatchObject({ solve: { dnf: false, timeMs: 1800000 } });
  } finally {
    await db.close();
  }
});

test("typing is stored for the selected session, becomes its event's default and survives reopening it", async () => {
  const { app, db, session, store } = await setup("333");
  try {
    await app.setEntry(session.id, "typing");
    expect(app.view.settings.entry).toBe("typing");
    // A new session of the same event starts as that event was last set; another
    // event keeps the default.
    await app.newSession("Other", "333");
    expect(app.view.settings.entry).toBe("typing");
    await app.newSession("Two", "222");
    expect(app.view.settings.entry).toBe("timer");
    await app.selectSession(session.id);
    await app.open({ kind: "persistent", store });
    expect(app.view.current?.id).toBe(session.id);
    expect(app.view.settings.entry).toBe("typing");
  } finally {
    await db.close();
  }
});
