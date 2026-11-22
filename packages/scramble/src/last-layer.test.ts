import { cubeState } from "@cubehaus/cube";
import { Alg } from "cubing/alg";
import { puzzles } from "cubing/puzzles";
import { describe, expect, it } from "vitest";
import { allLastLayers, isOriented, ollKey, pllKey } from "./last-layer";
import {
  classifyLL,
  lastLayerCases,
  lastLayerOf,
  llCasesOf,
  stickersOf,
} from "./last-layer-cases";
import { generateTraining } from "./training";

function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

/** Our own sticker model's top layer in the diagram's order (last-layer-cases.ts). */
function topStickers(scramble: string): string {
  const s = cubeState(3, scramble);
  return [
    ...s.U,
    ...s.F.slice(0, 3),
    ...s.R.slice(0, 3),
    ...s.B.slice(0, 3),
    ...s.L.slice(0, 3),
  ].join("");
}

describe("last layer", () => {
  it("last-layer classifier covers all cases modulo AUF", async () => {
    const states = allLastLayers();
    expect(states).toHaveLength(62_208);

    // 216 legal orientations, 58 OLL classes with the skip.
    const orientations = new Set(states.map((s) => `${s.eo}${s.co}`));
    expect(orientations.size).toBe(216);
    expect(new Set(states.map(ollKey)).size).toBe(58);
    // 288 legal oriented permutations, 22 PLL classes with the skip.
    const oriented = states.filter(isOriented);
    expect(oriented).toHaveLength(288);
    expect(new Set(oriented.map(pllKey)).size).toBe(22);

    const { oll, pll } = lastLayerCases();
    expect(oll).toHaveLength(58);
    expect(pll).toHaveLength(22);
    const ids = [...oll, ...pll].map((c) => c.id);
    expect(new Set(ids).size).toBe(80);
    // Labels: every PLL name once; every OLL case its conventional number.
    expect(pll.map((c) => c.label).sort()).toEqual(
      [
        "Aa",
        "Ab",
        "E",
        "F",
        "Ga",
        "Gb",
        "Gc",
        "Gd",
        "H",
        "Ja",
        "Jb",
        "Na",
        "Nb",
        "PLL skip",
        "Ra",
        "Rb",
        "T",
        "Ua",
        "Ub",
        "V",
        "Y",
        "Z",
      ].sort(),
    );
    expect(oll.map((c) => c.label)).toEqual([
      "OLL skip",
      ...Array.from({ length: 57 }, (_, i) => `OLL ${i + 1}`),
    ]);
    // By the edges: the skip, 7 with a cross, 3 with the corners only oriented, and the
    // 47 others with the edges flipped as a dot, a line or an L.
    const count = (group: string) =>
      oll.filter((c) => c.group === group).length;
    expect([count("skip"), count("cross"), count("corners")]).toEqual([
      1, 7, 3,
    ]);
    expect(count("dot") + count("line") + count("L")).toBe(47);

    const kpuzzle = await puzzles["3x3x3"]?.kpuzzle();
    if (!kpuzzle) throw new Error("Missing 3×3 KPuzzle loader");
    const solvedPattern = kpuzzle.defaultPattern();
    // last-layer.ts turns U as cubing defines it.
    const u = kpuzzle.moveToTransformation("U").transformationData;
    expect([...(u.EDGES?.permutation.slice(0, 4) ?? [])]).toEqual([1, 2, 3, 0]);
    expect([...(u.CORNERS?.permutation.slice(0, 4) ?? [])]).toEqual([
      1, 2, 3, 0,
    ]);
    expect([...(u.CORNERS?.orientationDelta.slice(0, 4) ?? [])]).toEqual([
      0, 0, 0, 0,
    ]);
    expect([...(u.EDGES?.orientationDelta.slice(0, 4) ?? [])]).toEqual([
      0, 0, 0, 0,
    ]);

    // H: the opposite edges swap in both pairs and the corners stay (M2 U M2 U2 M2 U M2
    // makes it; we read what it did, not its name).
    const h = lastLayerOf(solvedPattern.applyAlg("M2 U M2 U2 M2 U M2"));
    expect(h.ep).toEqual([2, 3, 0, 1]);
    expect(h.cp).toEqual([0, 1, 2, 3]);
    const hCase = pll.find((c) => c.label === "H");
    expect(classifyLL(solvedPattern.applyAlg("M2 U M2 U2 M2 U M2")).pll).toBe(
      hCase?.id,
    );
    // Sune is R U R' U R U2 R'; the case it solves is what its inverse makes.
    const sune = classifyLL(solvedPattern.applyAlg("R U2' R' U' R U' R'"));
    expect(oll.find((c) => c.id === sune.oll)?.label).toBe("OLL 27");
    expect(sune.pll).toBeNull();
    // T: R U R' U' R' F R2 U' R' U' R U R' F' (its own inverse).
    const t = classifyLL(
      solvedPattern.applyAlg("R U R' U' R' F R2 U' R' U' R U R' F'"),
    );
    expect(pll.find((c) => c.id === t.pll)?.label).toBe("T");
    expect(t.oll).toBe(oll.find((c) => c.label === "OLL skip")?.id);

    // Every case but the skips: several seeded scrambles reach the requested class, the
    // first two layers untouched, and the diagram matches our own sticker model.
    const next = seeded(28);
    for (const c of [...oll, ...pll]) {
      if (c.label?.endsWith("skip")) continue;
      for (let seed = 0; seed < 2; seed++) {
        const { scramble, caseId } = await generateTraining(
          { kind: c.kind, caseIds: [c.id] },
          next,
        );
        expect(caseId).toBe(c.id);
        const pattern = solvedPattern.applyAlg(scramble);
        const { EDGES: edges, CORNERS: corners } = pattern.patternData;
        for (let place = 4; place < 12; place++) {
          expect(edges?.pieces[place]).toBe(place);
          expect(edges?.orientation[place]).toBe(0);
        }
        for (let place = 4; place < 8; place++) {
          expect(corners?.pieces[place]).toBe(place);
          expect(corners?.orientation[place]).toBe(0);
        }
        const found = classifyLL(pattern);
        expect(c.kind === "oll" ? found.oll : found.pll).toBe(c.id);
        expect(stickersOf(lastLayerOf(pattern))).toBe(topStickers(scramble));
      }
    }

    // A full last-layer class, chosen among those of one OLL case.
    const fulls = llCasesOf(sune.oll);
    expect(fulls.length).toBeGreaterThan(1);
    const full = fulls[3] as string;
    const { scramble } = await generateTraining(
      { kind: "ll", caseIds: [full] },
      next,
    );
    expect(classifyLL(solvedPattern.applyAlg(scramble)).ll).toBe(full);

    // Nothing chosen or an unknown case: refused, never a random 3×3.
    await expect(
      generateTraining({ kind: "pll", caseIds: [] }, next),
    ).rejects.toThrow(RangeError);
    await expect(
      generateTraining({ kind: "oll", caseIds: ["oll-99999999"] }, next),
    ).rejects.toThrow(RangeError);
  }, 240_000);

  it("each OLL number is the case its algorithm solves", async () => {
    const kpuzzle = await puzzles["3x3x3"]?.kpuzzle();
    if (!kpuzzle) throw new Error("Missing 3×3 KPuzzle loader");
    const solved = kpuzzle.defaultPattern();
    const { oll } = lastLayerCases();
    // The case an algorithm solves is what its inverse makes of a solved cube. Each
    // inverse must leave the first two layers whole (lastLayerOf refuses otherwise),
    // and the 57 numbers must fall on 57 different classes: all but the skip.
    const found = new Map<string, number>();
    for (const [number, alg] of Object.entries(OLL_ALGORITHMS)) {
      const id = classifyLL(solved.applyAlg(new Alg(alg).invert())).oll;
      expect(found.has(id), `OLL ${number} shares a class`).toBe(false);
      found.set(id, Number(number));
      expect(oll.find((c) => c.id === id)?.label).toBe(`OLL ${number}`);
    }
    expect(found.size).toBe(57);
    const skip = oll.find((c) => c.label === "OLL skip");
    expect(
      oll.filter((c) => c !== skip && !found.has(c.id)).map((c) => c.id),
    ).toEqual([]);
    // The shapes agree with the groups: the seven dots, the 14 lines.
    const numbersIn = (group: string) =>
      oll
        .filter((c) => c.group === group)
        .map((c) => found.get(c.id))
        .sort((a, b) => (a as number) - (b as number));
    expect(numbersIn("dot")).toEqual([1, 2, 3, 4, 17, 18, 19]);
    expect(numbersIn("line")).toEqual([
      13, 14, 15, 16, 33, 34, 39, 40, 45, 46, 51, 52, 55, 56,
    ]);
    expect(numbersIn("corners")).toEqual([20, 28, 57]);
    expect(numbersIn("cross")).toEqual([21, 22, 23, 24, 25, 26, 27]);
  });
});

/**
 * One widely known algorithm per OLL number, written from memory and checked only by the
 * test above: each must solve a different case. Not a teaching set.
 */
const OLL_ALGORITHMS: Record<number, string> = {
  1: "R U2 R2 F R F' U2 R' F R F'",
  2: "F R U R' U' F' f R U R' U' f'",
  3: "f R U R' U' f' U' F R U R' U' F'",
  4: "f R U R' U' f' U F R U R' U' F'",
  5: "r' U2 R U R' U r",
  6: "r U2 R' U' R U' r'",
  7: "r U R' U R U2 r'",
  8: "l' U' L U' L' U2 l",
  9: "R U R' U' R' F R2 U R' U' F'",
  10: "R U R' U R' F R F' R U2 R'",
  11: "r U R' U R' F R F' R U2 r'",
  12: "F R U R' U' F' U F R U R' U' F'",
  13: "F U R U' R2 F' R U R U' R'",
  14: "R' F R U R' F' R F U' F'",
  15: "r' U' r R' U' R U r' U r",
  16: "r U r' R U R' U' r U' r'",
  17: "R U R' U R' F R F' U2 R' F R F'",
  18: "r U R' U R U2 r2 U' R U' R' U2 r",
  19: "M U R U R' U' M' R' F R F'",
  20: "r U R' U' M2 U R U' R' U' M'",
  21: "R U2 R' U' R U R' U' R U' R'",
  22: "R U2 R2 U' R2 U' R2 U2 R",
  23: "R2 D' R U2 R' D R U2 R",
  24: "r U R' U' r' F R F'",
  25: "F' r U R' U' r' F R",
  26: "R U2 R' U' R U' R'",
  27: "R U R' U R U2 R'",
  28: "r U R' U' M U R U' R'",
  29: "R U R' U' R U' R' F' U' F R U R'",
  30: "F U R U2 R' U' R U2 R' U' F'",
  31: "R' U' F U R U' R' F' R",
  32: "L U F' U' L' U L F L'",
  33: "R U R' U' R' F R F'",
  34: "R U R2 U' R' F R U R U' F'",
  35: "R U2 R2 F R F' R U2 R'",
  36: "L' U' L U' L' U L U L F' L' F",
  37: "F R' F' R U R U' R'",
  38: "R U R' U R U' R' U' R' F R F'",
  39: "L F' L' U' L U F U' L'",
  40: "R' F R U R' U' F' U R",
  41: "R U R' U R U2 R' F R U R' U' F'",
  42: "R' U' R U' R' U2 R F R U R' U' F'",
  43: "R' U' F' U F R",
  44: "f R U R' U' f'",
  45: "F R U R' U' F'",
  46: "R' U' R' F R F' U R",
  47: "R' U' R' F R F' R' F R F' U R",
  48: "F R U R' U' R U R' U' F'",
  49: "r U' r2 U r2 U r2 U' r",
  50: "r' U r2 U' r2 U' r2 U r'",
  51: "F U R U' R' U R U' R' F'",
  52: "R U R' U R U' B U' B' R'",
  53: "r' U' R U' R' U R U' R' U2 r",
  54: "r U R' U R U' R' U R U2 r'",
  55: "R U2 R2 U' R U' R' U2 F R F'",
  56: "r' U' r U' R' U R U' R' U R r' U r",
  57: "R U R' U' M' U R U' r'",
};
