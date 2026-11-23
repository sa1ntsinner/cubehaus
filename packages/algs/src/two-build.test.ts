import { readFileSync, writeFileSync } from "node:fs";
import { cubeState } from "@cubehaus/cube";
import { describe, expect, it } from "vitest";
import { TWO_ADJ } from "./data/two-adj";
import { TWO_CLL } from "./data/two-cll";
import { TWO_DIAG } from "./data/two-diag";
import { TWO_OLL } from "./data/two-oll";
import { TWO_PBL } from "./data/two-pbl";
import { pictureOf } from "./index";
import { applyTwo, SOLVED, sameTwo, twoStickers } from "./two";
import { buildTwo, goalOf, renderTwo } from "./two-build";
import {
  classesOf,
  inSet,
  seenKey,
  stateFromKey,
  type TwoSet,
  upright,
} from "./two-cases";
import { twoNoteRaw } from "./two-notes";
import { distances } from "./two-search";

const dataFile = (set: TwoSet) => new URL(`./data/${set}.ts`, import.meta.url);
const SHIPPED = {
  "two-oll": TWO_OLL,
  "two-pbl": TWO_PBL,
  "two-cll": TWO_CLL,
  "two-adj": TWO_ADJ,
  "two-diag": TWO_DIAG,
};
const U = ["", "U", "U2", "U'"];

describe("2×2 sets from our own search", () => {
  const exact = distances([SOLVED]);
  for (const [set, count] of [
    ["two-oll", 7],
    ["two-pbl", 5],
    ["two-cll", 42],
    ["two-adj", 43],
    ["two-diag", 43],
  ] as const)
    it(`${set}: ${count} cases, every algorithm solves its case and every scramble leads to it`, () => {
      const built = buildTwo(set, { goal: distances(goalOf(set)), exact });
      const text = renderTwo(built);
      if (process.env.ALGS_WRITE === "1") writeFileSync(dataFile(set), text);
      expect(readFileSync(dataFile(set), "utf8")).toBe(text);
      const shipped = SHIPPED[set];
      expect(shipped).toHaveLength(count);
      // Each case is a class of the model: the class of the state its picture shows.
      const classes = classesOf(set).filter(
        (c) => !c.includes(seenKey(set, SOLVED)),
      );
      const classOf = (s: ReturnType<typeof stateFromKey>) =>
        classes.findIndex((c) => c.includes(seenKey(set, s)));
      expect(
        new Set(shipped.map((c) => classOf(stateFromKey(c.state)))).size,
      ).toBe(count);
      const goal = goalOf(set);
      const reached = (s: ReturnType<typeof stateFromKey>) =>
        goal.some((g) => sameTwo(g, s));
      for (const c of shipped) {
        const shown = stateFromKey(c.state);
        expect(c.algs.length, c.label).toBeGreaterThanOrEqual(1);
        expect(c.algs.length, c.label).toBeLessThanOrEqual(3);
        expect(c.algs[0]?.auf).toBe(0);
        for (const alg of c.algs) {
          expect(alg.moves).toMatch(/^[RUF]['2]?( [RUF]['2]?)*$/);
          // On our model: from the case, U turned as the algorithm says, then it.
          const after = applyTwo(shown, `${U[alg.auf]} ${alg.moves}`.trim());
          expect(reached(after), `${c.label}: ${alg.moves}`).toBe(true);
        }
        // The picture: the top's four and the side rows; with both layers' sides where
        // the bottom matters (PBL, the bottom swaps), so its bars show.
        const both =
          set === "two-pbl" || set === "two-adj" || set === "two-diag";
        expect(pictureOf(c)).toBe(twoStickers(shown, both));
        expect(pictureOf(c)).toHaveLength(both ? 20 : 12);
        // Every drill scramble leads, from a solved cube, to a state of this case.
        expect(c.scrambles).toHaveLength(8);
        for (const scramble of c.scrambles) {
          const s = applyTwo(SOLVED, scramble);
          expect(inSet(set, s), `${c.label}: ${scramble}`).toBe(true);
          expect(classOf(upright(s)), `${c.label}: ${scramble}`).toBe(
            classOf(shown),
          );
          // And on our own sticker model, the case's algorithm solves it, with the turns
          // of the top (and for PBL the bottom) a solver makes before and after.
          // A bottom to swap: the cube held turned about the vertical before, the
          // bottom turned after.
          const D = ["", "D", "D2", "D'"];
          const swap = set === "two-adj" || set === "two-diag";
          const lows = set === "two-pbl" ? [0, 1, 2, 3] : [0];
          const holds = swap ? ["", "y", "y2", "y'"] : [""];
          const afters = swap ? D : [""];
          const ok = c.algs.some((alg) =>
            holds.some((hold) =>
              [0, 1, 2, 3].some((k) =>
                lows.some((m) =>
                  [0, 1, 2, 3].some((j) =>
                    afters.some((after) => {
                      const faces = cubeState(
                        2,
                        `${scramble} ${hold} ${U[k]} ${D[m]} ${alg.moves} ${U[j]} ${after}`,
                      );
                      const one = (face: string) =>
                        new Set(faces[face as keyof typeof faces]).size === 1;
                      return set === "two-oll"
                        ? one("U") && one("D")
                        : "UDFRBL".split("").every(one);
                    }),
                  ),
                ),
              ),
            ),
          );
          expect(ok, `${c.label}: ${scramble}`).toBe(true);
        }
        // The note is what the picture shows (CLL's and the swaps': two-notes.test.ts).
        if (set === "two-oll" || set === "two-pbl")
          expect(c.recognise).toEqual(twoNoteRaw(set, shown));
      }
      if (set !== "two-adj" && set !== "two-diag")
        expect(shipped.every((c) => c.recognise !== null)).toBe(true);
    }, 300_000);
});
