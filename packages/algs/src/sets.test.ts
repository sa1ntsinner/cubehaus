import { describe, expect, it } from "vitest";
import { f2lGroups, f2lOrder } from "./f2l-order";
import {
  lastSlotSet,
  lastSlotTop,
  lookalikes,
  pictureOf,
  puzzleOf,
  trainerSet,
} from "./index";
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

  it("show the three corners' twist, the pair and nothing else, and no two tiles alike", () => {
    for (const set of LS) {
      const tops = new Set<string>();
      const twists = new Set<string>();
      const pairs = new Set<string>();
      for (const c of trainerSet(set)) {
        const top = lastSlotTop(c);
        const full = c.pictures?.top as string;
        const slot = c.pictures?.slot as string;
        expect(top).toHaveLength(21);
        tops.add(top);
        // The U face's corners and the front and right top rows' ends are the slot
        // picture's own.
        for (const i of [0, 2, 6, 8]) expect(top[i]).toBe(slot[i]);
        const edges = [1, 3, 5, 7, 10, 13, 16, 19];
        for (let i = 0; i < 21; i++) {
          // A sticker is the full picture's colour; a corner's is U or x, an edge's x.
          if (top[i] !== "x") expect(top[i]).toBe(full[i]);
          else if (!edges.includes(i)) expect(full[i]).not.toBe("U");
        }
        expect(top[4]).toBe("U");
        // The pair: one corner and one edge, three and two stickers in colour (no U, no x).
        const at = Array.from(top, (_, i) => i).filter(
          (i) => top[i] !== "U" && top[i] !== "x",
        );
        expect(at, c.label).toHaveLength(5);
        pairs.add(at.map((i) => `${i}${top[i]}`).join(","));
        // Every other top edge sticker says nothing.
        for (const i of edges)
          if (!at.includes(i)) expect(top[i], `${c.label} ${i}`).toBe("x");
        // What is left is the three corners' twist: where the top colour faces.
        twists.add(
          [...top]
            .map((l, i) => (at.includes(i) || i === 4 ? "." : l))
            .join(""),
        );
      }
      // The pair stands the same in every case of the set; the twist alone differs.
      expect(pairs.size).toBe(1);
      expect(tops.size).toBe(26);
      expect(twists.size).toBe(26);
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
