import { formatAverage, formatTime } from "@cubehaus/core";
import { best, rolling, statOf } from "@cubehaus/stats";
import { describe, expect, it, vi } from "vitest";
import {
  keepWidgetSnapshot,
  WIDGET_POINTS,
  WIDGET_SNAPSHOT_VERSION,
  widgetSnapshot,
  widgetsChanged,
  widgetTimes,
  widgetTrainer,
} from "./widget-snapshot";

// 70 made-up results between 9 s and 15 s, with two DNFs close together near the end.
const fixture = Float64Array.from({ length: 70 }, (_, i) =>
  i === 63 || i === 65 ? Infinity : 9000 + ((i * 7919) % 6000) + (i % 3) * 7,
);

describe("widgetTimes", () => {
  const times = widgetTimes({ name: "3×3", event: "333", values: fixture });

  it("names the session and counts its solves", () => {
    expect(times.session).toBe("3×3");
    expect(times.count).toBe(70);
  });

  it("gives the last 50 singles, a DNF as null", () => {
    const { values } = times.stats.single ?? { values: [] };
    expect(values).toHaveLength(WIDGET_POINTS);
    expect(values[0]).toBe(fixture[20]);
    expect(values[43]).toBeNull();
    expect(values[45]).toBeNull();
    expect(values[49]).toBe(fixture[69]);
  });

  it.each([
    ["mo3", { kind: "mo", n: 3 }],
    ["ao5", { kind: "ao", n: 5 }],
    ["ao12", { kind: "ao", n: 12 }],
  ] as const)("matches packages/stats for %s", (name, stat) => {
    const line = times.stats[name];
    const series = rolling(fixture, stat);
    expect(line?.values).toEqual(
      [...series.subarray(20)].map((v) => (v === Infinity ? null : v)),
    );
    expect(line?.current).toBe(formatAverage(statOf(fixture, stat)));
    expect(line?.best).toBe(best(series)?.value);
  });

  it("marks a window with too many DNFs", () => {
    // mo3 ending at 63 holds a DNF; ao5 and ao12 ending at 65 hold two, one more than
    // they drop; ao5 ending at 64 holds one and drops it.
    expect(times.stats.mo3?.values[43]).toBeNull();
    expect(times.stats.ao5?.values[44]).not.toBeNull();
    expect(times.stats.ao5?.values[45]).toBeNull();
    expect(times.stats.ao12?.values[45]).toBeNull();
  });

  it("writes the newest single as the timer does", () => {
    expect(times.stats.single?.current).toBe(formatTime(fixture[69] as number));
    const long = widgetTimes({
      name: "a",
      event: "333",
      values: Float64Array.of(62359, Infinity),
      precision: 3,
    });
    expect(long.stats.single?.current).toBe("DNF");
    // A penalty's mark is the file's: the page passes the newest solve as written.
    expect(
      widgetTimes({
        name: "a",
        event: "333",
        values: Float64Array.of(3910),
        newest: "3.91+",
      }).stats.single?.current,
    ).toBe("3.91+");
    expect(long.stats.single?.best).toBe(62359);
    expect(
      widgetTimes({ name: "a", event: "333", values: Float64Array.of(62359) })
        .stats.single?.current,
    ).toBe("1:02.35");
  });

  it("has no value before a window fills, and none in an empty session", () => {
    const short = widgetTimes({
      name: "a",
      event: "333",
      values: fixture.subarray(0, 4),
    });
    expect(short.stats.mo3?.values).toHaveLength(2);
    expect(short.stats.ao5).toEqual({
      values: [],
      current: null,
      best: null,
      record: false,
    });
    const empty = widgetTimes({
      name: "a",
      event: "333",
      values: new Float64Array(0),
    });
    expect(empty.count).toBe(0);
    expect(empty.stats.single).toEqual({
      values: [],
      current: null,
      best: null,
      record: false,
    });
  });

  it("carries the timer's record marks", () => {
    const marked = widgetTimes({
      name: "a",
      event: "333",
      values: fixture,
      records: { best: true, ao5: true },
    });
    expect(marked.stats.single?.record).toBe(true);
    expect(marked.stats.ao5?.record).toBe(true);
    expect(marked.stats.ao12?.record).toBe(false);
  });

  it("offers what the event has: a mean of moves, a Multi-Blind result alone", () => {
    const moves = widgetTimes({
      name: "FMC",
      event: "333fm",
      values: Float64Array.of(30, 28, 31),
    });
    expect(Object.keys(moves.stats)).toEqual(["single", "mo3"]);
    expect(moves.stats.single?.current).toBe("31");
    expect(moves.stats.mo3?.current).toBe("29.67");
    const multi = widgetTimes({
      name: "MBLD",
      event: "333mbf",
      values: new Float64Array(0),
    });
    expect(Object.keys(multi.stats)).toEqual(["single"]);
  });
});

describe("widgetTrainer", () => {
  const labels = new Map([
    ["a", "OLL 1"],
    ["b", "OLL 2"],
    ["c", "OLL 3"],
  ]);

  it("counts the cases in the drills and names the one due first", () => {
    expect(
      widgetTrainer({
        set: "oll",
        name: "OLL",
        ids: ["a", "b", "c"],
        learning: [
          { caseId: "c", dueAt: 300 },
          { caseId: "b", dueAt: 200 },
          { caseId: "gone", dueAt: 100 },
        ],
        labels,
      }),
    ).toEqual({ set: "oll", name: "OLL", done: 2, total: 3, next: "OLL 2" });
  });

  it("has no next case when none is in the drills", () => {
    expect(
      widgetTrainer({
        set: "oll",
        name: "OLL",
        ids: ["a", "b", "c"],
        learning: [],
        labels,
      }),
    ).toMatchObject({ done: 0, total: 3, next: null });
  });
});

describe("the snapshot", () => {
  it("carries its format version", () => {
    expect(widgetSnapshot(null, null)).toEqual({
      version: WIDGET_SNAPSHOT_VERSION,
      trainer: null,
      times: null,
    });
    expect(WIDGET_SNAPSHOT_VERSION).toBe(1);
  });

  it("is written after the last change, once, and at once on leaving", async () => {
    vi.useFakeTimers();
    const doc = new EventTarget() as EventTarget & {
      visibilityState: DocumentVisibilityState;
    };
    doc.visibilityState = "visible";
    let count = 0;
    const written: string[] = [];
    const stop = keepWidgetSnapshot(
      async () =>
        widgetSnapshot(null, {
          session: "a",
          count,
          stats: {},
        }),
      async (json) => void written.push(json),
      doc,
      1000,
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(written).toHaveLength(1);
    // Nothing changed: nothing written.
    widgetsChanged();
    await vi.advanceTimersByTimeAsync(1000);
    expect(written).toHaveLength(1);
    count = 1;
    widgetsChanged();
    await vi.advanceTimersByTimeAsync(500);
    widgetsChanged();
    await vi.advanceTimersByTimeAsync(500);
    expect(written).toHaveLength(1);
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(written).toHaveLength(2);
    expect(JSON.parse(written[1] as string).times.count).toBe(1);
    stop();
    count = 2;
    widgetsChanged();
    await vi.advanceTimersByTimeAsync(2000);
    expect(written).toHaveLength(2);
    vi.useRealTimers();
  });
});
