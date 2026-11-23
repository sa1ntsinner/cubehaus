import { EVENTS } from "@cubehaus/core";
import { holdingFaces } from "@cubehaus/cube/holding";
import { expect, test } from "vitest";
import { heldColour, puzzleGlyph } from "./puzzle-glyph";

const numbers = (d: string) =>
  Array.from(d.matchAll(/-?\d+(?:\.\d+)?/g), ([n]) => Number(n));

test("every puzzle has a picture inside its 100 × 100 box", () => {
  for (const { id } of EVENTS) {
    const { shapes } = puzzleGlyph(id);
    expect(shapes.length, id).toBeGreaterThan(4);
    for (const { d } of shapes) {
      expect(d, id).not.toMatch(/NaN|Infinity/);
      // Clock's dials are drawn with relative arcs; their absolute starts stay inside.
      for (const n of numbers(d.replace(/a[^MLQZ]*/g, "")))
        expect(Math.abs(n - 50), `${id} ${n}`).toBeLessThanOrEqual(52);
    }
  }
});

test("a cube shows its grid on three faces: 2×2 to 7×7 differ by their stickers", () => {
  for (const [id, n] of [
    ["222", 2],
    ["333", 3],
    ["444", 4],
    ["555", 5],
    ["666", 6],
    ["777", 7],
  ] as const) {
    const stickers = puzzleGlyph(id).shapes.filter(({ colour }) => colour);
    expect(stickers.length, id).toBe(3 * n * n);
    expect(new Set(stickers.map(({ colour }) => colour))).toEqual(
      new Set(["U", "F", "R"]),
    );
  }
  expect(puzzleGlyph("333oh").mark).toBe("OH");
  expect(puzzleGlyph("444bf").mark).toBe("BLD");
  expect(puzzleGlyph("333fm").mark).toBe("FMC");
  // Multi-Blind is three cubes.
  expect(
    puzzleGlyph("333mbf").shapes.filter(({ colour }) => colour).length,
  ).toBe(3 * 27);
});

test("a big cube's seams stay hairlines, so 6×6 and 7×7 read as a fine grid, not as core", () => {
  // The seam is the space between two stickers' paths: compare a sticker's span with
  // the face's pitch. On 7×7 a sticker keeps more than 84 % of its pitch (with the old
  // 1.5-unit seams 6×6 kept 77 %).
  const width = (d: string) => {
    const xs = numbers(d).filter((_, i) => i % 2 === 0);
    return Math.max(...xs) - Math.min(...xs);
  };
  for (const id of ["666", "777"] as const) {
    const n = id === "666" ? 6 : 7;
    const top = puzzleGlyph(id).shapes.filter(({ colour }) => colour === "U");
    const pitch = (2 * 46 * Math.cos(Math.PI / 6)) / n;
    const sticker = width((top[0] as { d: string }).d);
    expect(sticker / pitch, id).toBeGreaterThan(0.84);
  }
});

test("the cubes' colours follow the holding: yellow on top, green in front, orange right", () => {
  const faces = holdingFaces("DF");
  expect(heldColour("333", "U", faces)).toBe("D");
  expect(heldColour("333", "F", faces)).toBe("F");
  expect(heldColour("333", "R", faces)).toBe("L");
  expect(heldColour("skewb", "U", faces)).toBe("D");
  expect(heldColour("sq1", "U", faces)).toBe("D");
  expect(heldColour("333mbf", "R", faces)).toBe("L");
  // As scrambled: white on top.
  expect(heldColour("444", "U", holdingFaces("UF"))).toBe("U");
  // Puzzles that are not held as a cube keep their own colours.
  expect(heldColour("minx", "U", faces)).toBe("U");
  expect(heldColour("pyram", "F", faces)).toBe("F");
  expect(heldColour("fto", "R", faces)).toBe("R");
  expect(heldColour("333", "purple", faces)).toBe("purple");
});
