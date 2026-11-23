import { describe, expect, it } from "vitest";
import { f2lGroups, f2lOrder } from "./f2l-order";
import {
  lastSlotSet,
  lastSlotTop,
  pictureOf,
  puzzleOf,
  trainerSet,
} from "./index";
import { lookalikes } from "./lookalike";
import type { SetId } from "./types";

const LS = ["ls-right", "ls-front"] as const;
const SLOTS = ["f2l", "f2l-left", "f2l-back", "f2l-back-left"] as const;

describe("last-slot sets in the trainer", () => {
  it("are trainer sets of the 3×3, the same cases lastSlotSet reads", () => {
    for (const set of LS) {
      expect(trainerSet(set)).toBe(lastSlotSet(set));
      expect(trainerSet(set)).toHaveLength(26);
      expect(puzzleOf(set)).toBe("333");
      for (const c of trainerSet(set)) {
        expect(c.id.startsWith(`${set}-`)).toBe(true);
        expect(c.scrambles?.length).toBeGreaterThan(0);
        expect(c.algs.length).toBeGreaterThan(0);
      }
    }
  });

  it("show the top with the pair in colour and the last layer as up or not", () => {
    for (const set of LS) {
      const tops = new Set<string>();
      for (const c of trainerSet(set)) {
        const top = lastSlotTop(c);
        const full = c.pictures?.top as string;
        const slot = c.pictures?.slot as string;
        expect(top).toHaveLength(21);
        tops.add(top);
        // The U face and the front and right top rows are the slot picture's own.
        expect(top.slice(0, 9)).toBe(slot.slice(0, 9));
        expect(top.slice(9, 12)).toBe(slot.slice(9, 12));
        expect(top.slice(12, 15)).toBe(slot.slice(18, 21));
        for (let i = 0; i < 21; i++) {
          // A sticker is the full picture's colour, or for the last layer only U or x.
          if (top[i] === "x") expect(full[i]).not.toBe("U");
          else expect(top[i]).toBe(full[i]);
        }
        // The pair: one corner and one edge, three and two stickers in colour (no U, no x).
        const coloured = [...top].filter((l) => l !== "U" && l !== "x");
        expect(coloured, c.label).toHaveLength(5);
      }
      expect(tops.size).toBe(26);
    }
  });
});

describe("F2L groups for the list", () => {
  it("four groups by where the pair is, holding the learner's order", () => {
    for (const set of SLOTS) {
      const groups = f2lGroups(set);
      expect(groups.map((g) => g.id)).toEqual([
        "top",
        "edge",
        "corner",
        "slot",
      ]);
      expect(groups.flatMap((g) => g.ids)).toEqual(
        f2lOrder(set).map((o) => o.id),
      );
      expect(groups.map((g) => g.ids.length)).toEqual([24, 6, 6, 5]);
      for (const g of groups) {
        expect(g.en.length).toBeGreaterThan(0);
        expect(g.ru.length).toBeGreaterThan(0);
        // Short: a group's name is a few words a cuber says, not a list of facts.
        expect(g.en.split(" ").length).toBeLessThanOrEqual(4);
        expect(g.en).not.toMatch(/,/);
      }
    }
  });
});

describe("look-alikes of the new sets", () => {
  const symmetric = (set: SetId) => {
    const map = lookalikes(set);
    for (const [a, list] of map)
      for (const b of list) expect(map.get(b), `${a} ${b}`).toContain(a);
    return map;
  };

  it("last slot: the same corners up, nearest by the side stickers", () => {
    for (const set of LS) {
      const map = symmetric(set);
      const up = (id: string) => {
        const c = trainerSet(set).find((x) => x.id === id);
        return [...(c?.pictures?.top ?? "").slice(0, 9)]
          .map((l) => (l === "U" ? "U" : "x"))
          .join("");
      };
      let some = 0;
      for (const [a, list] of map) {
        for (const b of list) expect(up(b), `${a} ${b}`).toBe(up(a));
        some += list.length;
      }
      expect(some).toBeGreaterThan(0);
    }
  });

  it("2×2 top in one go: the same top, read up to a turn of it", () => {
    for (const set of ["two-cll", "two-adj", "two-diag"] as const) {
      const map = symmetric(set);
      const cases = trainerSet(set);
      const mask = (p: string) =>
        [...p.slice(0, 4)].map((l) => (l === "U" ? "U" : "x")).join("");
      let some = 0;
      for (const [a, list] of map) {
        const ca = cases.find((c) => c.id === a) as (typeof cases)[number];
        for (const b of list) {
          const cb = cases.find((c) => c.id === b) as (typeof cases)[number];
          expect(
            [0, 1, 2, 3].some(
              (t) => mask(pictureOf(cb, t)) === mask(pictureOf(ca)),
            ),
            `${a} ${b}`,
          ).toBe(true);
        }
        some += list.length;
      }
      expect(some).toBeGreaterThan(0);
    }
  });
});
