import { cubeState } from "@cubehaus/cube";
import { describe, expect, it } from "vitest";
import {
  applyTwo,
  facesOf,
  invertTwo,
  SOLVED,
  sameTwo,
  twoStickers,
} from "./two";

function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

const randomAlg = (rng: () => number, faces: string, n: number) =>
  Array.from(
    { length: n },
    () =>
      `${faces[Math.floor(rng() * faces.length)]}${["", "'", "2"][Math.floor(rng() * 3)]}`,
  ).join(" ");

describe("our 2×2 model", () => {
  it("shows every face as our sticker model does, after any turns", () => {
    const rng = seeded(3);
    for (let i = 0; i < 2000; i++) {
      const alg = randomAlg(rng, "URFDLB", 1 + Math.floor(rng() * 14));
      const ours = facesOf(applyTwo(SOLVED, alg));
      const theirs = cubeState(2, alg);
      for (const face of "URFDLB")
        if (
          (ours[face] as string[]).join("") !==
          (theirs[face as keyof typeof theirs] as string[]).join("")
        )
          expect.fail(
            `${alg}: ${face} ${ours[face]} against ${theirs[face as keyof typeof theirs]}`,
          );
    }
  });

  it("an algorithm and its inverse leave the cube as it was; four quarter turns are none", () => {
    const rng = seeded(4);
    for (let i = 0; i < 500; i++) {
      const alg = randomAlg(rng, "URF", 12);
      const s = applyTwo(SOLVED, alg);
      expect(sameTwo(applyTwo(s, invertTwo(alg)), SOLVED)).toBe(true);
    }
    for (const face of "URFDLB")
      expect(
        sameTwo(applyTwo(SOLVED, `${face} ${face} ${face} ${face}`), SOLVED),
      ).toBe(true);
    // R, U and F never move the back left bottom corner.
    expect(applyTwo(SOLVED, randomAlg(rng, "URF", 40)).cp[6]).toBe(6);
  });

  it("a picture is the top and the side stickers as seen from above", () => {
    expect(twoStickers(SOLVED)).toBe("UUUUFFRRBBLL");
    expect(twoStickers(SOLVED, true)).toBe("UUUUFFRRBBLLFFRRBBLL");
    // R turns the right column of the top to F's colour.
    expect(twoStickers(applyTwo(SOLVED, "R"))).toBe("UFUFFDRRUBLL");
  });
});
