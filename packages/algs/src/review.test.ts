import { describe, expect, it } from "vitest";
import { trainerSet } from "./index";
import { lookalikes } from "./lookalike";
import { reviewQueue, seededOrder } from "./review";

const id = (set: "pll" | "oll" | "coll", label: string) =>
  trainerSet(set).find((c) => c.label === label)?.id as string;
const label = (set: "pll" | "oll" | "coll", caseId: string) =>
  trainerSet(set).find((c) => c.id === caseId)?.label;

describe("look-alikes", () => {
  it("PLL cases that differ by one sticker from two sides pair up", () => {
    const pll = lookalikes("pll");
    // Ua's two sides are one sticker from Ub's and Z's most often.
    expect(
      pll
        .get(id("pll", "Ua"))
        ?.slice(0, 2)
        .map((x) => label("pll", x)),
    ).toEqual(["Ub", "Z"]);
    expect(
      pll
        .get(id("pll", "E"))
        ?.slice(0, 2)
        .map((x) => label("pll", x)),
    ).toEqual(["V", "Y"]);
    // The relation is symmetric: if B is among A's look-alikes, A is among B's.
    for (const [a, list] of pll)
      for (const b of list) expect(pll.get(b)).toContain(a);
  });

  it("OLL cases with the same top and different sides pair up; COLL within its shape", () => {
    const oll = lookalikes("oll");
    expect(oll.get(id("oll", "OLL 21"))?.map((x) => label("oll", x))).toEqual([
      "OLL 22",
    ]);
    expect(oll.get(id("oll", "OLL 33"))?.map((x) => label("oll", x))).toEqual([
      "OLL 45",
    ]);
    // A top no other case shares has none.
    expect(oll.get(id("oll", "OLL 17"))).toEqual([]);
    expect(oll.get(id("oll", "OLL 57"))).toEqual([]);
    const coll = lookalikes("coll");
    for (const c of trainerSet("coll"))
      for (const o of coll.get(c.id) ?? [])
        expect(trainerSet("coll").find((x) => x.id === o)?.group).toBe(c.group);
    // The COLL twins the words cannot tell apart are each other's nearest.
    expect(label("coll", coll.get(id("coll", "L 4"))?.[0] as string)).toBe(
      "L 5",
    );
  });
});

describe("review", () => {
  const at = (caseId: string, execMs: number, n: number, missed = false) => ({
    caseId,
    execMs,
    missed,
    at: n,
  });

  it("due first, then slow and missed, each with its look-alike right after it", () => {
    const now = 1000;
    const cards = [
      { caseId: "B", dueAt: 500 },
      { caseId: "A", dueAt: 200 },
      { caseId: "C", dueAt: 5000 },
      { caseId: "D", dueAt: 9000 },
      { caseId: "E", dueAt: 9000 },
      { caseId: "F", dueAt: 9000 },
    ];
    const attempts = [
      // C, D, E are typical; F far slower than the person's own median for the set.
      ...["C", "D", "E"].flatMap((c) => [1, 2, 3].map((n) => at(c, 1000, n))),
      ...[1, 2, 3].map((n) => at("F", 3000, n)),
      // G missed twice in its last five.
      at("G", 1000, 4, true),
      at("G", 1000, 5, true),
    ];
    const like = new Map([
      ["A", ["D"]],
      ["D", ["A"]],
      ["F", ["C", "E"]],
    ]);
    const queue = reviewQueue({
      caseIds: ["A", "B", "C", "D", "E", "F", "G"],
      cards,
      attempts,
      now,
      lookalikes: like,
      seed: 7,
    });
    expect(queue.order).toEqual(["A", "D", "B", "F", "C", "G"]);
    expect(queue.counts).toEqual({ due: 2, slow: 1, missed: 1 });
    // A look-alike outside the pool is not brought in.
    const mine = reviewQueue({
      caseIds: ["A", "B", "F"],
      cards,
      attempts,
      now,
      lookalikes: like,
      seed: 7,
    });
    expect(mine.order).toEqual(["A", "B"]);
  });

  it("the same seed gives the same order, and ties follow it", () => {
    const cards = ["P", "Q", "R", "S", "T"].map((caseId) => ({
      caseId,
      dueAt: 100,
    }));
    const run = (seed: number) =>
      reviewQueue({
        caseIds: cards.map((c) => c.caseId),
        cards,
        attempts: [],
        now: 1000,
        lookalikes: new Map(),
        seed,
      }).order;
    expect(run(3)).toEqual(run(3));
    expect(new Set(run(3))).toEqual(new Set(["P", "Q", "R", "S", "T"]));
    expect(
      [1, 2, 3, 4, 5, 6].map(run).some((o) => o.join() !== run(3).join()),
    ).toBe(true);
    expect(seededOrder(["a", "b", "c"], 9)).toEqual(
      seededOrder(["a", "b", "c"], 9),
    );
    // Nothing due, slow or missed: nothing to review.
    expect(
      reviewQueue({
        caseIds: ["P"],
        cards: [{ caseId: "P", dueAt: 5000 }],
        attempts: [],
        now: 1000,
        lookalikes: new Map(),
        seed: 1,
      }),
    ).toEqual({ order: [], counts: { due: 0, slow: 0, missed: 0 } });
  });

  it("ties do not depend on the order the cases were stored in", () => {
    const ids = ["P", "Q", "R", "S", "T"];
    const run = (caseIds: string[]) =>
      reviewQueue({
        caseIds,
        cards: caseIds.map((caseId) => ({ caseId, dueAt: 100 })),
        attempts: [],
        now: 1000,
        lookalikes: new Map(),
        seed: 7,
      }).order;
    expect(run([...ids].reverse())).toEqual(run(ids));
    expect(run(["R", "P", "T", "Q", "S"])).toEqual(run(ids));
  });
});
