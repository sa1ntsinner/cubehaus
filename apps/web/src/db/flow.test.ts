import type { Solve } from "@cubehaus/core";
import { createStore, migrate } from "@cubehaus/storage";
import { createNodeDb } from "@cubehaus/storage/node";
import { expect, test } from "vitest";
import { createAppState } from "../app-state";
import { DroppedWriteError } from "./client";
import { createPendingJournal, memoryStorage } from "./pending";

const solve: Solve = {
  id: "solve",
  sessionId: "",
  event: "333",
  timeMs: 1000,
  plus2: 0,
  dnf: false,
  scramble: "R",
  startedAt: 100,
  inspectionMs: null,
  comment: null,
  input: "keyboard",
};
function journal() {
  return createPendingJournal(memoryStorage());
}
test("a pre-open solve is journaled synchronously, then stored with a real session", async () => {
  const db = createNodeDb(":memory:");
  try {
    await migrate(db);
    const store = createStore(db);
    const pending = journal();
    const flow = createAppState(pending, () => {});
    flow.add(solve);
    expect(pending.all()).toEqual([solve]);
    await flow.open({ kind: "persistent", store });
    const id = await store.settings.get("session.current");
    expect(id).toBeTruthy();
    expect(flow.session()?.id ?? "").toBe(id);
    expect(await store.solves.count(id as string)).toBe(1);
    expect(pending.all()).toEqual([]);
    // A crash after insertion but before confirmation must be idempotent.
    pending.add({ ...solve, sessionId: id as string });
    await flow.open({ kind: "persistent", store });
    expect(await store.solves.count(id as string)).toBe(1);
    expect(pending.all()).toEqual([]);
  } finally {
    await db.close();
  }
});
test("busy and failed opens preserve pending entries", async () => {
  const pending = journal();
  const flow = createAppState(pending, () => {});
  flow.add(solve);
  await flow.open({ kind: "busy" });
  await flow.open({ kind: "failed", reason: "broken" });
  expect(pending.all()).toEqual([solve]);
});
test("a dropped insert stays pending and replay stores it once", async () => {
  const db = createNodeDb(":memory:");
  try {
    await migrate(db);
    const store = createStore(db);
    const pending = journal();
    let drop = true;
    const add = store.solves.add;
    store.solves.add = async (solve) => {
      if (drop) {
        drop = false;
        throw new DroppedWriteError("dropped");
      }
      await add(solve);
    };
    const flow = createAppState(pending, () => {});
    await flow.open({ kind: "persistent", store });
    await flow.add(solve);
    expect(pending.all()).toHaveLength(1);
    expect(await store.solves.count(flow.session()?.id ?? "")).toBe(0);
    await createAppState(pending, () => {}).open({
      kind: "persistent",
      store,
    });
    expect(await store.solves.count(flow.session()?.id ?? "")).toBe(1);
    expect(pending.all()).toEqual([]);
  } finally {
    await db.close();
  }
});
