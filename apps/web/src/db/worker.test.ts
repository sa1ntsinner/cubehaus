import { createStore, migrate } from "@cubehaus/storage";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import fixture from "../../../../packages/importers/src/fixtures/cstimer-small.json";
import { createDbClient } from "./client";

// Exercise the worker SQL against the real wasm engine in Node, without a
// browser. Only worker transport and OPFS installation are replaced.
const sqlite = await sqlite3InitModule();
Object.assign(sqlite, {
  installOpfsSAHPoolVfs: async () => {
    throw new Error("OPFS denied");
  },
});
vi.doMock("@sqlite.org/sqlite-wasm", () => ({ default: async () => sqlite }));
let receive: (event: MessageEvent) => void;
const port = new EventTarget() as EventTarget & {
  postMessage(message: unknown): void;
};
port.postMessage = (data) => receive(new MessageEvent("message", { data }));
vi.stubGlobal("self", {
  addEventListener: (_type: string, callback: typeof receive) => {
    receive = callback;
  },
  postMessage: (data: unknown) =>
    port.dispatchEvent(new MessageEvent("message", { data })),
});
await import("./worker");
let client: ReturnType<typeof createDbClient>;
beforeEach(() => {
  client = createDbClient(port);
});
afterEach(() => client.close());
afterAll(() => {
  vi.unstubAllGlobals();
});

test("worker imports a file into the open store and reports format errors", async () => {
  await client.open({ opfs: false, delay: 0 });
  await migrate(client);
  const file = new File([JSON.stringify(fixture)], "synthetic.json");
  expect(await client.previewImport(file)).toEqual({
    source: "cstimer",
    sessions: [
      { key: "session1", name: "Practice", event: "333", solves: 6 },
      { key: "session2", name: "OH practice", event: "333oh", solves: 1 },
      { key: "session10", name: "Two", event: "222", solves: 0 },
    ],
    solves: 7,
    added: 7,
    penalized: 0,
    created: 3,
    issues: [],
    localDates: 0,
  });
  expect(await createStore(client).sessions.list()).toEqual([]);
  expect(await client.importFile(file)).toMatchObject({
    sessions: 3,
    created: 3,
    added: 7,
    skipped: 0,
    issues: [],
  });
  const store = createStore(client);
  const sessions = await store.sessions.list();
  const practice = sessions.find(({ name }) => name === "Practice");
  if (!practice) throw new Error("Missing imported session");
  expect(await store.solves.count(practice.id)).toBe(6);
  expect(await client.importFile(new File(["{broken"], "bad.json"))).toEqual({
    formatError: "json",
  });
  expect(await client.previewImport(new File(["[]"], "bad.json"))).toEqual({
    formatError: "unsupported-shape",
  });
  expect(await store.sessions.list()).toEqual(sessions);
  expect(await store.solves.count(practice.id)).toBe(6);
});

test("pool failure opens one memory connection with foreign keys and transactional batches", async () => {
  expect(await client.open({ opfs: true, delay: 0 })).toEqual({
    kind: "memory",
    reason: "Error: OPFS denied",
  });
  expect(await client.all("PRAGMA foreign_keys")).toEqual([
    { foreign_keys: 1 },
  ]);
  await migrate(client);
  await expect(
    client.batch([
      { sql: "INSERT INTO setting VALUES ('rolled-back', 'value', 0)" },
      {
        sql: "INSERT INTO solve (id, session_id, event, time_ms, scramble, started_at, input, updated_at) VALUES ('orphan', 'missing', '333', 1, '', 0, 'keyboard', 0)",
      },
    ]),
  ).rejects.toThrow();
  expect(await client.all("SELECT * FROM setting")).toEqual([]);
  const store = createStore(client);
  const session = await store.sessions.create({ name: "Test", event: "333" });
  const solve = {
    id: "test",
    sessionId: session.id,
    event: "333" as const,
    timeMs: 1000,
    plus2: 2,
    dnf: true,
    scramble: "R",
    startedAt: 123,
    inspectionMs: null,
    comment: null,
    input: "keyboard" as const,
  };
  expect(
    await store.solves.addImported([
      { ...solve, importSource: "synthetic", importHash: "hash" },
    ]),
  ).toEqual({ added: 1, skipped: 0 });
  expect(await store.solves.series(session.id)).toEqual({
    values: new Float64Array([Infinity]),
    startedAt: new Float64Array([123]),
  });
  expect(await client.columns("SELECT 1, 2 UNION ALL SELECT 3, 4")).toEqual([
    new Float64Array([1, 3]),
    new Float64Array([2, 4]),
  ]);
  expect(await client.columns("SELECT 1, 2 WHERE 0")).toEqual([
    new Float64Array(),
    new Float64Array(),
  ]);
  await expect(client.columns("SELECT NULL")).rejects.toThrow("numeric");
  await expect(client.columns("SELECT 'text'")).rejects.toThrow("numeric");
  expect(await store.solves.count(session.id)).toBe(1);
});
