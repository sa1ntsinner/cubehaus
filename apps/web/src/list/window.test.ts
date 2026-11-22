import { ok } from "node:assert/strict";
import type { Solve } from "@cubehaus/core";
import { createStore, migrate } from "@cubehaus/storage";
import { createNodeDb } from "@cubehaus/storage/node";
import { expect, test, vi } from "vitest";
import { createAppState } from "../app-state";
import { createPendingJournal, memoryStorage } from "../db/pending";
import * as listWindow from "./window";

test.each([
  ["top with clipped overscan", 0, 50, 10, 100, 2, 0, 7],
  ["middle with partial rows", 23, 50, 10, 100, 1, 1, 9],
  ["bottom with clipped overscan", 950, 50, 10, 100, 2, 93, 100],
  ["empty list", 500, 50, 10, 0, 2, 0, 0],
  ["viewport taller than the list", 30, 50, 10, 3, 0, 0, 3],
  ["scroll beyond the end after a deletion", 980, 50, 10, 100, 0, 95, 100],
  ["scroll bounce before the start", -25, 50, 10, 100, 0, 0, 5],
  ["unmeasured rows", 0, 50, 0, 100, 2, 0, 0],
] as const)(
  "%s",
  (_, scroll, viewport, height, count, overscan, first, last) => {
    expect(
      listWindow.windowOf(scroll, viewport, height, count, overscan),
    ).toEqual({
      first,
      last,
      offset: first * height,
    });
  },
);

test("pages older rows through timestamp ties and keeps their stats and edits", async () => {
  const db = createNodeDb(":memory:");
  try {
    await migrate(db);
    const store = createStore(db);
    const session = await store.sessions.create({
      name: "Synthetic",
      event: "333",
    });
    const solveAt = (index: number): Solve => ({
      id: String(index).padStart(3, "0"),
      sessionId: session.id,
      event: "333",
      timeMs: 10_000 + index,
      startedAt: Math.floor(index / 5),
      inspectionMs: null,
      plus2: 0,
      dnf: false,
      scramble: "R U",
      comment: null,
      input: "keyboard",
    });
    const solves = Array.from({ length: 225 }, (_, index) => solveAt(index));
    for (const solve of solves) await store.solves.add(solve);
    const app = createAppState(createPendingJournal(memoryStorage()), () => {});
    const readSeries = vi.spyOn(store.solves, "series");
    await app.open({ kind: "persistent", store });
    expect(app.view.rows.length).toBeLessThan(solves.length);
    const page = await app.page(app.view, 201, 207);
    ok(page);
    expect(page.map(({ solve, no }) => [solve.id, no])).toEqual(
      solves
        .slice(18, 24)
        .reverse()
        .map((solve, index) => [solve.id, 24 - index]),
    );
    const target = page[0];
    ok(target);
    await app.setComment(target.solve, "Synthetic comment");
    const [updated] = (await app.page(app.view, 201, 202)) ?? [];
    expect(updated).toMatchObject({
      ao5: target.ao5,
      ao12: target.ao12,
      solve: { comment: "Synthetic comment" },
    });
    await app.undo();
    const [restored] = (await app.page(app.view, 201, 202)) ?? [];
    expect(restored?.solve.comment).toBeNull();
    await app.add({ ...solveAt(225), startedAt: 50 });
    expect(app.view.rows[0]?.no).toBe(226);
    const [shifted] = (await app.page(app.view, 202, 203)) ?? [];
    expect(shifted).toEqual(target);
    expect(readSeries).toHaveBeenCalledTimes(1);
  } finally {
    await db.close();
  }
});
