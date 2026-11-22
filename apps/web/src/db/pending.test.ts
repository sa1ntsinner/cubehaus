import type { Solve } from "@cubehaus/core";
import { expect, test } from "vitest";
import { createPendingJournal, memoryStorage } from "./pending";

const solve = (id: string, startedAt = 1000): Solve => ({
  id,
  sessionId: "session",
  event: "333",
  timeMs: 1234,
  plus2: 0,
  dnf: false,
  scramble: "R U",
  startedAt,
  inspectionMs: null,
  comment: null,
  input: "keyboard",
});

test("add, confirm, order and reopening preserve pending solves", () => {
  const disk = memoryStorage();
  const journal = createPendingJournal(disk);
  journal.add(solve("b", 1001));
  journal.add(solve("a", 1002));
  journal.add(solve("c", 1001));
  expect(journal.all().map((s) => s.id)).toEqual(["b", "c", "a"]);
  expect(createPendingJournal(disk).all()).toEqual(journal.all());
  journal.confirm("b");
  expect(
    createPendingJournal(disk)
      .all()
      .map((s) => s.id),
  ).toEqual(["c", "a"]);
  journal.confirm("missing");
  expect(journal.all().map((s) => s.id)).toEqual(["c", "a"]);
  expect(journal.durability()).toBe("stored");
});

test("concurrent journals keep both unconfirmed IDs", () => {
  // Both tabs open over the same legacy snapshot before either writes.
  const disk = memoryStorage([["cubehaus.pending", "[]"]]);
  const first = createPendingJournal(disk);
  const second = createPendingJournal(disk);
  first.add(solve("a", 1000));
  second.add(solve("b", 1001));
  // Both tabs crash; two later opens replay the journal.
  for (let replay = 0; replay < 2; replay++)
    expect(
      createPendingJournal(disk)
        .all()
        .map((s) => s.id),
    ).toEqual(["a", "b"]);
  expect(first.all().map((s) => s.id)).toEqual(["a", "b"]);
});

test("a legacy array is imported once and removed only when complete", () => {
  const disk = memoryStorage([
    ["cubehaus.pending", JSON.stringify([solve("x"), { id: "bad" }])],
  ]);
  const first = createPendingJournal(disk);
  const second = createPendingJournal(disk);
  expect(first.all().map((s) => s.id)).toEqual(["x"]);
  expect(second.all().map((s) => s.id)).toEqual(["x"]);
  expect(disk.map.has("cubehaus.pending")).toBe(false);
  first.confirm("x");
  expect(createPendingJournal(disk).all()).toEqual([]);
});

test("unreadable legacy text is kept for recovery, never erased", () => {
  const disk = memoryStorage([["cubehaus.pending", "{broken"]]);
  const journal = createPendingJournal(disk);
  expect(journal.all()).toEqual([]);
  journal.add(solve("a"));
  expect(disk.map.get("cubehaus.pending")).toBe("{broken");
  expect(
    createPendingJournal(disk)
      .all()
      .map((s) => s.id),
  ).toEqual(["a"]);
});

test("entries with an invalid shape or a mismatched key are ignored", () => {
  const disk = memoryStorage([
    ["cubehaus.pending.n", "null"],
    ["cubehaus.pending.o", "{}"],
    ["cubehaus.pending.p", '{"id":"bad"}'],
    ["cubehaus.pending.q", JSON.stringify(solve("other"))],
    ["unrelated", JSON.stringify(solve("u"))],
  ]);
  expect(createPendingJournal(disk).all()).toEqual([]);
});

test("quota and storage access errors keep the journal usable in memory", () => {
  const journal = createPendingJournal({
    get length(): number {
      throw new Error("blocked");
    },
    key() {
      throw new Error("blocked");
    },
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new DOMException("quota", "QuotaExceededError");
    },
    removeItem() {
      throw new Error("blocked");
    },
  });
  expect(() => journal.add(solve("a"))).not.toThrow();
  expect(journal.all().map((s) => s.id)).toEqual(["a"]);
  expect(journal.durability()).toBe("memory");
  expect(() => journal.confirm("a")).not.toThrow();
  expect(journal.all()).toEqual([]);
  expect(journal.durability()).toBe("stored");
});

test("an unsaved entry is written once storage accepts writes again", () => {
  const disk = memoryStorage();
  let quota = true;
  const journal = createPendingJournal({
    get length() {
      return disk.length;
    },
    key: disk.key,
    getItem: disk.getItem,
    removeItem: disk.removeItem,
    setItem: (key, value) => {
      if (quota) throw new Error("quota");
      disk.setItem(key, value);
    },
  });
  journal.add(solve("a", 1000));
  expect(journal.durability()).toBe("memory");
  quota = false;
  journal.add(solve("b", 1001));
  expect(journal.all().map((s) => s.id)).toEqual(["a", "b"]);
  expect(journal.durability()).toBe("stored");
  expect(
    createPendingJournal(disk)
      .all()
      .map((s) => s.id),
  ).toEqual(["a", "b"]);
});

test("another tab's pending solve survives adds and confirmations", () => {
  const disk = memoryStorage();
  const first = createPendingJournal(disk);
  const second = createPendingJournal(disk);
  second.add(solve("busy-tab"));
  first.add(solve("active-tab"));
  first.confirm("active-tab");
  expect(
    createPendingJournal(disk)
      .all()
      .map((s) => s.id),
  ).toEqual(["busy-tab"]);
  second.confirm("busy-tab");
  first.add(solve("next"));
  expect(
    createPendingJournal(disk)
      .all()
      .map((s) => s.id),
  ).toEqual(["next"]);
});
