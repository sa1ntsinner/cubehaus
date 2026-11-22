import { expect, test } from "vitest";
import {
  defaultStats,
  EVENTS,
  eventInfo,
  formatAverage,
  formatTime,
  isRecord,
} from "./index";

test("A3a1: inspection is 15 seconds for timed speedsolving events", () => {
  for (const { id, inspectionMs } of EVENTS) {
    const withoutInspection = ["333bf", "444bf", "555bf", "333mbf", "333fm"];
    expect(inspectionMs, id).toBe(
      withoutInspection.includes(id) ? null : 15000,
    );
  }
});

test("9f1 A7b2: singles truncate to hundredths below 10 minutes", () => {
  expect(formatTime(12678)).toBe("12.67");
  expect(formatTime(12679)).toBe("12.67");
  expect(formatTime(599999)).toBe("9:59.99");
});

test("9f2: singles truncate to whole seconds from 10 minutes", () => {
  expect(formatTime(600000)).toBe("10:00");
  expect(formatTime(600990)).toBe("10:00");
  expect(formatTime(605500)).toBe("10:05");
});

test("9f2: long averages round half up to whole seconds", () => {
  expect(formatAverage(600490)).toBe("10:00");
  expect(formatAverage(600500)).toBe("10:01");
});

test("A7b1 A7b3: times omit leading zeros and keep measured trailing zeros", () => {
  expect(formatTime(3300)).toBe("3.30");
  expect(formatTime(62350)).toBe("1:02.35");
  expect(formatTime(3600000)).toBe("1:00:00");
  expect(formatTime(3723450)).toBe("1:02:03");
  expect(formatTime(605000)).toBe("10:05");
});

test("9b: events use the default formats and recognised averages from A1 and B7", () => {
  expect(
    EVENTS.map(({ id, format, recognised }) => [id, format, recognised]),
  ).toEqual([
    ["333", "ao5", null],
    ["222", "ao5", null],
    ["444", "ao5", null],
    ["555", "ao5", null],
    ["666", "mo3", null],
    ["777", "mo3", null],
    ["333bf", "bo5", "ao5"],
    ["333fm", "mo3", null],
    ["333oh", "ao5", null],
    ["clock", "ao5", null],
    ["minx", "ao5", null],
    ["pyram", "ao5", null],
    ["skewb", "ao5", null],
    ["sq1", "ao5", null],
    ["444bf", "bo3", "mo3"],
    ["555bf", "bo3", "mo3"],
    ["333mbf", "bo3", null],
    ["fto", "ao5", null],
  ]);
});

test("E2d and 9f12c: FMC counts moves and Multi-Blind has its own result kind", () => {
  for (const { id, kind } of EVENTS) {
    expect(kind, id).toBe(
      id === "333fm" ? "moves" : id === "333mbf" ? "multi" : "time",
    );
  }
});

test("B1a: 4x4x4 Blindfolded has no inspection", () => {
  expect(eventInfo("444bf").inspectionMs).toBeNull();
});

test("9i1a: a finite result equal to or better than the previous best counts", () => {
  expect(isRecord(12340, 12340)).toBe(true);
  expect(isRecord(12350, 12340)).toBe(false);
  expect(isRecord(Infinity, null)).toBe(false);
  expect(isRecord(12340, null)).toBe(true);
  expect(isRecord(NaN, null)).toBe(false);
});

test("E37: WCA post 2026-06-24 and draft 9b1: FTO starts 2027-01-02 with Ao5 and Clock ends 2027-07-18", () => {
  for (const { id, officialFrom, officialUntil } of EVENTS) {
    expect(officialFrom, id).toBe(id === "fto" ? "2027-01-02" : null);
    expect(officialUntil, id).toBe(id === "clock" ? "2027-07-18" : null);
  }
  expect(eventInfo("fto")).toMatchObject({
    format: "ao5",
    inspectionMs: 15000,
  });
});

test("9b and B7: default stat pairs include the event's official average where applicable", () => {
  expect(EVENTS.map(({ id }) => [id, ...defaultStats(id)])).toEqual([
    ["333", "ao5", "ao12"],
    ["222", "ao5", "ao12"],
    ["444", "ao5", "ao12"],
    ["555", "ao5", "ao12"],
    ["666", "mo3", "ao5"],
    ["777", "mo3", "ao5"],
    ["333bf", "best", "ao5"],
    ["333fm", "mo3", "best"],
    ["333oh", "ao5", "ao12"],
    ["clock", "ao5", "ao12"],
    ["minx", "ao5", "ao12"],
    ["pyram", "ao5", "ao12"],
    ["skewb", "ao5", "ao12"],
    ["sq1", "ao5", "ao12"],
    ["444bf", "best", "mo3"],
    ["555bf", "best", "mo3"],
    ["333mbf", "best", "count"],
    ["fto", "ao5", "ao12"],
  ]);
});
