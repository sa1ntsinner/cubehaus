import { puzzles } from "cubing/puzzles";
import { describe, expect, it } from "vitest";
import {
  CROSS_MOVES,
  CROSS_STATES,
  type CrossState,
  crossDistance,
  crossMove,
  crossStateOf,
  decodeCross,
  encodeCross,
  solveCross,
} from "./cross";
import { cubeState, type Face } from "./cube";

const FACES: readonly Face[] = ["U", "L", "F", "R", "B", "D"];

/** A seeded generator, so a failing scramble can be found again. */
function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

function randomScramble(next: () => number, length = 25): string {
  const moves: string[] = [];
  let last = "";
  while (moves.length < length) {
    const face = FACES[Math.floor(next() * 6)] as Face;
    if (face === last) continue;
    last = face;
    moves.push(face + (["", "2", "'"][Math.floor(next() * 3)] ?? ""));
  }
  return moves.join(" ");
}

// The four edge stickers next to each centre, as row-major indices on a 3×3 face, and
// the face each one's partner sticker lies on, read from the net (DESIGN §12).
const CROSS_STICKERS: Record<Face, [number, Face, number][]> = {
  U: [
    [1, "B", 1],
    [3, "L", 1],
    [5, "R", 1],
    [7, "F", 1],
  ],
  D: [
    [1, "F", 7],
    [3, "L", 7],
    [5, "R", 7],
    [7, "B", 7],
  ],
  F: [
    [1, "U", 7],
    [3, "L", 5],
    [5, "R", 3],
    [7, "D", 1],
  ],
  B: [
    [1, "U", 1],
    [3, "R", 5],
    [5, "L", 3],
    [7, "D", 7],
  ],
  R: [
    [1, "U", 5],
    [3, "F", 5],
    [5, "B", 3],
    [7, "D", 5],
  ],
  L: [
    [1, "U", 3],
    [3, "B", 5],
    [5, "F", 3],
    [7, "D", 3],
  ],
};

/** The cross on `face` as stickers show it: every edge sticker matches its centre. */
function crossSolved(alg: string, face: Face): boolean {
  const state = cubeState(3, alg);
  return CROSS_STICKERS[face].every(
    ([index, side, sideIndex]) =>
      state[face][index] === state[face][4] &&
      state[side][sideIndex] === state[side][4],
  );
}

describe("solveCross", () => {
  it("cross distance table solves every projected state", async () => {
    // Small cases, by hand.
    expect(solveCross("", "D")).toEqual({ moves: [], length: 0 });
    expect(solveCross("U", "D").length).toBe(0);
    expect(solveCross("R", "D")).toEqual({ moves: ["R'"], length: 1 });
    expect(solveCross("R2", "D")).toEqual({ moves: ["R2"], length: 1 });
    expect(crossDistance(crossStateOf("R", "D"))).toBe(1);

    // Every coordinate decodes to four distinct places and encodes back to itself.
    expect(CROSS_STATES).toBe(190_080);
    for (let state = 0; state < CROSS_STATES; state++) {
      const { places, flips } = decodeCross(state);
      expect(new Set(places).size).toBe(4);
      if (encodeCross(places, flips) !== state)
        throw new Error(`state ${state} does not round-trip`);
    }

    // The table is a true distance: each state but solved has a neighbour one closer, and
    // no neighbour is more than one turn nearer or farther.
    expect(CROSS_MOVES).toHaveLength(18);
    for (let state = 0; state < CROSS_STATES; state++) {
      const distance = crossDistance(state);
      let closer = false;
      for (let move = 0; move < CROSS_MOVES.length; move++) {
        const next = crossDistance(crossMove(state as CrossState, move));
        if (Math.abs(next - distance) > 1)
          throw new Error(
            `state ${state}, move ${move}: ${distance} → ${next}`,
          );
        if (next === distance - 1) closer = true;
      }
      if (distance > 0 && !closer)
        throw new Error(
          `state ${state} at ${distance} has no closer neighbour`,
        );
    }
    expect(crossDistance(crossStateOf("", "D"))).toBe(0);

    // 100 seeded scrambles: the answer solves the D cross on cubing's own puzzle, and on
    // our sticker model the cross of every face.
    const kpuzzle = await puzzles["3x3x3"]?.kpuzzle();
    if (!kpuzzle) throw new Error("Missing 3×3 KPuzzle loader");
    const next = seeded(25);
    for (let round = 0; round < 100; round++) {
      const scramble = randomScramble(next);
      const answer = solveCross(scramble, "D");
      expect(answer.length).toBe(answer.moves.length);
      expect(answer.length).toBeLessThanOrEqual(8);
      const { patternData } = kpuzzle
        .defaultPattern()
        .applyAlg(`${scramble} ${answer.moves.join(" ")}`);
      const edges = patternData.EDGES;
      const centers = patternData.CENTERS;
      if (!edges || !centers) throw new Error("No edge or centre orbit");
      // cubing's edge order: UF UR UB UL DF DR DB DL FR FL BR BL.
      for (const edge of [4, 5, 6, 7]) {
        expect(edges.pieces[edge]).toBe(edge);
        expect(edges.orientation[edge]).toBe(0);
      }
      expect([...centers.pieces]).toEqual([0, 1, 2, 3, 4, 5]);

      const face = FACES[round % 6] as Face;
      const other = solveCross(scramble, face);
      expect(crossSolved(`${scramble} ${other.moves.join(" ")}`, face)).toBe(
        true,
      );
      // Shortest: one turn fewer never solves it, judged by the table's own frame.
      expect(other.length).toBe(crossDistance(crossStateOf(scramble, face)));
    }
  }, 120_000);

  it("refuses notation other than the 18 outer face turns", () => {
    expect(() => solveCross("Rw U", "D")).toThrow(RangeError);
    expect(() => solveCross("x R", "D")).toThrow(RangeError);
  });
});
