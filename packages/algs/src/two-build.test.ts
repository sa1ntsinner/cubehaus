import { readFileSync, writeFileSync } from "node:fs";
import { cubeState } from "@cubehaus/cube";
import { describe, expect, it } from "vitest";
import { TWO_CLL } from "./data/two-cll";
import { TWO_OLL } from "./data/two-oll";
import { TWO_PBL } from "./data/two-pbl";
import { applyTwo, SOLVED, sameTwo } from "./two";
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
const SHIPPED = { "two-oll": TWO_OLL, "two-pbl": TWO_PBL, "two-cll": TWO_CLL };
const U = ["", "U", "U2", "U'"];

describe("2×2 sets from our own search", () => {
  const exact = distances([SOLVED]);
  for (const [set, count] of [
    ["two-oll", 7],
    ["two-pbl", 5],
    ["two-cll", 42],
  ] as const)
    it(`${set}: ${count} cases, every algorithm solves its case and every scramble leads to it`, () => {
      const built = buildTwo(set, { goal: distances(goalOf(set)), exact });
      const text = renderTwo(built);
      if (process.env.ALGS_WRITE === "1") writeFileSync(dataFile(set), text);
      expect(readFileSync(dataFile(set), "utf8")).toBe(text);
      const shipped = SHIPPED[set];
      expect(shipped).toHaveLength(count);
      // Each case is a class of the model: the class of the state its picture shows.
      const classes = classesOf(set).slice(1);
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
          const D = ["", "D", "D2", "D'"];
          const lows = set === "two-pbl" ? [0, 1, 2, 3] : [0];
          const ok = c.algs.some((alg) =>
            [0, 1, 2, 3].some((k) =>
              lows.some((m) =>
                [0, 1, 2, 3].some((j) => {
                  const faces = cubeState(
                    2,
                    `${scramble} ${U[k]} ${D[m]} ${alg.moves} ${U[j]}`,
                  );
                  const one = (face: string) =>
                    new Set(faces[face as keyof typeof faces]).size === 1;
                  return set === "two-oll"
                    ? one("U") && one("D")
                    : "UDFRBL".split("").every(one);
                }),
              ),
            ),
          );
          expect(ok, `${c.label}: ${scramble}`).toBe(true);
        }
        // A note, where there is one, is what the picture shows.
        if (c.recognise) expect(c.recognise).toEqual(twoNoteRaw(set, shown));
      }
      if (set !== "two-cll")
        expect(shipped.every((c) => c.recognise !== null)).toBe(true);
    }, 300_000);
});
