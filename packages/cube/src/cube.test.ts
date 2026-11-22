import { puzzles } from "cubing/puzzles";
import { describe, expect, it } from "vitest";
import { cubeState, type Face } from "./index";

const faces = ["U", "L", "F", "R", "B", "D"] as const;
const column = (face: Face[], n: number, c: number) =>
  face.filter((_, index) => index % n === c).join("");

describe("cubeState", () => {
  it.each([2, 3, 4, 5, 6, 7])("starts solved on a size %i cube", (n) => {
    const state = cubeState(n, "");
    expect(Object.keys(state)).toEqual(faces);
    for (const face of faces) {
      expect(state[face].join("")).toBe(face.repeat(n * n));
    }
  });

  it.each([1, 8, 3.5, NaN])("rejects unsupported size %s", (n) => {
    expect(() => cubeState(n, "")).toThrow(RangeError);
  });

  it("brings yellow up the front right column on R", () => {
    const state = cubeState(3, "R");
    expect(state.F.join("")).toBe("FFDFFDFFD");
    expect(column(state.U, 3, 2)).toBe("FFF");
    expect(column(state.B, 3, 0)).toBe("UUU");
  });

  it("brings the right top row to the front on U", () => {
    const state = cubeState(3, "U");
    expect(state.F.join("")).toBe("RRRFFFFFF");
    expect(state.L.join("")).toBe("FFFLLLLLL");
  });

  it("returns to solved after six R U R' U' sequences", () => {
    expect(cubeState(3, "R U R' U' ".repeat(6))).toEqual(cubeState(3, ""));
  });

  it("makes a checkerboard on each face", () => {
    const state = cubeState(3, "R2 L2 U2 D2 F2 B2");
    const opposites = ["D", "R", "B", "L", "F", "U"];
    for (const [i, face] of faces.entries()) {
      const opposite = opposites[i];
      expect(state[face].join("")).toBe(
        [
          face,
          opposite,
          face,
          opposite,
          face,
          opposite,
          face,
          opposite,
          face,
        ].join(""),
      );
    }
  });

  it.each([
    [4, "Rw", "FFDD"],
    [7, "3Rw", "FFFFDDD"],
    [7, "3R", "FFFFDFF"],
  ] as const)(
    "turns the specified layers on a size %i cube with %s",
    (n, alg, row) => {
      expect(cubeState(n, alg).F.join("")).toBe(row.repeat(n));
    },
  );

  it("treats lowercase moves as wide and skips unknown tokens", () => {
    expect(cubeState(5, "r junk 8R 0Rw 2x Mw\tUw2\nF'")).toEqual(
      cubeState(5, "Rw Uw2 F'"),
    );
  });

  it("has equivalent wide, inner, and whole cube turns", () => {
    expect(cubeState(3, "Rw")).toEqual(cubeState(3, "L x"));
    expect(cubeState(5, "x")).toEqual(cubeState(5, "R 2R 3R 4R L'"));
  });

  it("matches all 54 KPuzzle facelets on 40 seeded random algorithms", async () => {
    const puzzle = puzzles["3x3x3"];
    if (!puzzle) throw new Error("Missing 3×3 KPuzzle loader");
    const [svg, kpuzzle] = await Promise.all([puzzle.svg(), puzzle.kpuzzle()]);
    const colours: Record<string, Face> = {
      white: "U",
      orange: "L",
      limegreen: "F",
      red: "R",
      "#26f": "B",
      yellow: "D",
    };
    const solved = new Map<string, Face>();
    const locations: Array<{
      orbit: string;
      piece: number;
      orientation: number;
      face: Face;
      cell: number;
    }> = [];

    for (const [
      ,
      id = "",
      orbit = "",
      piece,
      orientation,
      x,
      y,
      fill = "",
    ] of svg.matchAll(
      /id="(([A-Z]+)-l(\d+)-o(\d+))"\s+href="#sticker"\s+transform="translate\(([\d.]+),([\d.]+)\)"[^>]+fill: ([^"]+)"/g,
    )) {
      const face = colours[fill];
      if (!face) throw new Error(`Unexpected 3×3 colour ${fill}`);
      solved.set(id, face);
      if (orbit === "CENTERS" && orientation !== "0") continue;
      // The SVG's solved colour identifies the face. The rounded coordinates
      // give the within-face row and column after removing the net offset.
      const col = Math.round((Number(x) % 3.2) - 0.1);
      const row = Math.round((Number(y) % 3.2) - 0.1);
      locations.push({
        orbit,
        piece: Number(piece),
        orientation: Number(orientation),
        face,
        cell: row * 3 + col,
      });
    }
    expect(
      new Set(locations.map(({ face, cell }) => `${face}${cell}`)).size,
    ).toBe(54);

    let seed = 0xc0be;
    function pick<T>(items: readonly T[]): T {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return items[Math.floor((seed / 2 ** 32) * items.length)] as T;
    }
    const groups = [
      ["R", "L", "U", "D", "F", "B"],
      ["Rw", "Uw", "Fw", "Lw", "Dw", "Bw"],
      ["x", "y", "z"],
      ["M", "E", "S"],
    ];
    const moves = groups.flat();
    const counts = new Map(
      kpuzzle.definition.orbits.map((orbit) => [
        orbit.orbitName,
        orbit.numOrientations,
      ]),
    );
    for (let trial = 0; trial < 40; trial++) {
      const mixed = [
        ...groups.map(pick),
        ...Array.from({ length: 21 }, () => pick(moves)),
      ];
      const alg = mixed.map((move) => move + pick(["", "'", "2"])).join(" ");
      const state = cubeState(3, alg);
      const { patternData } = kpuzzle.defaultPattern().applyAlg(alg);
      for (const { orbit, piece, orientation, face, cell } of locations) {
        const data = patternData[orbit];
        const count = counts.get(orbit);
        if (!data || !count) throw new Error(`Unexpected 3×3 orbit ${orbit}`);
        const from =
          (orientation + count - Number(data.orientation[piece])) % count;
        const expected = solved.get(`${orbit}-l${data.pieces[piece]}-o${from}`);
        expect(expected).toBeDefined();
        expect(state[face][cell], `${alg}, ${face} cell ${cell}`).toBe(
          expected,
        );
      }
    }
  });
});
