import { cubeState, type Face, solveCross, solveXCross } from "@cubehaus/cube";
import { puzzles } from "cubing/puzzles";
import { describe, expect, it } from "vitest";
import { generateTraining } from "./training";

function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

const TURN = /^[ULFRBD](2|')?$/;
const turns = (scramble: string) => scramble.split(" ").filter(Boolean);

async function replay() {
  const kpuzzle = await puzzles["3x3x3"]?.kpuzzle();
  if (!kpuzzle) throw new Error("Missing 3×3 KPuzzle loader");
  return (scramble: string) => {
    const data = kpuzzle.defaultPattern().applyAlg(scramble).patternData;
    const orbit = (name: "EDGES" | "CORNERS" | "CENTERS") => {
      const o = data[name];
      if (!o) throw new Error(`No ${name}`);
      return o;
    };
    const home = (name: "EDGES" | "CORNERS" | "CENTERS", i: number) =>
      orbit(name).pieces[i] === i && orbit(name).orientation[i] === 0;
    return {
      home,
      solved: (name: "EDGES" | "CORNERS") =>
        orbit(name).pieces.every((_, i) => home(name, i)),
      centres: () =>
        [0, 1, 2, 3, 4, 5].every((i) => orbit("CENTERS").pieces[i] === i),
      key: () => JSON.stringify(data),
    };
  };
}

/** Our own sticker model: is the whole cube solved? */
const identity = (scramble: string) =>
  JSON.stringify(cubeState(3, scramble)) === JSON.stringify(cubeState(3, ""));

describe("generateTraining", () => {
  it("generated state matches the request after independent replay", async () => {
    const after = await replay();
    const next = seeded(27);
    const batch = 32;

    for (const length of [0, 1, 4]) {
      const states = new Set<string>();
      for (let i = 0; i < batch; i++) {
        const { scramble, caseId } = await generateTraining(
          { kind: "easy-cross", face: "D", length },
          next,
        );
        expect(turns(scramble).every((t) => TURN.test(t))).toBe(true);
        expect(solveCross(scramble, "D").length).toBe(length);
        expect(caseId).toBe(`easy-cross:D:${length}`);
        expect(after(scramble).centres()).toBe(true);
        states.add(after(scramble).key());
      }
      // The pieces outside the cross are drawn anew each time.
      expect(states.size).toBeGreaterThan(1);
    }

    for (const length of [0, 1, 4]) {
      const states = new Set<string>();
      for (let i = 0; i < batch; i++) {
        const { scramble, caseId } = await generateTraining(
          { kind: "easy-xcross", face: "D", length },
          next,
        );
        expect(turns(scramble).every((t) => TURN.test(t))).toBe(true);
        expect(solveXCross(scramble, "D")?.length).toBe(length);
        expect(caseId).toBe(`easy-xcross:D:${length}`);
        states.add(after(scramble).key());
      }
      expect(states.size).toBeGreaterThan(1);
    }

    for (let i = 0; i < batch; i++) {
      const { scramble } = await generateTraining(
        { kind: "cross-solved", face: "D" },
        next,
      );
      const state = after(scramble);
      for (const edge of [4, 5, 6, 7])
        expect(state.home("EDGES", edge)).toBe(true);
      expect(state.centres()).toBe(true);
      expect(identity(scramble)).toBe(false);
    }

    for (let i = 0; i < batch; i++) {
      const edges = after(
        (await generateTraining({ kind: "edges-only" }, next)).scramble,
      );
      expect(edges.solved("CORNERS")).toBe(true);
      expect(edges.solved("EDGES")).toBe(false);
      const corners = after(
        (await generateTraining({ kind: "corners-only" }, next)).scramble,
      );
      expect(corners.solved("EDGES")).toBe(true);
      expect(corners.solved("CORNERS")).toBe(false);
    }

    for (let i = 0; i < batch; i++) {
      const { scramble, caseId } = await generateTraining(
        { kind: "two-gen" },
        next,
      );
      expect(caseId).toBe("two-gen");
      expect(turns(scramble).every((t) => /^[RU](2|')?$/.test(t))).toBe(true);
      expect(identity(scramble)).toBe(false);
    }

    // Another face: the cross is counted on that face.
    for (const face of ["U", "F", "L"] as Face[]) {
      const { scramble } = await generateTraining(
        { kind: "easy-cross", face, length: 3 },
        next,
      );
      expect(solveCross(scramble, face).length).toBe(3);
    }

    await expect(
      generateTraining({ kind: "easy-cross", face: "D", length: -1 }, next),
    ).rejects.toThrow(RangeError);
    await expect(
      generateTraining({ kind: "easy-xcross", face: "D", length: 7 }, next),
    ).rejects.toThrow(RangeError);
  }, 240_000);
});
