import { describe, expect, it } from "vitest";
import { applyTwo, SOLVED } from "./two";
import {
  bottomBars,
  classesOf,
  composeTwo,
  HOLD_COUNT,
  inSet,
  inverseTwo,
  membersOf,
  stateKey,
  upright,
} from "./two-cases";
import { STATES, stateOf } from "./two-search";

describe("2×2 cases, counted from the model", () => {
  it("there are 24 ways to hold the cube, and the DBL corner comes home in exactly one", () => {
    expect(HOLD_COUNT).toBe(24);
    const s = applyTwo(SOLVED, "L D B' R2 F");
    const held = upright(s);
    expect([held.cp[6], held.co[6]]).toEqual([6, 0]);
  });

  it("the top's twists: 27 ways, 26 to fix, 7 cases up to a turn of the top", () => {
    expect(membersOf("two-oll")).toHaveLength(27);
    const classes = classesOf("two-oll");
    expect(classes).toHaveLength(8);
    expect(classes[0]).toEqual(["0000"]);
    expect(
      classes
        .slice(1)
        .map((c) => c.length)
        .sort(),
    ).toEqual([2, 4, 4, 4, 4, 4, 4]);
  });

  it("both layers' places: 144 states, 5 cases and solved", () => {
    expect(membersOf("two-pbl")).toHaveLength(144);
    expect(classesOf("two-pbl")).toHaveLength(6);
  });

  it("the whole top with the bottom solved: 648 states, 42 cases and solved", () => {
    const members = membersOf("two-cll");
    expect(members).toHaveLength(648);
    const classes = classesOf("two-cll");
    expect(classes).toHaveLength(43);
    expect(classes.reduce((n, c) => n + c.length, 0)).toBe(648);
    // A y turn of the whole cube moves the top as a U turn does: no case more to merge.
    const y = applyTwo(SOLVED, "U D'");
    const u = applyTwo(SOLVED, "U");
    for (const m of members) {
      const turned = composeTwo(composeTwo(inverseTwo(y), m), y);
      const asU = composeTwo(composeTwo(inverseTwo(u), m), u);
      expect(turned).toEqual(asU);
    }
  });

  it("the bottom one colour but swapped: 43 cases side by side, 43 across, every state counted", () => {
    // Every state of the puzzle (DBL home) that belongs to each set, found by checking
    // all 3 674 160 of them, is exactly the set's members.
    const found = { "two-adj": 0, "two-diag": 0 };
    for (let i = 0; i < STATES; i++) {
      const s = stateOf(i);
      if (inSet("two-adj", s)) found["two-adj"]++;
      if (inSet("two-diag", s)) found["two-diag"]++;
    }
    for (const [set, bars, lows] of [
      ["two-adj", 1, 4],
      ["two-diag", 0, 1],
    ] as const) {
      const members = membersOf(set);
      // The top's 24 places and 27 twists, the bottom's places with DBL home.
      expect(members).toHaveLength(24 * 27 * lows);
      expect(found[set]).toBe(members.length);
      expect(new Set(members.map(stateKey)).size).toBe(members.length);
      for (const m of members) expect(bottomBars(m)).toBe(bars);
      const classes = classesOf(set);
      expect(classes.reduce((n, c) => n + c.length, 0)).toBe(members.length);
      expect(classes).toHaveLength(43);
      // None is solved; three have the top's colour all up (the top's pieces in place,
      // swapped side by side or across), the other 40 need it turned.
      const up = classes.filter((c) =>
        c.every((k) => k.slice(8, 12) === "0000"),
      );
      expect(up).toHaveLength(3);
    }
  }, 60_000);
});
