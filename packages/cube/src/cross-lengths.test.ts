import { describe, expect, it } from "vitest";
import { CROSS_STATES, crossDistance, crossLengths, solveCross } from "./cross";
import type { Face } from "./cube";
import { HOLDINGS, holdingFaces, renameTurns } from "./holding";

const FACES: readonly Face[] = ["U", "D", "F", "B", "R", "L"];

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

describe("crossLengths", () => {
  it("is the white solver's length for white, and so for every colour", () => {
    const next = seeded(7);
    for (let round = 0; round < 60; round++) {
      const scramble = randomScramble(next);
      const lengths = crossLengths(scramble, FACES);
      for (const face of FACES)
        expect(lengths?.[face]).toBe(solveCross(scramble, face).length);
    }
  });

  it("matches white by symmetry: the cube turned whole has each cross as long as before", () => {
    // A rotation renames every turn of a scramble (R becomes the face turned to R's
    // place) and keeps its direction; the colour that was on U is then on faces.U.
    const next = seeded(11);
    for (let round = 0; round < 40; round++) {
      const scramble = randomScramble(next);
      const white = crossLengths(scramble, ["U"])?.U;
      for (const holding of HOLDINGS) {
        const faces = holdingFaces(holding);
        const turned = renameTurns(scramble, faces);
        const lengths = crossLengths(turned, FACES);
        expect(lengths?.[faces.U]).toBe(white);
        for (const face of FACES)
          expect(lengths?.[faces[face]]).toBe(
            crossLengths(scramble, [face])?.[face],
          );
      }
    }
  });

  it("gives only the colours asked for, and none for notation it cannot read", () => {
    expect(crossLengths("R U", ["U", "D"])).toEqual({ U: 2, D: 1 });
    expect(crossLengths("", ["F"])).toEqual({ F: 0 });
    expect(crossLengths("Rw U", ["U"])).toBeNull();
  });

  it("reproduces the published mean optimal cross: 5.81 one colour, 5.39 two opposite, 4.81 all six", () => {
    // One colour, exactly, over every cross state.
    let sum = 0;
    for (let state = 0; state < CROSS_STATES; state++)
      sum += crossDistance(state);
    expect(sum / CROSS_STATES).toBeCloseTo(5.81, 2);
    // Two opposite colours and all six, over seeded random scrambles.
    const next = seeded(2026);
    const rounds = 3000;
    let dual = 0;
    let six = 0;
    for (let round = 0; round < rounds; round++) {
      const lengths = crossLengths(randomScramble(next, 30), FACES);
      if (!lengths) throw new Error("unreadable scramble");
      dual += Math.min(lengths.U ?? 9, lengths.D ?? 9);
      six += Math.min(...FACES.map((face) => lengths?.[face] ?? 9));
    }
    expect(dual / rounds).toBeGreaterThan(5.3);
    expect(dual / rounds).toBeLessThan(5.48);
    expect(six / rounds).toBeGreaterThan(4.72);
    expect(six / rounds).toBeLessThan(4.9);
  }, 60_000);
});
