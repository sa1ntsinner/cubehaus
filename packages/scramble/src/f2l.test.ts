import { cubeState } from "@cubehaus/cube";
import { puzzles } from "cubing/puzzles";
import { describe, expect, it } from "vitest";
import {
  backAlg,
  F2L_CASES,
  type F2lSlot,
  type F2lState,
  f2lKey,
  f2lLeftStickers,
  f2lOf,
  f2lReady,
  f2lState,
  f2lStickers,
  f2lTurned,
  mirrorAlg,
  mirrorPattern,
  placePair,
  slotAlg,
  slotPattern,
  slotStickers,
  unslotPattern,
} from "./f2l";
import { generateTraining } from "./training";

const kpuzzle = () =>
  (puzzles["3x3x3"] as NonNullable<(typeof puzzles)["3x3x3"]>).kpuzzle();

/** Every place of the pair's corner and edge, with every twist and flip: 150 states. */
function allStates(): F2lState[] {
  const states: F2lState[] = [];
  for (const corner of [0, 1, 2, 3, 4])
    for (const twist of [0, 1, 2])
      for (const edge of [0, 1, 2, 3, 8])
        for (const flip of [0, 1]) states.push({ corner, twist, edge, flip });
  return states;
}

function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

/** A turn sequence that keeps the cross and the other slots: inserts and U turns. */
function inserts(rng: () => number): string {
  const blocks = [
    "R U R'",
    "R U' R'",
    "R U2 R'",
    "F' U F",
    "F' U' F",
    "F' U2 F",
    "U",
    "U'",
    "U2",
  ];
  const count = 1 + Math.floor(rng() * 7);
  return Array.from(
    { length: count },
    () => blocks[Math.floor(rng() * blocks.length)],
  ).join(" ");
}

describe("F2L cases of the front right slot", () => {
  it("every case is reached by turns, and its picture is what our own cube shows", async () => {
    const puzzle = await kpuzzle();
    const rng = seeded(7);
    const reached = new Set<string>();
    for (let i = 0; i < 4000; i++) {
      const alg = inserts(rng);
      const pattern = puzzle.defaultPattern().applyAlg(alg);
      expect(f2lReady(pattern)).toBe(true);
      const state = f2lOf(pattern);
      const key = f2lKey(state);
      if (key !== null) reached.add(key);
      const ours = cubeState(3, alg);
      const faces = [...ours.U, ...ours.F, ...ours.R].join("");
      const picture = f2lStickers(state);
      for (let at = 0; at < 27; at++)
        if (picture[at] !== "x")
          expect(`${alg} @${at} ${picture[at]}`).toBe(
            `${alg} @${at} ${faces[at]}`,
          );
    }
    expect(reached.size).toBe(41);
  });

  it("there are 41, counted up to a U turn, the solved pair left out", () => {
    const keys = new Set(
      allStates()
        .map(f2lKey)
        .filter((key) => key !== null),
    );
    expect(keys.size).toBe(41);
    expect(F2L_CASES).toHaveLength(41);
    expect(new Set(F2L_CASES.map((c) => c.id)).size).toBe(41);
    expect(F2L_CASES.map((c) => c.label)).toEqual(
      Array.from({ length: 41 }, (_, i) => `F2L ${i + 1}`),
    );
    const groups = Object.groupBy(F2L_CASES, (c) => c.group);
    expect(groups.top).toHaveLength(24);
    expect(groups.edge).toHaveLength(6);
    expect(groups.corner).toHaveLength(6);
    expect(groups.slot).toHaveLength(5);
    // The solved pair is no case.
    expect(f2lKey({ corner: 4, twist: 0, edge: 8, flip: 0 })).toBeNull();
  });

  it("a U turn keeps the case, read from cubing's own cube", async () => {
    const puzzle = await kpuzzle();
    for (const state of allStates()) {
      const pattern = placePair(puzzle.defaultPattern(), state);
      expect(f2lOf(pattern)).toEqual(state);
      for (const turn of ["U", "U2", "U'"]) {
        const turned = f2lOf(pattern.applyAlg(turn));
        expect(f2lKey(turned)).toBe(f2lKey(state));
        expect(turned).toEqual(
          f2lTurned(state, { U: 1, U2: 2, "U'": 3 }[turn] as number),
        );
      }
    }
  });

  it("every case stands on a cube with the cross and the other slots whole", async () => {
    const puzzle = await kpuzzle();
    for (const c of F2L_CASES) {
      const pattern = placePair(puzzle.defaultPattern(), f2lState(c.key));
      expect(f2lReady(pattern)).toBe(true);
      expect(f2lKey(f2lOf(pattern))).toBe(c.key);
      // A cube turns can reach: twists and flips add up, the swaps are even.
      const { CORNERS, EDGES } = pattern.patternData as unknown as Record<
        string,
        { pieces: number[]; orientation: number[] }
      >;
      const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
      expect(sum(CORNERS?.orientation ?? []) % 3).toBe(0);
      expect(sum(EDGES?.orientation ?? []) % 2).toBe(0);
      const odd = (pieces: number[]) => {
        let swaps = 0;
        for (let i = 0; i < pieces.length; i++)
          for (let j = i + 1; j < pieces.length; j++)
            if ((pieces[i] as number) > (pieces[j] as number)) swaps++;
        return swaps % 2;
      };
      expect(odd(CORNERS?.pieces ?? [])).toBe(odd(EDGES?.pieces ?? []));
    }
    // A turn of D or of a back slot breaks it.
    expect(f2lReady(puzzle.defaultPattern().applyAlg("D"))).toBe(false);
    expect(f2lReady(puzzle.defaultPattern().applyAlg("L"))).toBe(false);
    expect(f2lReady(puzzle.defaultPattern().applyAlg("R"))).toBe(false);
    expect(f2lReady(puzzle.defaultPattern().applyAlg("R U R'"))).toBe(true);
  });
  it("a drill scramble reaches its case with the last layer scrambled", async () => {
    const puzzle = await kpuzzle();
    const rng = seeded(11);
    for (const c of F2L_CASES.filter((_, i) => i % 4 === 0)) {
      const { scramble, caseId } = await generateTraining(
        { kind: "f2l", caseIds: [c.id] },
        rng,
      );
      expect(caseId).toBe(c.id);
      const reached = puzzle.defaultPattern().applyAlg(scramble);
      expect(f2lReady(reached)).toBe(true);
      expect(f2lKey(f2lOf(reached))).toBe(c.key);
      // The last layer is mixed, not left solved.
      const { CORNERS, EDGES } = reached.patternData as unknown as Record<
        string,
        { pieces: number[]; orientation: number[] }
      >;
      const off = [0, 1, 2, 3].filter(
        (p) =>
          CORNERS?.pieces[p] !== p ||
          CORNERS?.orientation[p] !== 0 ||
          EDGES?.pieces[p] !== p ||
          EDGES?.orientation[p] !== 0,
      );
      expect(off.length).toBeGreaterThan(1);
    }
  }, 60_000);
});

describe("the front left slot, in the mirror", () => {
  const TURNS = [..."RLUDFBMESxyzrludfb".split(""), "Rw", "Lw", "Uw", "Fw"];
  const randomAlg = (rng: () => number, n: number) =>
    Array.from({ length: n }, () => {
      const face = TURNS[Math.floor(rng() * TURNS.length)] as string;
      return face + (["", "'", "2"][Math.floor(rng() * 3)] as string);
    }).join(" ");

  it("the mirror of a cube after any turns is the cube after the mirrored turns", async () => {
    const puzzle = await kpuzzle();
    const rng = seeded(5);
    for (let i = 0; i < 500; i++) {
      const alg = randomAlg(rng, 1 + Math.floor(rng() * 12));
      const mirrored = mirrorPattern(puzzle.defaultPattern().applyAlg(alg));
      const turned = puzzle.defaultPattern().applyAlg(mirrorAlg(alg));
      expect(`${alg} ${mirrored.isIdentical(turned)}`).toBe(`${alg} true`);
    }
  });

  it("turns in the mirror: R is L', M and x keep, U is U', and twice is the same", () => {
    expect(mirrorAlg("R U R' U'")).toBe("L' U' L U");
    expect(mirrorAlg("M x2 Rw' F2 y")).toBe("M x2 Lw F2 y'");
    const rng = seeded(9);
    for (let i = 0; i < 200; i++) {
      const alg = randomAlg(rng, 8);
      expect(mirrorAlg(mirrorAlg(alg))).toBe(
        mirrorAlg(mirrorAlg(mirrorAlg(mirrorAlg(alg)))),
      );
      expect(mirrorAlg(mirrorAlg(alg)).replace(/2'/g, "2")).toBe(
        alg.replace(/2'/g, "2"),
      );
    }
  });

  it("a left case's picture is what our sticker model shows, seen from the front left", async () => {
    const puzzle = await kpuzzle();
    const rng = seeded(7);
    const reached = new Set<string>();
    for (let i = 0; i < 4000; i++) {
      const right = inserts(rng);
      const alg = mirrorAlg(right);
      const pattern = puzzle.defaultPattern().applyAlg(alg);
      // The front right slot and the cross stay; the left pair is the mirrored case.
      const seen = mirrorPattern(pattern);
      expect(f2lReady(seen)).toBe(true);
      const state = f2lOf(seen);
      const key = f2lKey(state);
      expect(key).toBe(f2lKey(f2lOf(puzzle.defaultPattern().applyAlg(right))));
      if (key !== null) reached.add(key);
      const ours = cubeState(3, alg);
      const faces = [ours.U, ours.F, ours.L];
      const picture = f2lLeftStickers(state);
      for (let at = 0; at < 27; at++) {
        if (picture[at] === "x") continue;
        const i = at % 9;
        const face = faces[Math.floor(at / 9)] as readonly string[];
        const sticker = face[Math.floor(i / 3) * 3 + (2 - (i % 3))];
        expect(`${alg} @${at} ${picture[at]}`).toBe(`${alg} @${at} ${sticker}`);
      }
    }
    expect(reached.size).toBe(41);
  });
});

describe("the back slots, the front right slot seen after a turn of the cube", () => {
  const TURNS = [
    "R",
    "L",
    "U",
    "D",
    "F",
    "B",
    "Rw",
    "Lw",
    "Fw",
    "Bw",
    "r",
    "f",
  ];
  const randomAlg = (rng: () => number, n: number) =>
    Array.from({ length: n }, () => {
      const face = TURNS[Math.floor(rng() * TURNS.length)] as string;
      return face + (["", "'", "2"][Math.floor(rng() * 3)] as string);
    }).join(" ");

  it("turns renamed for the back right slot: R is B, F is R, B is L, L is F", () => {
    expect(backAlg("R U R'")).toBe("B U B'");
    expect(backAlg("F' U' F")).toBe("R' U' R");
    expect(backAlg("L2 B Rw' D")).toBe("F2 L Bw' D");
    expect(() => backAlg("M")).toThrow(RangeError);
  });

  it("for every slot, the cube after the slot's turns is the front right cube seen turned", async () => {
    const puzzle = await kpuzzle();
    const rng = seeded(13);
    for (const slot of ["fr", "fl", "br", "bl"] as const)
      for (let i = 0; i < 200; i++) {
        const alg = randomAlg(rng, 1 + Math.floor(rng() * 10));
        const seen = slotPattern(puzzle.defaultPattern().applyAlg(alg), slot);
        const turned = puzzle.defaultPattern().applyAlg(slotAlg(alg, slot));
        expect(`${slot} ${alg} ${seen.isIdentical(turned)}`).toBe(
          `${slot} ${alg} true`,
        );
        expect(
          unslotPattern(seen, slot).isIdentical(
            puzzle.defaultPattern().applyAlg(alg),
          ),
        ).toBe(true);
      }
  });

  // Our own sticker model, turned so the slot stands at the front right (or, drawn in the
  // mirror, the front left): the faces a picture of that slot shows.
  const VIEW: Record<F2lSlot, { turn: string; third: "R" | "L" }> = {
    fr: { turn: "", third: "R" },
    fl: { turn: "", third: "L" },
    br: { turn: "y", third: "R" },
    bl: { turn: "y'", third: "L" },
  };

  for (const slot of ["br", "bl"] as const)
    it(`a ${slot.toUpperCase()} case's picture is what our sticker model shows from above that corner`, async () => {
      const puzzle = await kpuzzle();
      const rng = seeded(slot === "br" ? 17 : 19);
      const reached = new Set<string>();
      // Random inserts until every case is met (a few thousand), each checked.
      for (let i = 0; i < 20_000 && reached.size < 41; i++) {
        const right = inserts(rng);
        const alg = slotAlg(right, slot);
        const pattern = puzzle.defaultPattern().applyAlg(alg);
        // Every other slot and the cross stay; the slot's pair is the right case.
        const seen = unslotPattern(pattern, slot);
        if (!f2lReady(seen)) expect.fail(`${alg}: a slot or the cross moved`);
        const state = f2lOf(seen);
        const key = f2lKey(state);
        if (key !== f2lKey(f2lOf(puzzle.defaultPattern().applyAlg(right))))
          expect.fail(`${alg}: not the right case's key`);
        if (key !== null) reached.add(key);
        const view = VIEW[slot];
        const ours = cubeState(3, `${alg} ${view.turn}`.trim());
        const faces = [ours.U, ours.F, ours[view.third]];
        const picture = slotStickers(state, slot);
        const mirrored = view.third === "L";
        for (let at = 0; at < 27; at++) {
          if (picture[at] === "x") continue;
          const i = at % 9;
          const face = faces[Math.floor(at / 9)] as readonly string[];
          const sticker =
            face[mirrored ? Math.floor(i / 3) * 3 + (2 - (i % 3)) : i];
          if (picture[at] !== sticker)
            expect.fail(
              `${alg} @${at}: ${picture[at]} drawn, ${sticker} on the cube`,
            );
        }
      }
      expect(reached.size).toBe(41);
    });

  it("the slot's pictures: front right as before, front left as before", () => {
    for (const c of F2L_CASES) {
      const state = f2lState(c.key);
      expect(slotStickers(state, "fr")).toBe(f2lStickers(state));
      expect(slotStickers(state, "fl")).toBe(f2lLeftStickers(state));
    }
  });

  it("a drill scramble for a slot, the front right one renamed, reaches the slot's case", async () => {
    const puzzle = await kpuzzle();
    const rng = seeded(23);
    for (const slot of ["fl", "br", "bl"] as const)
      for (const c of F2L_CASES.filter((_, i) => i % 5 === 0)) {
        const { scramble } = await generateTraining(
          { kind: "f2l", caseIds: [c.id] },
          rng,
        );
        const reached = puzzle
          .defaultPattern()
          .applyAlg(slotAlg(scramble, slot));
        const seen = unslotPattern(reached, slot);
        expect(f2lReady(seen), `${slot} ${c.label}`).toBe(true);
        expect(f2lKey(f2lOf(seen)), `${slot} ${c.label}`).toBe(c.key);
      }
  }, 60_000);
});
