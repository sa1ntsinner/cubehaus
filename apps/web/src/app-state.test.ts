import { ok } from "node:assert/strict";
import type { Session, Solve } from "@cubehaus/core";
import { statOf } from "@cubehaus/stats";
import { createStore, migrate } from "@cubehaus/storage";
import { createNodeDb } from "@cubehaus/storage/node";
import { expect, test, vi } from "vitest";
import { createAppState } from "./app-state";
import { createPendingJournal, memoryStorage } from "./db/pending";
import { createTimerController } from "./useTimer";

function solve(
  session: Session,
  n: number,
  timeMs: number,
  patch?: Partial<Solve>,
): Solve {
  return {
    id: String(n).padStart(5, "0"),
    sessionId: session.id,
    event: session.event,
    timeMs,
    plus2: 0,
    dnf: false,
    scramble: "R U",
    startedAt: n,
    inspectionMs: null,
    comment: null,
    input: "keyboard",
    ...patch,
  };
}

async function setup() {
  const db = createNodeDb(":memory:");
  await migrate(db);
  const store = createStore(db);
  const journal = createPendingJournal(memoryStorage());
  const app = createAppState(journal, () => {});
  return {
    db,
    store,
    app,
    journal,
    open: () => app.open({ kind: "persistent", store }),
  };
}

test("busy recovery publishes the persistent store and flushes a pending solve once", async () => {
  const { db, app, store, journal } = await setup();
  try {
    const session = await store.sessions.create({
      name: "Three",
      event: "333",
    });
    const pending = solve(session, 1, 1000, { sessionId: "" });
    const save = vi.spyOn(store.solves, "add");
    await app.open({ kind: "busy" });
    await app.add(pending);
    expect(app.view.dbState?.kind).toBe("busy");
    expect(app.view.rows[0]?.solve).toEqual(pending);
    expect(journal.all()).toEqual([pending]);
    expect(save).not.toHaveBeenCalled();

    const list = vi.spyOn(store.sessions, "list");
    const persistent = { kind: "persistent", store } as const;
    await Promise.all([
      app.open(persistent),
      app.open(persistent),
      app.open({ kind: "busy" }),
    ]);
    expect(app.view.dbState).toBe(persistent);
    expect(app.view.current).toEqual(session);
    expect(app.view.rows[0]?.solve.id).toBe(pending.id);
    expect(list).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledExactlyOnceWith({
      ...pending,
      sessionId: session.id,
    });
    expect(journal.all()).toEqual([]);
    expect(await store.solves.count(session.id)).toBe(1);
  } finally {
    await db.close();
  }
});

test("the fifth row and current ao5 match statOf, and penalty undo restores both exactly", async () => {
  const { db, app, open } = await setup();
  try {
    await open();
    const session = app.view.current;
    ok(session);
    const values = [1000, 2000, 3000, 8000, 4000];
    for (const [i, ms] of values.entries())
      await app.add(solve(session, i, ms));
    const ao5 = statOf(values, { kind: "ao", n: 5 });
    expect(app.view.stats.ao5).toBe(ao5);
    expect(app.view.rows[0]).toMatchObject({ no: 5, ao5 });
    const latest = app.view.rows[0];
    ok(latest);
    await app.penalty(latest.solve, "plus2");
    expect(app.view.stats.ao5).toBe(
      statOf([1000, 2000, 3000, 8000, 6000], { kind: "ao", n: 5 }),
    );
    expect(app.view.stats["ao5-best"]).toBe(app.view.stats.ao5);
    await app.undo();
    expect(app.view.stats.ao5).toBe(ao5);
    expect(app.view.rows[0]?.ao5).toBe(ao5);
  } finally {
    await db.close();
  }
});

test("delete undo restores order even with tied timestamps and a later insertion", async () => {
  const { db, app, open } = await setup();
  try {
    await open();
    const session = app.view.current;
    ok(session);
    const one = solve(session, 1, 1000);
    const two = solve(session, 2, 2000, { startedAt: 1 });
    const three = solve(session, 3, 3000, { startedAt: 1 });
    await app.add(two);
    await app.add(one);
    await app.deleteSolve(two);
    await app.add(three);
    await app.undo();
    expect(app.view.rows.map(({ solve }) => solve.id)).toEqual([
      three.id,
      two.id,
      one.id,
    ]);
    expect(app.view.stats.mo3).toBe(2000);
    await app.setComment(two, "practice");
    expect(app.view.rows[1]?.solve.comment).toBe("practice");
    await app.undo();
    expect(app.view.rows[1]?.solve.comment).toBeNull();
  } finally {
    await db.close();
  }
});

test("deleting the open session prefers the previous neighbour, then the next, and undo reopens it", async () => {
  const { db, app, store, open } = await setup();
  try {
    await open();
    const first = app.view.current;
    ok(first);
    await app.newSession("Two", "222");
    const second = app.view.current;
    ok(second);
    await app.newSession("Four", "444");
    await app.selectSession(second.id);
    await app.deleteSession(second.id);
    expect(app.view.current?.id).toBe(first.id);
    expect(await store.settings.get("session.current")).toBe(first.id);
    await app.deleteSession(first.id);
    expect(app.view.current?.event).toBe("444");
    await app.undo();
    expect(app.view.current?.id).toBe(first.id);
  } finally {
    await db.close();
  }
});

test("deleting the only session opens a fresh 3×3", async () => {
  const { db, app, open } = await setup();
  try {
    await open();
    const first = app.view.current;
    ok(first);
    await app.deleteSession(first.id);
    expect(app.view.sessions).toEqual([app.view.current]);
    expect(app.view.current).toMatchObject({ event: "333", name: "3×3" });
    expect(app.view.current?.id).not.toBe(first.id);
  } finally {
    await db.close();
  }
});

test("archive and trash: out of the list, back by undo or from the trash, the last one gives a fresh 3×3", async () => {
  const { db, app, store, open } = await setup();
  try {
    await open();
    const a = app.view.current;
    ok(a);
    for (const n of [1, 2, 3]) await app.add(solve(a, n, 10000 + n));
    await app.newSession("B", "222");
    const b = app.view.current;
    ok(b);
    await app.selectSession(a.id);

    // Archiving the open session opens its neighbour; the puzzle goes free.
    await app.archiveSession(a.id, true);
    expect(app.view.current?.id).toBe(b.id);
    expect(app.view.sessions.map(({ id, archived }) => [id, archived])).toEqual(
      [
        [a.id, true],
        [b.id, false],
      ],
    );
    // Its solves stay where they were, counted with their puzzle.
    expect(await store.solves.count(a.id)).toBe(3);
    await app.undo();
    expect(app.view.current?.id).toBe(a.id);
    expect(app.view.current?.archived).toBe(false);
    await app.archiveSession(a.id, true);
    // Picking 3×3 again makes a new session; the archived one stays put away.
    await app.openEvent("333", "3×3");
    expect(app.view.current?.id).not.toBe(a.id);
    const fresh = app.view.current;
    ok(fresh);
    // Opened from a search it is open, still archived; back into the list by hand.
    await app.selectSession(a.id);
    expect(app.view.current).toMatchObject({ id: a.id, archived: true });
    await app.archiveSession(a.id, false);
    expect(app.view.current).toMatchObject({ id: a.id, archived: false });

    // Into the trash and back out of it, with all three solves in order.
    await app.deleteSession(a.id);
    const [entry] = await app.trash();
    expect(entry).toMatchObject({ kind: "session", id: a.id, count: 3 });
    ok(entry);
    await app.restoreFromTrash(entry);
    expect(app.view.sessions.map(({ id }) => id)).toContain(a.id);
    await app.selectSession(a.id);
    expect(app.view.rows.map(({ solve }) => solve.id)).toEqual([
      "00003",
      "00002",
      "00001",
    ]);
    // A solve deleted on its own comes back from the trash into the open session.
    await app.deleteSolve(app.view.rows[0]?.solve as Solve);
    expect(app.view.stats.count).toBe(2);
    const [deleted] = await app.trash();
    ok(deleted?.kind === "solve");
    await app.restoreFromTrash(deleted);
    expect(app.view.stats.count).toBe(3);
    expect(app.view.rows[0]?.solve.id).toBe("00003");

    // With every other session put away, archiving the last shown one opens a new 3×3.
    await app.archiveSession(b.id, true);
    await app.archiveSession(fresh.id, true);
    await app.archiveSession(a.id, true);
    const last = app.view.current;
    expect(last).toMatchObject({ event: "333", archived: false });
    expect([a.id, b.id, fresh.id]).not.toContain(last?.id);
  } finally {
    await db.close();
  }
});

test("scrubbing targets the displayed ID across equal timestamps", async () => {
  const db = createNodeDb(":memory:");
  await migrate(db);
  const store = createStore(db);
  const app = createAppState(createPendingJournal(memoryStorage()), () => {}, {
    pageSize: 2,
  });
  try {
    await app.open({ kind: "persistent", store });
    const session = app.view.current;
    ok(session);
    const at = (id: string, startedAt: number, timeMs: number): Solve => ({
      ...solve(session, 0, timeMs),
      id,
      startedAt,
      scramble: `scramble ${id}`,
    });
    // b and c share a timestamp; ids order them a, b, c, d.
    for (const item of [
      at("a", 1000, 11000),
      at("b", 2000, 12340),
      at("c", 2000, 13000),
      at("d", 3000, 14000),
    ])
      await app.add(item);
    expect(app.view.rows.map(({ solve }) => solve.id)).toEqual(["d", "c"]);
    expect(app.view.shown).toBeNull();

    // From d, up twice: past the loaded page, to b, number 2.
    await app.browse(-1);
    expect(app.view.shown).toMatchObject({ solve: { id: "c" }, no: 3 });
    await app.browse(-1);
    expect(app.view.browsing).toBe(true);
    expect(app.view.shown).toMatchObject({
      solve: { id: "b", scramble: "scramble b", startedAt: 2000 },
      no: 2,
    });
    const shown = () => app.view.shown?.solve as Solve;

    // Edits land on b, never on its twin c.
    await app.penalty(shown(), "plus2");
    expect(shown()).toMatchObject({ id: "b", plus2: 1, timeMs: 12340 });
    expect(await store.solves.get("c")).toMatchObject({ plus2: 0 });
    await app.setComment(shown(), "old");
    expect(shown().comment).toBe("old");
    expect((await store.solves.get("c"))?.comment).toBeNull();
    await app.penalty(shown(), "plus2");
    await app.penalty(shown(), "dnf");
    expect(shown()).toMatchObject({ id: "b", plus2: 0, dnf: true });
    expect(await store.solves.get("b")).toMatchObject({
      dnf: true,
      comment: "old",
    });
    expect(app.view.stats.count).toBe(4);

    // Delete b: the earlier solve takes its place; undo brings b back as it was.
    await app.deleteSolve(shown());
    expect(app.view.shown).toMatchObject({ solve: { id: "a" }, no: 1 });
    expect(app.view.stats.count).toBe(3);
    await app.undo();
    expect(app.view.shown).toMatchObject({
      solve: { id: "b", startedAt: 2000 },
      no: 2,
    });
    expect(await store.solves.get("b")).toMatchObject({ startedAt: 2000 });
    expect(app.view.stats.count).toBe(4);

    // Down twice: c, then d, the newest, which is live again.
    await app.browse(1);
    expect(app.view.shown).toMatchObject({ solve: { id: "c" }, no: 3 });
    await app.browse(1);
    expect(app.view.shown).toBeNull();
    // A row picked in the file shows it; live() and a new solve return to now.
    await app.showSolve("a");
    expect(app.view.shown).toMatchObject({ solve: { id: "a" }, no: 1 });
    await app.live();
    expect(app.view.browsing).toBe(false);
    await app.showSolve("b");
    await app.add(at("e", 4000, 9000));
    expect(app.view.shown).toBeNull();
    expect(app.view.rows[0]?.solve.id).toBe("e");
  } finally {
    await db.close();
  }
});

test("the open session merges into another of its puzzle, and undo opens it again", async () => {
  const db = createNodeDb(":memory:");
  await migrate(db);
  const store = createStore(db);
  const app = createAppState(createPendingJournal(memoryStorage()), () => {}, {
    pageSize: 2,
  });
  try {
    await app.open({ kind: "persistent", store });
    const a = app.view.current;
    ok(a);
    await app.add(solve(a, 1000, 11000));
    await app.add(solve(a, 3000, 13000));
    const b = await store.sessions.create({ name: "B", event: "333" });
    const two = await store.sessions.create({ name: "Two", event: "222" });
    await store.solves.add(solve(b, 2000, 12000));

    // Another puzzle refuses; nothing changes.
    expect(await app.mergeSessions([a.id], two.id)).toEqual({
      error: "event",
    });
    expect(app.view.current?.id).toBe(a.id);
    expect(app.view.stats.count).toBe(2);

    // The open session went into B: B opens with all three, in time order.
    expect(await app.mergeSessions([a.id], b.id)).toMatchObject({
      into: { id: b.id, name: "B" },
    });
    expect(app.view.current?.id).toBe(b.id);
    expect(app.view.stats.count).toBe(3);
    expect(app.view.rows.map(({ solve }) => solve.id)).toEqual([
      "03000",
      "02000",
    ]);
    expect(app.view.sessions.map(({ id }) => id)).toEqual([b.id, two.id]);

    // A solve timed in B meanwhile stays in B after the undo.
    await store.solves.add(solve(b, 4000, 14000));
    await app.undo();
    expect(app.view.current?.id).toBe(a.id);
    expect(app.view.stats.count).toBe(2);
    expect(app.view.sessions.map(({ id }) => id)).toEqual([a.id, b.id, two.id]);
    expect(await store.solves.count(b.id)).toBe(2);
  } finally {
    await db.close();
  }
});

test("the open session splits before the solve on show and stays open; undo joins it again", async () => {
  const db = createNodeDb(":memory:");
  await migrate(db);
  const store = createStore(db);
  const app = createAppState(createPendingJournal(memoryStorage()), () => {}, {
    pageSize: 2,
  });
  try {
    await app.open({ kind: "persistent", store });
    const a = app.view.current;
    ok(a);
    await app.add(solve(a, 1000, 11000));
    await app.add(solve(a, 2000, 12000));
    await app.add(solve(a, 3000, 13000));
    const name = (last: Solve, session: Session) =>
      `${session.name} until ${last.startedAt}`;

    // Nothing comes before the first solve.
    expect(await app.splitBefore("01000", name)).toEqual({ error: "first" });

    await app.showSolve("02000");
    expect(await app.splitBefore("02000", name)).toMatchObject({
      moved: 1,
      into: { name: `${a.name} until 1000`, event: a.event },
    });
    expect(app.view.current?.id).toBe(a.id);
    expect(app.view.stats.count).toBe(2);
    expect(app.view.shown?.solve.id).toBe("02000");
    const made = app.view.sessions[0];
    ok(made);
    expect(app.view.sessions.map(({ id }) => id)).toEqual([made.id, a.id]);
    expect(await store.solves.count(made.id)).toBe(1);

    await app.undo();
    expect(app.view.current?.id).toBe(a.id);
    expect(app.view.stats.count).toBe(3);
    expect(app.view.sessions.map(({ id }) => id)).toEqual([a.id]);
  } finally {
    await db.close();
  }
});

test("the solve on show and a selection move to another session of their puzzle, and back by undo", async () => {
  const db = createNodeDb(":memory:");
  await migrate(db);
  const store = createStore(db);
  const app = createAppState(createPendingJournal(memoryStorage()), () => {}, {
    pageSize: 2,
  });
  try {
    await app.open({ kind: "persistent", store });
    const a = app.view.current;
    ok(a);
    const other = await store.sessions.create({ name: "Other", event: "333" });
    const two = await store.sessions.create({ name: "Two", event: "222" });
    const at = (id: string, startedAt: number): Solve => ({
      ...solve(a, 0, 10000 + startedAt),
      id,
      startedAt,
      scramble: `scramble ${id}`,
    });
    for (const item of [
      at("a", 1000),
      at("b", 2000),
      at("c", 3000),
      at("d", 4000),
    ])
      await app.add(item);
    const selected = () => [...app.view.selected].sort();

    // b on show, d added with a toggle: the selection is both.
    await app.browse(-1);
    await app.browse(-1);
    expect(app.view.shown).toMatchObject({ solve: { id: "b" }, no: 2 });
    await app.toggleSelected("d");
    expect(selected()).toEqual(["b", "d"]);

    // Another puzzle refuses the whole batch; nothing changes, the selection stays.
    expect(await app.moveSolves(two.id)).toEqual({ error: "event" });
    expect(selected()).toEqual(["b", "d"]);
    expect(app.view.stats.count).toBe(4);

    const moved = await app.moveSolves(other.id);
    expect(moved).toMatchObject({
      moved: 2,
      to: { id: other.id, name: "Other" },
    });
    expect(app.view.stats.count).toBe(2);
    expect(app.view.rows.map(({ solve }) => solve.id)).toEqual(["c", "a"]);
    // The shown solve went: the one before it shows.
    expect(app.view.shown).toMatchObject({ solve: { id: "a" }, no: 1 });
    expect(selected()).toEqual([]);
    expect(
      (await store.solves.page(other.id, { limit: 5 })).map((row) => [
        row.id,
        row.scramble,
        row.timeMs,
      ]),
    ).toEqual([
      ["d", "scramble d", 14000],
      ["b", "scramble b", 12000],
    ]);

    // Undo moves them back by ID; a comment written there meanwhile stays.
    await store.solves.setComment("b", "new");
    await app.undo();
    expect(app.view.stats.count).toBe(4);
    expect(app.view.shown).toMatchObject({
      solve: { id: "b", comment: "new" },
      no: 2,
    });
    expect(await store.solves.count(other.id)).toBe(0);

    // Shift+arrows: a range from where they start, which shrinks on the way back.
    await app.live();
    expect(await app.extend(-1)).toBe(true);
    expect(selected()).toEqual(["c", "d"]);
    await app.extend(-1);
    expect(selected()).toEqual(["b", "c", "d"]);
    await app.extend(1);
    expect(selected()).toEqual(["c", "d"]);
    expect(app.view.shown).toMatchObject({ solve: { id: "c" } });
    // Shift+click: from the same start to the line clicked, past the loaded page.
    await app.selectRange("a");
    expect(selected()).toEqual(["a", "b", "c", "d"]);
    await app.clearSelection();
    expect(selected()).toEqual([]);
    expect(app.view.shown).toMatchObject({ solve: { id: "c" } });

    // Delete takes the whole selection, and undo brings it all back.
    await app.toggleSelected("a");
    expect(selected()).toEqual(["a", "c"]);
    await app.deleteSelected();
    expect(app.view.stats.count).toBe(2);
    expect(selected()).toEqual([]);
    await app.undo();
    expect(app.view.stats.count).toBe(4);

    // Into a new session of the same puzzle, made by name; the open one stays open.
    await app.showSolve("c");
    const split = await app.moveSolves({ name: "Split" });
    ok("to" in split);
    expect(split.to).toMatchObject({ name: "Split", event: "333" });
    expect(app.view.current?.id).toBe(a.id);
    expect(app.view.sessions.map(({ name }) => name)).toContain("Split");
    expect(await store.solves.count(split.to.id)).toBe(1);

    // Another session drops the selection; a plain arrow does too.
    await app.toggleSelected("a");
    await app.browse(1);
    expect(selected()).toEqual([]);
    await app.toggleSelected("a");
    await app.selectSession(other.id);
    expect(selected()).toEqual([]);
  } finally {
    await db.close();
  }
});

test("a solve finished during a session switch stays with its start session and event", async () => {
  const { db, app, store, open } = await setup();
  try {
    await open();
    const first = app.view.current;
    ok(first);
    const second = await store.sessions.create({ name: "Two", event: "222" });
    await open();

    let entered = () => {};
    let resume = () => {};
    const opening = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const readSeries = store.solves.series;
    store.solves.series = async (id) => {
      if (id === second.id) {
        entered();
        await paused;
      }
      return readSeries(id);
    };

    let saved = Promise.resolve();
    const timer = createTimerController({
      clock: () => ({ wall: 2000, perf: 1400 }),
      scramble: () => "R U",
      session: app.session,
      onChange: () => {},
      onSolve: (result) => {
        saved = app.add(result);
      },
    });
    timer.dispatch({ type: "press", at: 0 });
    timer.dispatch({ type: "release", at: 400 });
    const switching = app.selectSession(second.id);
    await opening;
    timer.dispatch({ type: "press", at: 1400 });
    resume();
    await switching;
    await saved;
    expect(app.view.current?.id).toBe(second.id);
    expect(app.view.rows).toEqual([]);
    expect(await store.solves.page(first.id, { limit: 1 })).toEqual([
      expect.objectContaining({
        event: "333",
        sessionId: first.id,
        scramble: "R U",
      }),
    ]);
  } finally {
    await db.close();
  }
});

test("inspection +2 stacks, DNF preserves the count, and OK clears both", async () => {
  const { db, app, open } = await setup();
  try {
    await open();
    const session = app.view.current;
    ok(session);
    const initial = solve(session, 1, 11280, { inspectionMs: 15800, plus2: 1 });
    await app.add(initial);
    await app.penalty(initial, "plus2");
    expect(app.view.rows[0]?.solve).toMatchObject({ plus2: 2, dnf: false });
    await app.penalty(initial, "dnf");
    expect(app.view.rows[0]?.solve).toMatchObject({ plus2: 2, dnf: true });
    await app.penalty(initial, "dnf");
    expect(app.view.rows[0]?.solve).toMatchObject({ plus2: 2, dnf: false });
    await app.penalty(initial, "plus2");
    expect(app.view.rows[0]?.solve).toMatchObject({ plus2: 1, dnf: false });
    await app.penalty(initial, "dnf");
    await app.penalty(initial, "ok");
    expect(app.view.rows[0]?.solve).toMatchObject({ plus2: 0, dnf: false });
    await app.undo();
    expect(app.view.rows[0]?.solve).toMatchObject({ plus2: 1, dnf: true });
  } finally {
    await db.close();
  }
});

test("+2 leaves a Fewest Moves solve untouched in storage and undo history", async () => {
  const { db, app, open, store } = await setup();
  try {
    const setPenalty = vi.spyOn(store.solves, "setPenalty");
    await open();
    await app.newSession("Moves", "333fm");
    const session = app.view.current;
    ok(session);
    const initial = solve(session, 1, 0, { moves: 25, input: "manual" });
    await app.add(initial);
    expect(app.view.canUndo).toBe(false);

    await app.penalty(initial, "plus2");

    expect(app.view.rows[0]?.solve).toMatchObject(initial);
    expect((await store.solves.get(initial.id))?.plus2).toBe(0);
    expect(setPenalty).not.toHaveBeenCalled();
    expect(app.view.canUndo).toBe(false);
    await app.penalty(initial, "dnf");
    expect(app.view.rows[0]?.solve).toMatchObject({ plus2: 0, dnf: true });
  } finally {
    await db.close();
  }
});

test("+2 extends the time of a Multi-Blind result", async () => {
  const { db, app, open } = await setup();
  try {
    await open();
    await app.newSession("Multi", "333mbf");
    const session = app.view.current;
    ok(session);
    const initial = solve(session, 1, 60_000, {
      cubesSolved: 2,
      cubesAttempted: 2,
    });
    await app.add(initial);
    const best = app.view.stats.best;

    await app.penalty(initial, "plus2");

    expect(app.view.rows[0]?.solve.plus2).toBe(1);
    expect(app.view.stats.best).toBe(best + 200);
  } finally {
    await db.close();
  }
});

test("paging and edits use the full time series and keep the same order after reopening", async () => {
  const { db, app, open, store } = await setup();
  try {
    await open();
    const session = app.view.current;
    ok(session);
    for (let i = 1; i <= 205; i++) {
      await store.solves.add(solve(session, i, 500 + ((i * 37) % 1000)));
    }
    await open();
    expect(app.view.rows).toHaveLength(200);
    expect(app.view.rows.at(-1)?.no).toBe(6);
    await app.more();
    expect(app.view.rows).toHaveLength(205);
    expect(app.view.rows.at(-1)?.no).toBe(1);

    const row = app.view.rows[185];
    ok(row);
    const old = row.solve;
    await app.deleteSolve(old);
    await app.add(solve(session, 206, 1100, { startedAt: old.startedAt - 2 }));
    await app.undo();
    await app.penalty(old, "dnf");
    await app.setComment(old, "practice");
    const edited = app.view;
    await open();
    await app.more();
    expect(app.view.rows).toEqual(
      edited.rows.map((row) => ({
        ...row,
        solve: {
          moves: null,
          solution: null,
          cubesSolved: null,
          cubesAttempted: null,
          ...row.solve,
        },
      })),
    );
    expect(app.view.stats).toEqual(edited.stats);
  } finally {
    await db.close();
  }
});

test("a pre-open 3×3 solve keeps its event when the saved current session uses another puzzle", async () => {
  const { db, app, store, open } = await setup();
  try {
    const second = await store.sessions.create({ name: "Two", event: "222" });
    await store.settings.set("session.current", second.id);
    await app.add({
      id: "early",
      sessionId: "",
      event: "333",
      timeMs: 1000,
      plus2: 0,
      dnf: false,
      startedAt: 1,
      scramble: "R U",
      inspectionMs: null,
      comment: null,
      input: "keyboard",
    });
    expect(app.view.rows[0]?.solve.id).toBe("early");
    await open();
    expect(app.view.current?.id).toBe(second.id);
    expect(app.view.rows).toEqual([]);
    const three = app.view.sessions.find((item) => item.event === "333");
    ok(three);
    expect(await store.solves.page(three.id, { limit: 1 })).toEqual([
      expect.objectContaining({ event: "333", scramble: "R U" }),
    ]);
  } finally {
    await db.close();
  }
});

test("9i1a: an equal best single and equal shown average set record marks", async () => {
  const { db, app, open } = await setup();
  try {
    await open();
    const session = app.view.current;
    ok(session);
    for (let i = 0; i < 6; i++) await app.add(solve(session, i, 10_000));
    expect(app.view.rows[0]).toMatchObject({ record: true });
    expect(app.view.records).toMatchObject({ best: true, ao5: true });
  } finally {
    await db.close();
  }
});

test("A4d1+: switching inspection off leaves the stored 15.00 s penalty intact", async () => {
  const { db, app, open } = await setup();
  try {
    await open();
    const session = app.view.current;
    ok(session);
    const penalised = solve(session, 1, 10_000, {
      inspectionMs: 15_000,
      plus2: 1,
    });
    await app.add(penalised);
    await app.setSetting("inspection", "off", session.id);
    expect(app.view.settings.inspection).toBe("off");
    await open();
    expect(app.view.settings.inspection).toBe("off");
    expect(app.view.rows[0]?.solve).toMatchObject(penalised);
  } finally {
    await db.close();
  }
});

test("R times a past scramble again: attempts are listed under it and stay out of the averages", async () => {
  const { db, app, open, store } = await setup();
  try {
    await open();
    const session = app.view.current;
    ok(session);
    for (const [n, ms] of [
      [1, 10000],
      [2, 12000],
      [3, 14000],
      [4, 11000],
      [5, 13000],
    ] as const)
      await app.add(solve(session, n, ms, { scramble: `S${n}` }));
    const ao5 = app.view.stats.ao5;
    expect(ao5).toBe(12000);

    await app.browse(-1);
    await app.browse(-1);
    expect(app.view.shown?.solve.id).toBe("00003");
    expect(await app.repeat()).toBe(true);
    expect(app.view.browsing).toBe(false);
    expect(app.view.repeat?.root.id).toBe("00003");
    expect(app.view.repeat?.no).toBe(3);
    expect(app.view.repeat?.shown.id).toBe("00003");

    // The timer times the root's scramble and saves each attempt as its repeat.
    const repeat = app.view.repeat;
    ok(repeat);
    let now = 100;
    const timer = createTimerController({
      clock: () => ({ wall: 50_000 + now, perf: now }),
      scramble: () => repeat.root.scramble,
      session: () => session,
      onChange: () => {},
      onSolve: (timed) => void app.add({ ...timed, repeatOf: repeat.root.id }),
    });
    for (const ms of [9000, 8000]) {
      now += 10;
      timer.dispatch({ type: "press", at: now });
      now += 400;
      timer.dispatch({ type: "release", at: now });
      now += ms;
      timer.dispatch({ type: "press", at: now });
      timer.dispatch({ type: "release", at: now + 50 });
      now += 300;
    }
    await vi.waitFor(() => expect(app.view.repeat?.attempts.length).toBe(3));
    const attempts = app.view.repeat?.attempts ?? [];
    expect(attempts.map(({ timeMs }) => timeMs)).toEqual([14000, 9000, 8000]);
    expect(attempts.slice(1).every(({ scramble }) => scramble === "S3")).toBe(
      true,
    );
    expect(app.view.repeat?.shown.timeMs).toBe(8000);
    expect(app.view.stats.ao5).toBe(ao5);
    expect(app.view.stats.count).toBe(5);
    expect(
      app.view.rows.find(({ solve: row }) => row.id === "00003")?.solve.repeats,
    ).toBe(2);

    // Edits go to the attempt on show; undo puts it back.
    const newest = app.view.repeat?.shown;
    ok(newest);
    await app.penalty(newest, "dnf");
    expect(app.view.repeat?.shown.dnf).toBe(true);
    expect(app.view.stats.ao5).toBe(ao5);
    await app.deleteSolve(app.view.repeat?.shown as Solve);
    expect(app.view.repeat?.attempts.map(({ timeMs }) => timeMs)).toEqual([
      14000, 9000,
    ]);
    await app.undo();
    expect(app.view.repeat?.attempts.length).toBe(3);
    await app.undo();
    expect(app.view.repeat?.attempts.at(-1)?.dnf).toBe(false);

    // Leaving brings the new scrambles back; the repeats stay with their root.
    await app.leaveRepeat();
    expect(app.view.repeat).toBeNull();
    expect((await store.repeats.list("00003")).length).toBe(2);
    expect([...(await store.solves.series(session.id)).values]).toEqual([
      10000, 12000, 14000, 11000, 13000,
    ]);

    // The newest solve can be repeated too; a new session leaves the mode.
    expect(await app.repeat()).toBe(true);
    expect(app.view.repeat?.root.id).toBe("00005");
    await app.newSession("Other", "333");
    expect(app.view.repeat).toBeNull();
  } finally {
    await db.close();
  }
});
