import { statOf } from "@cubehaus/stats";
import { createStore, migrate } from "@cubehaus/storage";
import { createNodeDb } from "@cubehaus/storage/node";
import { expect, test, vi } from "vitest";
import {
  formatProgressDifference,
  progressDetails,
  progressEvents,
} from "./progress-data";
import { createProgressReader } from "./progress-worker";

test("loads and computes progress for 100,000 stored solves in under 1 s", async () => {
  const db = createNodeDb(":memory:");
  try {
    await migrate(db);
    const store = createStore(db, () => 0);
    const session = await store.sessions.create({
      name: "Practice",
      event: "333",
    });
    const count = 100_000;
    const first = new Date(2024, 0, 1, 12).getTime();
    let seed = 42;
    for (let offset = 0; offset < count; offset += 5000) {
      await store.solves.addImported(
        Array.from({ length: 5000 }, (_, i) => {
          const index = offset + i;
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          return {
            id: String(index),
            sessionId: session.id,
            event: session.event,
            timeMs: 5000 + (seed % 25000),
            plus2: Number(index % 97 === 0),
            dnf: index % 31 === 0,
            scramble: "R U",
            startedAt: first + index * 600_000,
            inspectionMs: null,
            comment: null,
            input: "imported",
            importSource: "test",
            importHash: String(index),
          };
        }),
      );
    }

    const started = performance.now();
    const loaded = await store.solves.scopedSeries({
      kind: "session",
      id: session.id,
      event: session.event,
    });
    const details = progressDetails(loaded, first + count * 600_000);
    const elapsed = performance.now() - started;
    console.info(`Progress for 100,000 solves: ${elapsed.toFixed(1)} ms`);

    expect(loaded.values.length).toBe(count);
    expect(details.current?.name).toBe("ao100");
    expect(details.current?.comparisons.map(({ key }) => key)).toEqual([
      30,
      365,
      "best",
    ]);
    expect(details.pbs.map(({ name }) => name)).toEqual([
      "single",
      "ao5",
      "ao12",
      "ao100",
    ]);
    expect(
      [...details.days.values()].reduce((sum, count) => sum + count, 0),
    ).toBe(count);
    expect(details.practice.activeDays).toBe(details.days.size);
    expect(elapsed).toBeLessThan(1000);
    const reader = createProgressReader(store);
    const chart = await reader.readProgress(
      { kind: "session", id: session.id, event: session.event },
      {
        revision: 1,
        now: first + count * 600_000,
        width: 20,
        stat: "ao100",
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    );
    expect(chart.series.length).toBeLessThanOrEqual(40);
    const index = count - 2;
    const point = await reader.point(chart.key, index);
    expect(point?.index).toBe(index);
    expect(point?.value).toBeCloseTo(
      statOf(loaded.values.subarray(index - 99, index + 1), {
        kind: "ao",
        n: 100,
      }),
    );
  } finally {
    await db.close();
  }
});

test("events keep view order and include the selected empty session only", () => {
  const event = (id: string, values: number[]) => ({
    session: { id },
    count: values.length,
  });
  const empty = event("empty", []);
  const dnf = event("dnf", [Infinity]);
  const selected = event("selected", []);
  const practice = event("practice", [1000]);
  const sessions = [empty, dnf, selected, practice];
  expect(progressEvents(sessions, selected.session.id)).toEqual([
    dnf,
    selected,
    practice,
  ]);
  expect(progressEvents(sessions, practice.session.id)).toEqual([
    dnf,
    practice,
  ]);
});

test("DNF-only solves still count as practice without bests or comparisons", () => {
  const day = new Date(2026, 2, 2, 12).getTime();
  const details = progressDetails(
    {
      values: Float64Array.from({ length: 5 }, () => Infinity),
      startedAt: Float64Array.from({ length: 5 }, (_, index) => day + index),
    },
    day,
  );
  expect(details.current).toMatchObject({
    name: "ao5",
    value: Infinity,
    comparisons: [],
    record: undefined,
  });
  expect(details.pbs).toEqual([]);
  expect([...details.days]).toEqual([["2026-03-02", 5]]);
  expect(details.practice.longestRun?.days).toBe(1);
});

test.each([
  {
    daysAgo: 40,
    expected: [
      { key: 365, delta: 500 },
      { key: "best", delta: 500 },
    ],
  },
  { daysAgo: 400, expected: [{ key: "best", delta: 500 }] },
  {
    daysAgo: 0,
    expected: [
      { key: 30, delta: 500 },
      { key: 365, delta: 500 },
      { key: "best", delta: 500 },
    ],
  },
])(
  "compares only cutoffs followed by a solve ($daysAgo days since last solve)",
  ({ daysAgo, expected }) => {
    const now = new Date(2026, 2, 2, 12).getTime();
    const before = (days: number) => new Date(2026, 2, 2 - days, 12).getTime();
    const details = progressDetails(
      {
        values: Float64Array.from({ length: 10 }, (_, i) =>
          i < 5 ? 10_000 : 10_500,
        ),
        startedAt: Float64Array.from(
          { length: 10 },
          (_, i) => (i < 5 ? before(500) : before(daysAgo)) + i,
        ),
      },
      now,
    );
    expect(details.current?.comparisons).toEqual(expected);
  },
);

test.each([
  [13_094, 12_366, 720, "+0.72"],
  [13_096, 12_364, 740, "+0.74"],
  [600_500, 599_500, 1500, "+1.50"],
])(
  "compares the displayed averages for %s ms and %s ms",
  (current, previous, delta, label) => {
    const past = new Date(2025, 0, 1, 12).getTime();
    const now = new Date(2026, 2, 2, 12).getTime();
    const details = progressDetails(
      {
        values: Float64Array.from({ length: 200 }, (_, i) =>
          i < 100 ? previous : current,
        ),
        startedAt: Float64Array.from({ length: 200 }, (_, i) =>
          i < 100 ? past + i : now + i,
        ),
      },
      now,
    );
    expect(details.current?.name).toBe("ao100");
    expect(details.current?.comparisons).toEqual([
      { key: 30, delta },
      { key: 365, delta },
      { key: "best", delta },
    ]);
    expect(
      details.current?.comparisons.map(
        ({ delta }) => formatProgressDifference(delta).label,
      ),
    ).toEqual([label, label, label]);
  },
);

test("folder scope interleaves ties and ignores deleted sessions", async () => {
  const db = createNodeDb(":memory:");
  try {
    await migrate(db);
    const store = createStore(db, () => 10000);
    const a = await store.sessions.create({ name: "A", event: "333" });
    const b = await store.sessions.create({ name: "B", event: "333" });
    const c = await store.sessions.create({ name: "C", event: "333fm" });
    const folder = await store.folders.create("F", [a.id, b.id, c.id]);
    const entries = [
      // A's ids sort after B's, so a tie must be broken by id, not by the
      // order the rows were written.
      [a, "x1", 1000, 10000],
      [b, "b1", 1000, 11000],
      [a, "x2", 2000, 12000],
      [b, "b2", 2000, 13000],
      [a, "x3", 3000, 14000],
      [c, "c1", 2000, 31],
    ] as const;
    for (const [session, id, startedAt, timeMs] of entries) {
      await store.solves.add({
        id,
        sessionId: session.id,
        event: session.event,
        timeMs,
        startedAt,
        ...(session.event === "333fm" ? { moves: timeMs } : {}),
        plus2: 0,
        dnf: false,
        scramble: "R",
        inspectionMs: null,
        comment: null,
        input: "keyboard",
      });
    }
    await store.sessions.setArchived(b.id, true);
    for (let i = 3; i < 50; i++) {
      await store.sessions.create({ name: `Practice ${i}`, event: "333" });
    }
    const read = vi.spyOn(store.solves, "scopedSeries");
    const reader = createProgressReader(store);
    const scope = { kind: "folder", id: folder.id, event: "333" } as const;
    const options = {
      now: 10000,
      width: 360,
      stat: "ao5",
      timeZone: "UTC",
    } as const;
    const first = await reader.readProgress(scope, { ...options, revision: 1 });
    expect(first.count).toBe(5);
    expect(first.current.ao5).toBe(12000);
    expect(read).toHaveBeenCalledExactlyOnceWith(scope);
    const raw = await store.solves.scopedSeries(scope);
    expect([...raw.values]).toEqual([11000, 10000, 13000, 12000, 14000]);
    expect([...raw.startedAt]).toEqual([1000, 1000, 2000, 2000, 3000]);
    expect(await reader.counts(1)).toEqual({ [a.id]: 3, [b.id]: 2, [c.id]: 1 });
    const point = await reader.point(first.key, 4);
    expect(point).toEqual({ index: 4, startedAt: 3000, value: 12000 });

    await store.sessions.remove(b.id);
    expect(
      (await reader.readProgress(scope, { ...options, revision: 2 })).count,
    ).toBe(3);
    await store.sessions.restore(b.id);
    expect(
      (await reader.readProgress(scope, { ...options, revision: 3 })).count,
    ).toBe(5);
    await store.solves.setPenalty("x2", { plus2: 0, dnf: true });
    const edited = await reader.readProgress(scope, {
      ...options,
      revision: 4,
    });
    expect(edited.current.ao5).toBeCloseTo(12666.666666, 5);
  } finally {
    await db.close();
  }
});

test("daily totals and the distribution follow the scope, the distribution on request", async () => {
  const db = createNodeDb(":memory:");
  try {
    await migrate(db);
    const store = createStore(db);
    const a = await store.sessions.create({ name: "A", event: "333" });
    const b = await store.sessions.create({ name: "B", event: "333" });
    const folder = await store.folders.create("F", [a.id, b.id]);
    const day = Date.UTC(2026, 10, 3, 9);
    const rows = [
      [a, 10000, day],
      [b, 10999, day + 60_000],
      [a, 12000, day + 86_400_000],
      [b, Infinity, day + 86_400_000 + 60_000],
    ] as const;
    for (const [index, [session, ms, at]] of rows.entries())
      await store.solves.add({
        id: `s${index}`,
        sessionId: session.id,
        event: "333",
        timeMs: Number.isFinite(ms) ? ms : 9000,
        startedAt: at,
        plus2: 0,
        dnf: !Number.isFinite(ms),
        scramble: "R",
        inspectionMs: null,
        comment: null,
        input: "keyboard",
      });
    const reader = createProgressReader(store);
    const model = await reader.readProgress(
      { kind: "folder", id: folder.id, event: "333" },
      { revision: 1, now: day, width: 300, stat: null, timeZone: "UTC" },
    );
    expect(model.totals).toEqual([
      { day: "2026-11-03", count: 2, dnf: 0, mean: 10499.5 },
      { day: "2026-11-04", count: 2, dnf: 1, mean: 12000 },
    ]);
    expect(await reader.distribution(model.key)).toEqual({
      bins: [
        { start: 10000, count: 2 },
        { start: 11000, count: 0 },
        { start: 12000, count: 1 },
      ],
      dnf: 1,
    });
    expect(await reader.distribution("unknown")).toBeNull();
  } finally {
    await db.close();
  }
});
