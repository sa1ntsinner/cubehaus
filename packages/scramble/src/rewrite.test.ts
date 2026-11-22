import { puzzles } from "cubing/puzzles";
import { describe, expect, test } from "vitest";
import { officialBigCube, officialTwoByTwo } from "./rewrite";

// A small seeded generator, so a failure names a sequence that can be replayed.
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sequence(next: () => number, families: string[], length: number) {
  const suffixes = ["", "2", "'"];
  const moves: string[] = [];
  let last = "";
  while (moves.length < length) {
    const family = families[Math.floor(next() * families.length)] as string;
    if (family === last) continue;
    last = family;
    moves.push(family + suffixes[Math.floor(next() * 3)]);
  }
  return moves.join(" ");
}

// The 24 ways to hold a cube: each face on top, then four turns about it.
const holds = ["", "x", "x2", "x'", "z", "z'"].flatMap((top) =>
  ["", "y", "y2", "y'"].map((turn) => `${top} ${turn}`.trim()),
);

async function sameUpToRotation(puzzle: string, a: string, b: string) {
  const kpuzzle = await (
    puzzles[puzzle] as NonNullable<(typeof puzzles)[string]>
  ).kpuzzle();
  // a equals b followed by one whole-puzzle rotation. Compared piece by piece,
  // since the library cannot judge "solved" for every cube size.
  const target = kpuzzle.defaultPattern().applyAlg(a);
  const reached = kpuzzle.defaultPattern().applyAlg(b);
  return holds.some((hold) => reached.applyAlg(hold).isIdentical(target));
}

test("the comparison itself tells different states apart", async () => {
  // On two layers a turn of one side equals a turn of the other side plus a
  // rotation, so B and F are the same turn here, and R U is a different state.
  expect(await sameUpToRotation("2x2x2", "L U", "R B")).toBe(true);
  expect(await sameUpToRotation("2x2x2", "L U", "R F")).toBe(true);
  expect(await sameUpToRotation("2x2x2", "L U", "R U")).toBe(false);
  expect(await sameUpToRotation("2x2x2", "R U", "U R")).toBe(false);
  expect(await sameUpToRotation("6x6x6", "3Lw U", "3Rw B")).toBe(true);
  expect(await sameUpToRotation("6x6x6", "3Lw U", "3Rw U")).toBe(false);
});

describe("2x2x2: only U R F, as the official program writes it", () => {
  test("300 random U F L R sequences keep their state up to rotation", async () => {
    const next = random(222);
    for (let i = 0; i < 300; i++) {
      const raw = sequence(next, ["U", "F", "L", "R"], 11);
      const official = officialTwoByTwo(raw);
      expect(official, raw).not.toMatch(/[LDB]/);
      expect(await sameUpToRotation("2x2x2", raw, official), raw).toBe(true);
    }
  });

  test("all six faces are handled, not only the library's four", async () => {
    const next = random(6);
    for (let i = 0; i < 100; i++) {
      const raw = sequence(next, ["U", "D", "F", "B", "L", "R"], 12);
      const official = officialTwoByTwo(raw);
      expect(official, raw).not.toMatch(/[LDB]/);
      expect(await sameUpToRotation("2x2x2", raw, official), raw).toBe(true);
    }
  });

  test("L next to R becomes one move", () => {
    expect(officialTwoByTwo("L R")).toBe("R2");
    expect(officialTwoByTwo("L R'")).toBe("");
    // After L is written as R, the cube has turned like x': F is now on top.
    expect(officialTwoByTwo("U L R2 F")).toBe("U R' U");
  });

  test("a scramble already in U R F comes back unchanged", () => {
    const official = "U2 R' F U' R U R' F U R' U2";
    expect(officialTwoByTwo(official)).toBe(official);
  });
});

describe("6x6x6: of the three-layer moves only 3Rw 3Fw 3Uw", () => {
  const families = [
    "U",
    "D",
    "F",
    "B",
    "L",
    "R",
    "Uw",
    "Dw",
    "Fw",
    "Bw",
    "Lw",
    "Rw",
    "3Uw",
    "3Dw",
    "3Fw",
    "3Bw",
    "3Lw",
    "3Rw",
  ];

  test("100 random sequences of 80 moves keep their state up to rotation", async () => {
    const next = random(666);
    for (let i = 0; i < 100; i++) {
      const raw = sequence(next, families, 80);
      const official = officialBigCube(raw);
      expect(official, raw).not.toMatch(/3[LDB]w/);
      expect(await sameUpToRotation("6x6x6", raw, official), raw).toBe(true);
    }
  }, 60_000);

  test("moves of one or two layers keep their face, relabelled after a rotation", () => {
    expect(officialBigCube("Lw2 Dw R")).toBe("Lw2 Dw R");
    expect(officialBigCube("3Lw U")).toBe("3Rw B");
  });
});
