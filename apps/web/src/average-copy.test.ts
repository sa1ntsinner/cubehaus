import type { Solve } from "@cubehaus/core";
import { createStore, migrate } from "@cubehaus/storage";
import { createNodeDb } from "@cubehaus/storage/node";
import { expect, test, vi } from "vitest";
import {
  copyStatWindow,
  describeStatWindow,
  formatSolveLine,
  formatStatWindow,
} from "./average-copy";

test("copy ao5 copies exactly the shown five attempts in order", async () => {
  const db = createNodeDb(":memory:");
  try {
    await migrate(db);
    const store = createStore(db);
    const session = await store.sessions.create({
      name: "Practice",
      event: "333",
    });
    const fixture = [
      [10000, "R"],
      [11000, "U"],
      [12000, "F"],
      [11000, "L"],
      [15000, "D"],
      [1000, "B"],
    ] as const;
    const solves = fixture.map(
      ([timeMs, scramble], index): Solve => ({
        id: String(index + 1),
        sessionId: session.id,
        event: "333",
        timeMs,
        plus2: index === 3 ? 1 : 0,
        dnf: index === 4,
        scramble,
        startedAt: Math.min(index, 4),
        inspectionMs: null,
        comment: null,
        input: "keyboard",
      }),
    );
    for (const solve of solves) await store.solves.add(solve);

    const end = solves[4];
    if (!end) throw new Error("Missing fifth solve");
    const rows = await store.solves.getStatWindow(session.id, end, 5);
    expect(rows.map(({ id }) => id)).toEqual(["1", "2", "3", "4", "5"]);
    const stat = { kind: "ao", n: 5 } as const;
    const view = describeStatWindow(rows, stat);
    expect(
      view?.lines.flatMap(({ dropped }, index) => (dropped ? [index] : [])),
    ).toEqual([0, 4]);
    const text = [
      "ao5 12.00",
      "1. (10.00)  R",
      "2. 11.00  U",
      "3. 12.00  F",
      "4. 13.00+  L",
      "5. (DNF (15.00))  D",
    ].join("\n");
    expect(formatStatWindow(rows, stat, "en")).toBe(text);
    const denied = vi
      .fn()
      .mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    await expect(copyStatWindow(text, denied)).resolves.toEqual({
      kind: "fallback",
      text,
    });
    expect(denied).toHaveBeenCalledWith(text);
    await expect(
      copyStatWindow(text, vi.fn().mockResolvedValue(undefined)),
    ).resolves.toEqual({
      kind: "copied",
    });
    expect(formatStatWindow(rows.slice(1), stat, "en")).toBe("");
  } finally {
    await db.close();
  }
});

test("one solve copies as its result and scramble, as a line of the average's copy", () => {
  const solve = (over: Partial<Solve>): Solve => ({
    id: "1",
    sessionId: "s",
    event: "333",
    timeMs: 11283,
    plus2: 0,
    dnf: false,
    scramble: "R U R' F2",
    startedAt: 0,
    inspectionMs: null,
    comment: null,
    input: "keyboard",
    ...over,
  });
  expect(formatSolveLine(solve({}))).toBe("11.28  R U R' F2");
  expect(formatSolveLine(solve({ plus2: 1 }))).toBe("13.28+  R U R' F2");
  expect(formatSolveLine(solve({ dnf: true }))).toBe("DNF (11.28)  R U R' F2");
  expect(formatSolveLine(solve({}), 3)).toBe("11.283  R U R' F2");
});
