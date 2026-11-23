import { describe, expect, it } from "vitest";
import {
  type AttemptLike,
  gradeOf,
  newCard,
  nextCase,
  recall,
  recogMedian,
  review,
  roundOf,
  weakCases,
} from "./schedule";

const attempt = (
  caseId: string,
  execMs: number,
  at: number,
  missed = false,
): AttemptLike => ({ caseId, execMs, missed, at });

describe("schedule", () => {
  it("a slow attempt is Hard and a missed one Again", async () => {
    const before = [
      attempt("T", 2000, 1),
      attempt("T", 2200, 2),
      attempt("T", 1800, 3),
      attempt("Y", 9000, 4),
      // A missed attempt does not count in the median.
      attempt("T", 30_000, 5, true),
    ];
    // T's median is 2000 ms.
    expect(gradeOf(3100, false, before, "T")).toBe("hard");
    expect(gradeOf(2900, false, before, "T")).toBe("good");
    expect(gradeOf(1500, false, before, "T")).toBe("easy");
    expect(gradeOf(1500, true, before, "T")).toBe("again");
    // Under three clean attempts the person has no median yet: good.
    expect(gradeOf(9000, false, before.slice(0, 2), "T")).toBe("good");
    expect(gradeOf(1, false, before, "Y")).toBe("good");

    // A new card is due at once; Good moves it days ahead, Again keeps it within the day.
    const now = Date.UTC(2026, 10, 22, 10);
    const fresh = await newCard("T", now);
    expect(fresh.dueAt).toBe(now);
    const good = await review(fresh.card, "good", now);
    expect(good.dueAt - now).toBeGreaterThan(86_400_000);
    const again = await review(fresh.card, "again", now);
    expect(again.dueAt - now).toBeLessThan(86_400_000);
    // The same history gives the same schedule (no fuzz).
    expect((await review(fresh.card, "good", now)).dueAt).toBe(good.dueAt);
    // Recall falls with time after a review.
    const soon = await recall(good.card, now + 86_400_000);
    const later = await recall(good.card, now + 30 * 86_400_000);
    expect(soon).toBeGreaterThan(later);
    expect(await recall(fresh.card, now)).toBe(1);
  });

  it("a slow recognition makes an attempt Hard where recognition was timed", () => {
    const timed = (execMs: number, recogMs: number | null, at: number) => ({
      ...attempt("T", execMs, at),
      recogMs,
    });
    const before = [
      timed(2000, 600, 1),
      timed(2000, 500, 2),
      timed(2000, 700, 3),
      // Without recognition (a scramble drill), it counts for execution only.
      timed(2000, null, 4),
    ];
    expect(recogMedian(before, "T")).toBe(600);
    expect(recogMedian(before.slice(0, 2), "T")).toBeNull();
    // Execution as usual, recognition far slower than its median: Hard.
    expect(gradeOf(2000, false, before, "T", 1000)).toBe("hard");
    // Fast execution only earns Easy when the recognition was fast too.
    expect(gradeOf(1500, false, before, "T", 600)).toBe("good");
    expect(gradeOf(1500, false, before, "T", 400)).toBe("easy");
    // No recognition on this attempt, or none timed before: execution alone.
    expect(gradeOf(1500, false, before, "T", null)).toBe("easy");
    const untimed = before.map((a) => ({ ...a, recogMs: null }));
    expect(gradeOf(1500, false, untimed, "T", 5000)).toBe("easy");
    expect(gradeOf(2000, true, before, "T", 100)).toBe("again");
  });

  it("due cases come first, never the same twice running", () => {
    const cases = [
      { caseId: "A", dueAt: 50, recall: 0.9 },
      { caseId: "B", dueAt: 10, recall: 0.95 },
      { caseId: "C", dueAt: 500, recall: 0.2 },
    ];
    expect(nextCase(cases, 100, null)).toBe("B");
    expect(nextCase(cases, 100, "B")).toBe("A");
    // Nothing due: the least likely remembered.
    expect(nextCase(cases, 5, null)).toBe("C");
    expect(nextCase(cases, 5, "C")).toBe("A");
    // One case alone repeats.
    expect(nextCase([cases[0] as (typeof cases)[0]], 100, "A")).toBe("A");
    expect(nextCase([], 100, null)).toBeNull();
  });

  it("weak cases are the slow and the often missed", () => {
    const attempts: AttemptLike[] = [];
    let at = 0;
    for (const [id, ms] of [
      ["A", 2000],
      ["B", 2100],
      ["C", 1900],
      ["D", 4000],
    ] as const)
      for (let i = 0; i < 4; i++) attempts.push(attempt(id, ms, at++));
    // E is quick but missed twice in its last five.
    attempts.push(attempt("E", 1000, at++), attempt("E", 1000, at++, true));
    attempts.push(attempt("E", 1000, at++, true));
    expect(weakCases(attempts, ["A", "B", "C", "D", "E"])).toEqual(["E", "D"]);
  });
});

describe("the whole set", () => {
  it("a round of the whole set puts due and weak cases first, the rest shuffled", () => {
    const now = 1000;
    const queued = [
      { caseId: "T", dueAt: 900, recall: 0.5 },
      { caseId: "Y", dueAt: 5000, recall: 0.9 },
      { caseId: "Ua", dueAt: 800, recall: 0.4 },
    ];
    const all = ["Aa", "Ab", "E", "T", "Y", "Ua", "Ub", "H", "Z"];
    const reversed = (ids: readonly string[]) => [...ids].reverse();
    const round = roundOf(queued, all, ["H", "Y"], now, null, reversed);
    // Due earliest first, then weak, then the rest in the shuffle's order.
    expect(round).toEqual(["Ua", "T", "H", "Y", "Z", "Ub", "E", "Ab", "Aa"]);
    // Every case once.
    expect(new Set(round).size).toBe(all.length);
    // The case just drilled does not open the next round.
    const after = roundOf(queued, all, ["H", "Y"], now, "Ua", reversed);
    expect(after[0]).toBe("T");
    expect(after).toContain("Ua");
    expect(roundOf([], ["Aa"], [], now, "Aa", reversed)).toEqual(["Aa"]);
    expect(roundOf([], [], [], now, null, reversed)).toEqual([]);
  });
});
