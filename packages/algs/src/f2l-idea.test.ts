import { describe, expect, it } from "vitest";
import {
  frontRightAlg,
  ideaFacts,
  ideaWords,
  isInsert,
  type PairAt,
  traceF2l,
} from "./f2l-idea";
import { trainerSet } from "./index";
import { kpuzzle } from "./verify";

const SETS = [
  ["f2l", "fr", "f2l-"],
  ["f2l-left", "fl", "f2l-left-"],
  ["f2l-back", "br", "f2l-back-"],
  ["f2l-back-left", "bl", "f2l-back-left-"],
] as const;

const top = (place: number) => place < 4;

describe("F2L notes read from the algorithm on the model", () => {
  it("says which turn of an insert is which", () => {
    expect(isInsert(["R", "U", "R'"])).toBe(true);
    expect(isInsert(["F'", "U2", "F"])).toBe(true);
    expect(isInsert(["R", "U", "R"])).toBe(false);
    expect(isInsert(["R2", "U", "R2"])).toBe(false);
    expect(isInsert(["U", "R", "U'"])).toBe(false);
  });

  for (const [set, slot] of SETS)
    it(`${set}: every stated fact holds as the main algorithm is played`, async () => {
      const puzzle = await kpuzzle();
      let noted = 0;
      for (const c of trainerSet(set)) {
        const main = c.algs[0];
        if (!main) continue;
        const alg = frontRightAlg(main.moves, slot);
        const trace = traceF2l(puzzle, c.state, alg);
        const turns = alg.split(" ");
        const n = turns.length;
        // The trace ends with the slot solved.
        const end = trace[n] as PairAt;
        expect([end.corner, end.twist, end.edge, end.flip], c.label).toEqual([
          4, 0, 8, 0,
        ]);
        const facts = ideaFacts(trace, alg);
        if (!facts) {
          expect(c.idea ?? null, c.label).toBeNull();
          continue;
        }
        noted++;
        expect(c.idea, c.label).toEqual(ideaWords(facts));
        // The insert is the last trigger: X U X' with X a quarter turn of R or F.
        expect(isInsert(turns.slice(n - 3)), c.label).toBe(true);
        // The pair is joined at the stated point and stays joined; not just before it.
        for (let i = facts.formed; i <= n; i++)
          expect((trace[i] as PairAt).joined, `${c.label} at ${i}`).toBe(true);
        if (facts.formed > 0)
          expect((trace[facts.formed - 1] as PairAt).joined, c.label).toBe(
            false,
          );
        const before = trace[n - 3] as PairAt;
        expect(top(before.corner) && top(before.edge), c.label).toBe(true);
        if (facts.insert === "joined") {
          // Joined before the insert begins, as "join them" says.
          expect(facts.formed, c.label).toBeLessThanOrEqual(n - 3);
        } else {
          // Apart when the insert begins; the insert's own turns join them.
          expect(before.joined, c.label).toBe(false);
          expect(facts.formed, c.label).toBeGreaterThan(n - 3);
        }
        const setupEnd = facts.insert === "joined" ? facts.formed : n - 3;
        if (facts.lift) {
          const at = trace[facts.formed] as PairAt;
          expect(top(at.corner) && top(at.edge), c.label).toBe(false);
        }
        if (facts.takeOut) {
          const start = trace[0] as PairAt;
          const early = trace.slice(1, setupEnd + 1);
          if (facts.takeOut !== "edge") {
            expect(start.corner, c.label).toBe(4);
            expect(
              early.some((s) => s.corner !== 4),
              c.label,
            ).toBe(true);
          }
          if (facts.takeOut !== "corner") {
            expect(start.edge, c.label).toBe(8);
            expect(
              early.some((s) => s.edge !== 8),
              c.label,
            ).toBe(true);
          }
        }
        if (facts.hide) {
          const j = facts.hide.turn;
          const corner = facts.hide.piece === "corner";
          const hidden = (s: PairAt) => (corner ? s.corner : s.edge);
          const other = (s: PairAt) => (corner ? s.edge : s.corner);
          expect(turns[j], c.label).toMatch(/^U/);
          expect(j, c.label).toBeLessThan(setupEnd);
          for (const s of [trace[j], trace[j + 1]] as PairAt[]) {
            expect(top(hidden(s)), c.label).toBe(false);
            expect(top(other(s)), c.label).toBe(true);
          }
          expect(
            trace.slice(0, j).some((s) => top(hidden(s))),
            c.label,
          ).toBe(true);
        }
      }
      // Most cases have a clear shape; the rest stay without a note.
      expect(noted).toBeGreaterThanOrEqual(25);
    }, 120_000);
});
