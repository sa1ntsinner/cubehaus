import { puzzles } from "cubing/puzzles";
import { describe, expect, it } from "vitest";
import { solveCross } from "./cross";
import type { Face } from "./cube";
import { solveXCross } from "./xcross";

const FACES: readonly Face[] = ["U", "L", "F", "R", "B", "D"];
const MOVES = FACES.flatMap((face) => ["", "2", "'"].map((a) => face + a));

function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

/**
 * An independent model for the oracle: cubing's own 3×3 definition, its 18 face-turn
 * transformations composed here on plain arrays (edges and corners; centres stay).
 */
async function oracle() {
  const kpuzzle = await puzzles["3x3x3"]?.kpuzzle();
  if (!kpuzzle) throw new Error("Missing 3×3 KPuzzle loader");
  type Orbit = { pieces: number[]; orientation: number[] };
  type State = { EDGES: Orbit; CORNERS: Orbit };
  const turns = MOVES.map((move) => {
    const data = kpuzzle.moveToTransformation(move).transformationData;
    const edges = data.EDGES;
    const corners = data.CORNERS;
    if (!edges || !corners) throw new Error("No edge or corner orbit");
    return { edges, corners };
  });
  const orbit = (
    state: Orbit,
    t: { permutation: readonly number[]; orientationDelta: readonly number[] },
    mod: number,
  ): Orbit => ({
    pieces: t.permutation.map((from) => state.pieces[from] as number),
    orientation: t.permutation.map(
      (from, i) =>
        ((state.orientation[from] as number) +
          (t.orientationDelta[i] as number)) %
        mod,
    ),
  });
  const apply = (state: State, move: number): State => {
    const t = turns[move] as (typeof turns)[number];
    return {
      EDGES: orbit(state.EDGES, t.edges, 2),
      CORNERS: orbit(state.CORNERS, t.corners, 3),
    };
  };
  const solved: State = {
    EDGES: {
      pieces: [...Array(12).keys()],
      orientation: Array(12).fill(0),
    },
    CORNERS: { pieces: [...Array(8).keys()], orientation: Array(8).fill(0) },
  };
  const of = (alg: string) =>
    alg
      .split(/\s+/)
      .filter(Boolean)
      .reduce((state, move) => apply(state, MOVES.indexOf(move)), solved);
  // cubing's order: edges UF UR UB UL DF DR DB DL FR FL BR BL, corners UFR URB UBL ULF
  // DRF DFL DLB DBR. The four slots as (edge, corner).
  const slots = [
    [8, 4],
    [9, 5],
    [10, 7],
    [11, 6],
  ] as const;
  const home = (o: Orbit, i: number) =>
    o.pieces[i] === i && o.orientation[i] === 0;
  const cross = (state: State) =>
    [4, 5, 6, 7].every((i) => home(state.EDGES, i));
  const xcross = (state: State) =>
    cross(state) &&
    slots.some(([e, c]) => home(state.EDGES, e) && home(state.CORNERS, c));
  const allSlotsOut = (state: State) =>
    slots.every(([e, c]) => !(home(state.EDGES, e) && home(state.CORNERS, c)));
  /** Iterative deepening on the oracle: the fewest turns to any slot's xcross. */
  const distance = (state: State, bound: number): number => {
    const search = (s: State, left: number): boolean => {
      if (xcross(s)) return true;
      if (left === 0) return false;
      for (let m = 0; m < 18; m++)
        if (search(apply(s, m), left - 1)) return true;
      return false;
    };
    for (let depth = 0; depth <= bound; depth++)
      if (search(state, depth)) return depth;
    return Number.POSITIVE_INFINITY;
  };
  return { kpuzzle, of, apply, cross, xcross, allSlotsOut, distance, solved };
}

describe("solveXCross", () => {
  it("xcross requires a solved slot and certifies minimal depth", async () => {
    const check = await oracle();
    // Agreement of the oracle's composition with cubing's own.
    const sample = "R U2 F' L D B2 R' U'";
    const theirs = check.kpuzzle.defaultPattern().applyAlg(sample).patternData;
    expect(check.of(sample).EDGES.pieces).toEqual([
      ...(theirs.EDGES?.pieces ?? []),
    ]);
    expect(check.of(sample).CORNERS.orientation).toEqual([
      ...(theirs.CORNERS?.orientation ?? []),
    ]);

    expect(solveXCross("", "D")).toMatchObject({ moves: [], length: 0 });
    expect(solveXCross("U", "D")?.length).toBe(0);
    expect(solveXCross("R", "D")).toMatchObject({ moves: ["R'"], length: 1 });

    // The cross solved and every slot's pair out: inserts keep the cross edges.
    const triggers = [
      "R U R'",
      "R U' R'",
      "L' U L",
      "L' U' L",
      "F U F'",
      "F' U' F",
      "B U B'",
      "B' U' B",
      "U",
      "U2",
    ];
    const next = seeded(26);
    let built = 0;
    while (built < 16) {
      const alg = Array.from(
        { length: 12 },
        () => triggers[Math.floor(next() * triggers.length)],
      ).join(" ");
      const state = check.of(alg);
      if (!check.cross(state) || !check.allSlotsOut(state)) continue;
      built++;
      expect(solveCross(alg, "D").length).toBe(0);
      const answer = solveXCross(alg, "D");
      expect(answer?.length).toBeGreaterThan(0);
      expect(check.xcross(check.of(`${alg} ${answer?.moves.join(" ")}`))).toBe(
        true,
      );
    }

    // Every turn sequence up to three turns: the answer has the oracle's length.
    const seen = new Set<string>();
    const walk = (alg: string[], depth: number) => {
      const state = check.of(alg.join(" "));
      const key = JSON.stringify(state);
      if (!seen.has(key)) {
        seen.add(key);
        const answer = solveXCross(alg.join(" "), "D");
        if (!answer) throw new Error(`no answer for ${alg.join(" ")}`);
        const after = check.of(`${alg.join(" ")} ${answer.moves.join(" ")}`);
        if (!check.xcross(after))
          throw new Error(`${alg.join(" ")}: ${answer.moves} leaves no xcross`);
        const shortest = check.distance(state, answer.length);
        if (shortest !== answer.length)
          throw new Error(
            `${alg.join(" ")}: ${answer.length} turns, oracle ${shortest}`,
          );
      }
      if (depth === 3) return;
      for (const move of MOVES) walk([...alg, move], depth + 1);
    };
    walk([], 0);
    expect(seen.size).toBe(3_240 + 243 + 18 + 1);

    // 64 seeded random scrambles: four cross edges and one whole slot in place.
    const deep = seeded(64);
    for (let round = 0; round < 64; round++) {
      const scramble = Array.from(
        { length: 20 },
        () => MOVES[Math.floor(deep() * 18)],
      ).join(" ");
      const answer = solveXCross(scramble, "D");
      if (!answer) throw new Error(`no answer for ${scramble}`);
      expect(answer.length).toBe(answer.moves.length);
      expect(answer.length).toBeGreaterThanOrEqual(
        solveCross(scramble, "D").length,
      );
      expect(
        check.xcross(check.of(`${scramble} ${answer.moves.join(" ")}`)),
      ).toBe(true);
    }
  }, 120_000);

  it("gives up past its bound or when cancelled", () => {
    const scramble = "R U F' L2 D B' R2 U' F2 L' D2 B U2";
    expect(solveXCross(scramble, "D", { maxDepth: 1 })).toBeNull();
    expect(solveXCross(scramble, "D", { cancelled: () => true })).toBeNull();
  });
});
