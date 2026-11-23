import { cubeState } from "@cubehaus/cube";
import { describe, expect, it } from "vitest";
import { faceColours, joinedAt } from "./facelets";
import { kpuzzle } from "./verify";

type Orbit = { pieces: number[]; orientation: number[] };

describe("cubing's places on our sticker model", () => {
  it("draws the same stickers as our model after any face turns", async () => {
    const puzzle = await kpuzzle();
    let seed = 11;
    const rng = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const turns = "URFDLB".split("").flatMap((f) => [f, `${f}'`, `${f}2`]);
    for (let n = 0; n < 200; n++) {
      const alg = Array.from(
        { length: 1 + Math.floor(rng() * 25) },
        () => turns[Math.floor(rng() * turns.length)],
      ).join(" ");
      const data = puzzle.defaultPattern().applyAlg(alg)
        .patternData as unknown as { CORNERS: Orbit; EDGES: Orbit };
      const ours = cubeState(3, alg);
      expect(faceColours(data.CORNERS, data.EDGES), alg).toEqual(ours);
    }
  });

  it("calls the solved pair joined, and a pair with its edge flipped not", () => {
    expect(
      joinedAt(
        { place: 4, twist: 0, piece: 4 },
        { place: 8, flip: 0, piece: 8 },
      ),
    ).toBe(true);
    expect(
      joinedAt(
        { place: 4, twist: 0, piece: 4 },
        { place: 8, flip: 1, piece: 8 },
      ),
    ).toBe(false);
    // Far apart: never joined.
    expect(
      joinedAt(
        { place: 4, twist: 0, piece: 4 },
        { place: 2, flip: 0, piece: 8 },
      ),
    ).toBe(false);
  });
});
