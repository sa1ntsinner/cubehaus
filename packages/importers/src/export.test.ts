import {
  type BackupV1,
  createStore,
  type Db,
  migrate,
  type SqlValue,
  snapshot,
} from "@cubehaus/storage";
import { createNodeDb } from "@cubehaus/storage/node";
import { afterEach, expect, test } from "vitest";
import { parseCsTimer } from "./cstimer";
import { csvHeadings, encodeCsTimer, encodeCsv } from "./export";

const open: Db[] = [];
afterEach(async () => {
  for (const db of open.splice(0)) await db.close();
});

const insert = (table: string, row: Record<string, SqlValue>) => ({
  sql: `INSERT INTO ${table} (${Object.keys(row).join(", ")}) VALUES (${Object.keys(
    row,
  )
    .map(() => "?")
    .join(", ")})`,
  params: Object.values(row),
});

const session = (
  id: string,
  name: string,
  event: string,
  order: string,
  over: Record<string, SqlValue> = {},
) =>
  insert("session", {
    id,
    name,
    event,
    order_key: order,
    created_at: 1,
    updated_at: 1,
    ...over,
  });

const solve = (
  id: string,
  sessionId: string,
  event: string,
  over: Record<string, SqlValue> = {},
) =>
  insert("solve", {
    id,
    session_id: sessionId,
    event,
    time_ms: 10000,
    plus2: 0,
    dnf: 0,
    scramble: "R U",
    started_at: 1700000001000,
    input: "keyboard",
    updated_at: 1,
    ...over,
  });

const comment = 'fast, "clean"\r\nsecond line';

async function history(): Promise<BackupV1> {
  const db = createNodeDb(":memory:");
  open.push(db);
  await migrate(db);
  await db.batch([
    session("a", "A, main", "333", "a0"),
    session("e", "Empty", "444", "a1"),
    session("f", "FTO", "fto", "a2"),
    session("m", "Moves", "333fm", "a3"),
    session("gone", "Gone", "333", "a4", { deleted_at: 5 }),
    session("i", "Imported", "333", "a5"),
    solve("a1", "a", "333", {
      time_ms: 12345,
      plus2: 1,
      started_at: 1700000000000,
      scramble: "R",
      comment,
    }),
    solve("a2", "a", "333", {
      dnf: 1,
      time_ms: 9000,
      started_at: 1700000002000,
    }),
    solve("a3", "a", "333", { plus2: 2, started_at: 1700000003000 }),
    solve("a4", "a", "333", {
      started_at: 1700000004123,
      inspection_ms: 15000,
    }),
    solve("a5", "a", "333", { started_at: 1700000005000, deleted_at: 6 }),
    solve("f1", "f", "fto", { started_at: 1700000006000 }),
    solve("m1", "m", "333fm", {
      time_ms: 0,
      moves: 28,
      solution: "R U",
      started_at: 1700000007000,
    }),
    solve("i1", "i", "333", {
      time_ms: 12345,
      plus2: 1,
      started_at: 1700000008000,
      input: "imported",
      import_source: "cstimer",
      import_hash: "h",
      import_extra: '{"v":1,"phases":[7000],"extra":[["x",1]]}',
    }),
    insert("import_session", {
      source: "cstimer",
      source_scope: "",
      source_key: "session4",
      session_id: "i",
      source_meta:
        '{"name":"Imported","opt":{"scrType":"pll","phases":2},"rank":4}',
      updated_at: 1,
    }),
  ]);
  return snapshot(db, () => 0);
}

test("exports raw time once and quotes multiline fields", async () => {
  const backup = await history();
  const { text, issues } = encodeCsTimer(backup);
  const file = JSON.parse(text) as Record<string, unknown>;
  expect(Object.keys(file)).toEqual([
    "session1",
    "session2",
    "session3",
    "session4",
    "session5",
    "properties",
  ]);
  expect(file.session1).toEqual([
    [[2000, 12345], "R", comment, 1700000000],
    [[-1, 9000], "R U", "", 1700000002],
    [[4000, 10000], "R U", "", 1700000003],
    [[0, 10000], "R U", "", 1700000004],
  ]);
  expect(file.session2).toEqual([]);
  expect(file.session5).toEqual([
    [[2000, 12345, 7000], "R U", "", 1700000008, ["x", 1]],
  ]);
  const sessionData = JSON.parse(
    (file.properties as { sessionData: string }).sessionData,
  );
  expect(sessionData).toEqual({
    "1": { name: "A, main", opt: { scrType: "333" } },
    "2": { name: "Empty", opt: { scrType: "444wca" } },
    "3": { name: "FTO", opt: { scrType: "fto" } },
    "4": { name: "Moves", opt: { scrType: "333fm" } },
    // An imported session keeps its own options and its original type.
    "5": { name: "Imported", opt: { scrType: "pll", phases: 2 } },
  });
  expect(issues).toEqual([
    { id: "a4", field: "started_at", reason: "whole-seconds" },
    { id: "a4", field: "inspection_ms", reason: "not-in-format" },
    { id: "m1", field: "moves", reason: "not-in-format" },
    { id: "m1", field: "solution", reason: "not-in-format" },
  ]);

  // csTimer's own reading of the file gives the same values back.
  const read = parseCsTimer(text);
  expect(read.sessions.map(({ name, event }) => [name, event])).toEqual([
    ["A, main", "333"],
    ["Empty", "444"],
    ["FTO", "fto"],
    ["Moves", "333fm"],
    ["Imported", "333"],
  ]);
  expect(read.sessions[0]?.solves[0]).toMatchObject({
    timeMs: 12345,
    plus2: 1,
    dnf: false,
    startedAt: 1700000000000,
    scramble: "R",
    comment,
  });
  expect(read.sessions[4]?.solves[0]).toMatchObject({
    phases: [7000],
    extra: [["x", 1]],
  });
});

/** A plain RFC 4180 reader, separate from the writer under test. */
function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

test("CSV has one row per live solve with exact strings and integer fields", async () => {
  const backup = await history();
  const { text, issues } = encodeCsv(backup);
  expect(text.endsWith("\r\n")).toBe(true);
  const [head, ...rows] = readCsv(text);
  expect(head).toEqual([...csvHeadings]);
  expect(head?.join(",")).toBe(
    "session_id,session_name,event,id,time_ms,plus2,dnf,started_at_utc,scramble,comment,inspection_ms,moves,solution,cubes_solved,cubes_attempted,splits",
  );
  expect(rows.map((row) => row[3])).toEqual([
    "a1",
    "a2",
    "a3",
    "a4",
    "f1",
    "m1",
    "i1",
  ]);
  expect(rows[0]).toEqual([
    "a",
    "A, main",
    "333",
    "a1",
    "12345",
    "1",
    "0",
    "2023-11-14T22:13:20.000Z",
    "R",
    comment,
    "",
    "",
    "",
    "",
    "",
    "",
  ]);
  expect(rows[6]?.at(-1)).toBe(
    '[{"name":"1","durationMs":7000},{"name":"2","durationMs":5345}]',
  );
  expect(rows[3]?.[7]).toBe("2023-11-14T22:13:24.123Z");
  expect(rows[3]?.[10]).toBe("15000");
  expect(rows[5]?.slice(11, 13)).toEqual(["28", "R U"]);
  expect(issues).toEqual([
    { id: "i1", field: "import_extra", reason: "not-in-format" },
  ]);
  // Nothing in a cell can start a formula or break a row.
  expect(readCsv(text)).toHaveLength(8);
});

test("a fresh database exports a file csTimer reads with no sessions lost", async () => {
  const db = createNodeDb(":memory:");
  open.push(db);
  await migrate(db);
  await createStore(db).sessions.create({ name: "Only", event: "333" });
  const { text } = encodeCsTimer(await snapshot(db));
  expect(parseCsTimer(text).sessions).toMatchObject([
    { key: "session1", name: "Only", event: "333", solves: [] },
  ]);
  expect(encodeCsv(await snapshot(db)).text).toBe(
    `${csvHeadings.join(",")}\r\n`,
  );
});

test("one session alone: csTimer's file holds it as its only session, the table only its rows", async () => {
  const backup = await history();
  const cstimer = JSON.parse(encodeCsTimer(backup, { sessionId: "a" }).text);
  expect(Object.keys(cstimer)).toEqual(["session1", "properties"]);
  expect(cstimer.session1).toHaveLength(4);
  expect(JSON.parse(cstimer.properties.sessionData)).toEqual({
    1: { name: "A, main", opt: { scrType: "333" } },
  });
  // csTimer's own reader (ours) takes it back as one session.
  expect(
    parseCsTimer(encodeCsTimer(backup, { sessionId: "a" }).text).sessions,
  ).toHaveLength(1);
  const rows = encodeCsv(backup, { sessionId: "f" })
    .text.split("\r\n")
    .filter(Boolean);
  expect(rows).toHaveLength(2);
  expect(rows[1]?.startsWith("f,FTO,fto,f1,")).toBe(true);
  // A session that is not there, or deleted, gives an empty file of that kind.
  expect(
    encodeCsv(backup, { sessionId: "gone" }).text.split("\r\n").filter(Boolean),
  ).toEqual([csvHeadings.join(",")]);
});

test("maps named durations to csTimer ends and imports those ends in chronological order", () => {
  const source = {
    tables: {
      session: [{ id: "a", name: "Practice", event: "333", deleted_at: null }],
      solve: [
        {
          id: "s",
          session_id: "a",
          deleted_at: null,
          started_at: 1700000000000,
          scramble: "R",
          comment: null,
          time_ms: 10000,
          plus2: 2,
          dnf: 0,
          splits: JSON.stringify([
            { name: "Cross", durationMs: 1000 },
            { name: "F2L", durationMs: 6000 },
            { name: "LL", durationMs: 3000 },
          ]),
        },
      ],
    },
  };
  const { text } = encodeCsTimer(source);
  expect(JSON.parse(text).session1[0][0]).toEqual([4000, 10000, 7000, 1000]);
  expect(parseCsTimer(text).sessions[0]?.solves[0]).toMatchObject({
    plus2: 2,
    splits: [
      { name: "1", durationMs: 1000 },
      { name: "2", durationMs: 6000 },
      { name: "3", durationMs: 3000 },
    ],
  });
});
