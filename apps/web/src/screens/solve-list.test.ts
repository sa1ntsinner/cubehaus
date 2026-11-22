import type { EventId, Solve } from "@cubehaus/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { type AppView, createAppState } from "../app-state";
import { createPendingJournal, memoryStorage } from "../db/pending";
import type { Settings } from "../settings";
import { text } from "../text";
import { SolveList, slotsFor } from "./SolveList";

test.each([
  ["333fm", []],
  ["333", ["penalty-plus2"]],
  ["333mbf", ["penalty-plus2"]],
] as const)("last-solve actions appear in order for %s", (event, plus2) => {
  const app = createAppState(createPendingJournal(memoryStorage()), () => {});
  const html = renderToStaticMarkup(
    createElement(SolveList, {
      app,
      onMove: () => {},
      onSplit: () => {},
      words: text,
      view: {
        ...app.view,
        current: {
          event,
          id: "session",
          name: "Practice",
          orderKey: "a0",
          folderId: null,
          archived: false,
          createdAt: 0,
        },
      },
    }),
  );
  const actions = html.match(/data-part="last-actions"[^>]*>(.*?)<\/div>/)?.[1];
  expect(
    Array.from(
      (actions ?? "").matchAll(/data-action="([^"]+)"/g),
      (match) => match[1],
    ),
  ).toEqual(["penalty-ok", ...plus2, "penalty-dnf", "solve-delete", "undo"]);
});

function renderSession(
  values: number[],
  event: EventId,
  settings: Partial<Settings> = {},
) {
  const solves = values.map(
    (value, index): Solve => ({
      id: String(index),
      sessionId: "session",
      event,
      timeMs: Number.isFinite(value) ? value : 0,
      plus2: 0,
      dnf: value === Infinity,
      scramble: "R U",
      startedAt: index,
      inspectionMs: null,
      comment: null,
      input: "keyboard",
      ...(event === "333mbf" ? { cubesSolved: 3, cubesAttempted: 3 } : {}),
    }),
  );
  const app = createAppState(
    createPendingJournal(
      memoryStorage([["cubehaus.pending", JSON.stringify(solves)]]),
    ),
    () => {},
  );
  const view: AppView = {
    ...app.view,
    settings: { ...app.view.settings, ...settings },
    current: {
      event,
      id: "session",
      name: "Practice",
      orderKey: "a0",
      folderId: null,
      archived: false,
      createdAt: 0,
    },
  };
  return renderToStaticMarkup(
    createElement(SolveList, {
      app,
      view,
      words: text,
      onMove: () => {},
      onSplit: () => {},
    }),
  );
}

test("focus omits the file and retains event-appropriate stats", () => {
  const focus = renderSession([12349, 600990], "333", { layout: "focus" });
  expect(focus).not.toContain('data-part="file"');
  expect(focus).toContain('data-slot="mean"');
  expect(slotsFor("333", "lift")).toEqual(["ao5", "ao12"]);
  expect(slotsFor("333", "times")).toEqual(["ao5", "ao12", "best", "mean"]);
  expect(slotsFor("333", "focus")).toEqual(["ao5", "ao12", "best", "mean"]);
  expect(slotsFor("333mbf", "focus")).toEqual([]);
  expect(slotsFor("333fm", "focus")).toEqual(["mo3", "best", "mean"]);
  const times = renderSession([12349, 600990], "333", {
    layout: "times",
    precision: 3,
    recordCue: false,
  });
  expect(times).not.toContain("data-record=");
  expect(times).not.toContain('data-part="solve-ao5"');
  expect(times).toContain('data-part="solve-time">12.349');
  expect(times).toContain('data-part="solve-time">10:00');
});

function totals(values: number[], event: EventId = "333") {
  return renderSession(values, event).match(
    /<dl data-part="stats-totals"[^>]*>(.*?)<\/dl>/,
  )?.[1];
}

test.each([
  ["first 333bf solve", "333bf", [1200], ["ao5"], undefined],
  ["slower 333bf solve", "333bf", [1200, 2000], ["best", "ao5"], "1.20"],
  ["tied 333bf solve", "333bf", [1200, 2000, 1200], ["ao5"], undefined],
  ["DNF 333bf solve", "333bf", [1200, Infinity], ["best", "ao5"], "1.20"],
  ["newest 666 best", "666", [90_000, 100_000, 80_000], ["mo3"], undefined],
] as const)(
  "%s prints only the applicable slots",
  (_, event, values, names, best) => {
    const slots =
      renderSession([...values], event).match(
        /<p data-part="stats-now">(.*?)<\/p>/,
      )?.[1] ?? "";
    expect(
      Array.from(slots.matchAll(/data-slot="([^"]+)"/g), ([, name]) => name),
    ).toEqual(names);
    expect(slots.match(/data-stat="best"[^>]*>(.*?)<\/span>/)?.[1]).toBe(best);
  },
);

test.each([[], [10_000], [10_000, Infinity], [Infinity, Infinity]])(
  "totals are absent with fewer than two finite results (%j)",
  (...values) => {
    expect(totals(values)).toBeUndefined();
  },
);

test("Multi-Blind has no totals even with two successful attempts", () => {
  expect(totals([1_480_000, 1_470_000], "333mbf")).toBeUndefined();
});

test("best and mean appear once there are two finite results", () => {
  const html = totals([10_000, Infinity, 12_000]);
  expect(html).toContain('data-total="best"');
  expect(html).toContain(">10.00</dd>");
  expect(html).toContain('data-total="mean"');
  expect(html).toContain(">11.00</dd>");
  expect(html).not.toContain('data-total="count"');
});

test.each([12_000, 10_000])(
  "the newest best single is left out of totals with an earlier %i",
  (earlier) => {
    const html = totals([earlier, 10_000]);
    expect(html).not.toContain('data-total="best"');
    expect(html).toContain('data-total="mean"');
  },
);

test.each([
  ["ao5", 5],
  ["ao12", 12],
] as const)("%s best needs two windows and a finite best", (name, size) => {
  const values = Array<number>(size).fill(10_000);
  expect(totals(values)).not.toContain(`data-total="${name}-best"`);
  expect(totals([...values, 11_000])).toContain(`data-total="${name}-best"`);
  expect(totals(Array<number>(size + 1).fill(Infinity))).toBeUndefined();
});

test("a DNF window counts as a stat value but cannot supply its best", () => {
  const html = totals([10_000, 11_000, 12_000, Infinity, 13_000, Infinity]);
  expect(html).toContain('data-stat="ao5-best">12.00</dd>');
});
