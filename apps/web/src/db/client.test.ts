import { expect, test } from "vitest";
import { createDbClient } from "./client";

class FakeWorker extends EventTarget {
  messages: { id: number; method: string; args: unknown[] }[] = [];
  postMessage(message: (typeof this.messages)[number]) {
    this.messages.push(message);
  }
  reply(index: number, result?: unknown, error?: string) {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: {
          id: this.messages[index]?.id,
          result,
          ...(error ? { error } : {}),
        },
      }),
    );
  }
}
test("out-of-order replies resolve the matching request", async () => {
  const worker = new FakeWorker();
  const db = createDbClient(worker);
  const first = db.all("SELECT 1");
  const second = db.columns("SELECT 1e999");
  worker.reply(1, [new Float64Array([Infinity])]);
  worker.reply(0, [{ n: 1 }]);
  expect(await first).toEqual([{ n: 1 }]);
  expect(await second).toEqual([new Float64Array([Infinity])]);
});
test("a worker reply error rejects only its own call", async () => {
  const worker = new FakeWorker();
  const db = createDbClient(worker);
  const bad = expect(db.all("bad")).rejects.toThrow("SQL failed");
  const good = db.all("good");
  worker.reply(0, undefined, "SQL failed");
  worker.reply(1, []);
  await bad;
  expect(await good).toEqual([]);
});
test("batch is a single message", async () => {
  const worker = new FakeWorker();
  const db = createDbClient(worker);
  const statements = [{ sql: "first" }, { sql: "second", params: [1] }];
  const done = db.batch(statements);
  expect(worker.messages).toEqual([
    { id: 1, method: "batch", args: [statements] },
  ]);
  worker.reply(0);
  await done;
});
test("a fatal worker error rejects outstanding and future calls", async () => {
  const worker = new FakeWorker();
  const db = createDbClient(worker);
  const done = expect(db.all("select 1")).rejects.toThrow();
  worker.dispatchEvent(new Event("error"));
  await done;
  await expect(db.all("select 2")).rejects.toThrow();
});
test("the drop hook rejects one solve insert without posting it", async () => {
  const worker = new FakeWorker();
  const db = createDbClient(worker, { dropSolveOnce: true });
  const statements = [
    { sql: "INSERT OR IGNORE INTO solve (id) VALUES (?)", params: ["a"] },
  ];
  await expect(db.batch(statements)).rejects.toThrow(
    "Test hook dropped solve insert",
  );
  expect(worker.messages).toHaveLength(0);
  const next = db.batch(statements);
  worker.reply(0);
  await next;
});
