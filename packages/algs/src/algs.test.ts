import { readFileSync, writeFileSync } from "node:fs";
import {
  f2lKey,
  f2lOf,
  f2lSolved,
  mirrorPattern,
  placePair,
  slotPattern,
  unslotPattern,
} from "@cubehaus/scramble/f2l";
import {
  type F2lSlot,
  f2lLeftStickers,
  f2lState,
  f2lStickers,
  slotStickers,
} from "@cubehaus/scramble/f2l-state";
import { classifyLL, stickersOf } from "@cubehaus/scramble/last-layer";
import { fromKey } from "@cubehaus/scramble/last-layer-state";
import { generateTraining } from "@cubehaus/scramble/training";
import { describe, expect, it } from "vitest";
import {
  type BuiltSet,
  buildF2l,
  buildF2lBack,
  buildF2lLeft,
  buildSet,
  render,
  turned,
} from "./build";
import F2L_BACK_SEARCHED from "./candidates/f2l-back-search.json";
import F2L_SEARCHED from "./candidates/f2l-search.json";
import { collWords, sameColour } from "./collwords";
import { lights, upExactly } from "./diagram";
import { pictureOf, trainerSet } from "./index";
import type { SetId } from "./types";
import { kpuzzle, memberState, verify, verifyF2l } from "./verify";

const dataFile = (set: SetId) => new URL(`./data/${set}.ts`, import.meta.url);

/**
 * The shipped data is rebuilt here from the candidates. With ALGS_WRITE=1 the build is
 * written; otherwise the committed file must equal it, so nothing unverified or stale
 * ships.
 */
async function rebuilt(
  set: Exclude<SetId, `two-${string}`>,
): Promise<BuiltSet> {
  const f2l = () => buildF2l(F2L_SEARCHED as Record<string, string[]>);
  const back = () =>
    buildF2lBack(F2L_BACK_SEARCHED as Record<string, string[]>);
  const built =
    set === "f2l"
      ? await f2l()
      : set === "f2l-left"
        ? await buildF2lLeft(await f2l())
        : set === "f2l-back"
          ? await back()
          : set === "f2l-back-left"
            ? await buildF2lLeft(await back())
            : await buildSet(set as "pll" | "oll" | "coll");
  const text = render(built);
  if (process.env.ALGS_WRITE === "1") writeFileSync(dataFile(set), text);
  expect(readFileSync(dataFile(set), "utf8")).toBe(text);
  return built;
}

describe("trainer sets", () => {
  it("every shipped PLL algorithm solves its case on both models", async () => {
    const built = await rebuilt("pll");
    const cases = trainerSet("pll");
    expect(cases).toHaveLength(21);
    expect(new Set(cases.map((c) => c.label)).size).toBe(21);
    // 2-look PLL as beginners learn it: T and Y place the corners, then the edges.
    expect(
      cases.filter((c) => c.subsets.includes("2-look")).map((c) => c.label),
    ).toEqual(["H", "T", "Ua", "Ub", "Y", "Z"]);
    for (const c of cases) {
      expect(c.algs.length, c.label).toBeGreaterThanOrEqual(1);
      expect(c.algs.length).toBeLessThanOrEqual(3);
      // The main algorithm solves the picture as it stands.
      expect(c.algs[0]?.auf).toBe(0);
      const key = c.id.slice(4);
      // The picture is a member of the case, turned as the main algorithm expects it.
      const member = memberState("pll", key);
      const pictures = [0, 1, 2, 3].map((k) => stickersOf(turned(member, k)));
      expect(pictures).toContain(pictureOf(c));
      expect(stickersOf(fromKey(c.state))).toBe(pictureOf(c));
      for (const alg of c.algs) {
        const verdict = await verify("pll", key, alg.moves);
        expect(verdict.ok, `${c.label}: ${alg.moves}`).toBe(true);
      }
    }
    // T's main algorithm (R U R' U' R' F R2 U' R' U' R U R' F') is shown with its
    // headlights on the left, as it is usually held; read from the picture, not assumed.
    const t = cases.find((c) => c.label === "T");
    expect(t?.algs[0]?.moves).toBe("R U R' U' R' F R2 U' R' U' R U R' F'");
    expect(lights(pictureOf(t as (typeof cases)[number]), "L")).toBe(true);
    // Every case has an explanation, in both languages, backed by its checks (build.ts).
    expect(cases.filter((c) => !c.recognise).map((c) => c.label)).toEqual([]);
    expect(built.rejected.length).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it("every shipped OLL algorithm orients its case", async () => {
    await rebuilt("oll");
    const cases = trainerSet("oll");
    expect(cases.map((c) => c.label)).toEqual(
      Array.from({ length: 57 }, (_, i) => `OLL ${i + 1}`),
    );
    expect(
      cases.filter((c) => c.subsets.includes("2-look")).map((c) => c.label),
    ).toEqual([2, 21, 22, 23, 24, 25, 26, 27, 44, 45].map((n) => `OLL ${n}`));
    for (const c of cases) {
      expect(c.algs.length, c.label).toBeGreaterThanOrEqual(1);
      expect(c.algs[0]?.auf).toBe(0);
      for (const alg of c.algs) {
        const verdict = await verify("oll", c.id.slice(4), alg.moves);
        expect(verdict.ok, `${c.label}: ${alg.moves}`).toBe(true);
      }
    }
    expect(cases.filter((c) => !c.recognise).map((c) => c.label)).toEqual([]);
    // Sune's picture: a cross, one corner up at the front left, the other three tops on
    // the front, right and back sides' right-hand stickers.
    const sune = cases.find((c) => c.label === "OLL 27");
    expect(sune?.algs[0]?.moves).toBe("R U R' U R U2 R'");
    expect(
      upExactly(
        pictureOf(sune as (typeof cases)[number]),
        "UB",
        "UL",
        "UR",
        "UF",
        "UFL",
        "F2",
        "R2",
        "B2",
      ),
    ).toBe(true);
  }, 60_000);

  it("COLL has 40 cases and every shipped algorithm solves its corners", async () => {
    const built = await rebuilt("coll");
    const cases = trainerSet("coll");
    const count = (group: string) =>
      cases.filter((c) => c.group === group).length;
    expect(cases).toHaveLength(40);
    expect(["H", "Pi", "U", "T", "L", "S", "AS"].map(count)).toEqual([
      4, 6, 6, 6, 6, 6, 6,
    ]);
    for (const c of cases) {
      expect(c.algs.length, c.label).toBeGreaterThanOrEqual(1);
      expect(c.algs[0]?.auf).toBe(0);
      for (const alg of c.algs) {
        const verdict = await verify("coll", c.id.slice(5), alg.moves);
        expect(verdict.ok, `${c.label}: ${alg.moves}`).toBe(true);
      }
      // A description is read from the picture. Two cases of a shape that read the same
      // are told apart by one sticker of the first that has the colour of another, which
      // holds on its picture and on no twin's.
      const words = collWords(c.group as "S", pictureOf(c));
      const twins = cases.filter(
        (o) =>
          o !== c &&
          o.group === c.group &&
          collWords(o.group as "S", pictureOf(o))?.en === words?.en,
      );
      const apart = sameColour(
        pictureOf(c),
        twins.map((o) => pictureOf(o)),
      );
      if (twins.length > 0) {
        expect(apart, c.label).not.toBeNull();
        const [a, b] = apart as [number, number];
        expect(pictureOf(c)[a]).toBe(pictureOf(c)[b]);
        for (const o of twins)
          expect(pictureOf(o)[a]).not.toBe(pictureOf(o)[b]);
      }
      expect(c.recognise, c.label).toEqual(
        collWords(
          c.group as "S",
          pictureOf(c),
          twins.map((o) => pictureOf(o)),
        ),
      );
    }
    // Every case has one.
    expect(cases.filter((c) => !c.recognise).map((c) => c.label)).toEqual([]);
    // Sune with its corners in place is solved by Sune itself.
    expect(cases.find((c) => c.label === "S 1")?.algs[0]?.moves).toBe(
      "R U R' U R U2 R'",
    );
    expect(built.candidates).toBeGreaterThan(900);
    // A COLL drill scramble reaches its case, read back from the scramble alone.
    const puzzle = await kpuzzle();
    let seed = 7;
    const rng = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (const c of cases.slice(0, 40).filter((_, i) => i % 5 === 0)) {
      const { scramble } = await generateTraining(
        { kind: "coll", caseIds: [c.id] },
        rng,
      );
      expect(classifyLL(puzzle.defaultPattern().applyAlg(scramble)).coll).toBe(
        c.id,
      );
    }
  }, 120_000);
  it("F2L has 41 cases and every shipped algorithm solves the slot in R, U and F", async () => {
    const built = await rebuilt("f2l");
    const cases = trainerSet("f2l");
    expect(cases).toHaveLength(41);
    const count = (group: string) =>
      cases.filter((c) => c.group === group).length;
    expect(["top", "edge", "corner", "slot"].map(count)).toEqual([24, 6, 6, 5]);
    for (const c of cases) {
      expect(c.algs, c.label).toHaveLength(3);
      expect(c.algs[0]?.auf).toBe(0);
      for (const alg of c.algs) {
        expect(alg.moves, c.label).toMatch(/^[RUF]['2]?( [RUF]['2]?)*$/);
        const verdict = await verifyF2l(c.id.slice(4), alg.moves);
        expect(verdict.ok, `${c.label}: ${alg.moves}`).toBe(true);
      }
      // The picture is the pair as the main algorithm expects it.
      expect(pictureOf(c)).toBe(f2lStickers(f2lState(c.state)));
      expect(f2lKey(f2lState(c.state))).toBe(c.id.slice(4));
    }
    // The plainest insert: the case R U' R' makes is solved by R U R'.
    const puzzle = await kpuzzle();
    const made = f2lKey(f2lOf(puzzle.defaultPattern().applyAlg("R U' R'")));
    expect(cases.find((c) => c.id === `f2l-${made}`)?.algs[0]?.moves).toBe(
      "R U R'",
    );
    expect(built.rejected).toEqual([]);
  }, 120_000);
  it("the front left slot has the same 41 cases in the mirror, each algorithm verified there", async () => {
    const built = await rebuilt("f2l-left");
    const right = trainerSet("f2l");
    const left = trainerSet("f2l-left");
    expect(left.map((c) => c.label)).toEqual(right.map((c) => c.label));
    const puzzle = await kpuzzle();
    for (const [i, c] of left.entries()) {
      const r = right[i] as (typeof right)[number];
      const key = r.id.slice(4);
      expect(c.id).toBe(`f2l-left-${key}`);
      expect(c.algs, c.label).toHaveLength(3);
      for (const alg of c.algs) {
        expect(alg.moves, c.label).toMatch(/^[LUF]['2]?( [LUF]['2]?)*$/);
        const verdict = await verifyF2l(key, alg.moves, "left");
        expect(verdict.ok, `${c.label}: ${alg.moves}`).toBe(true);
      }
      // From the cube the picture shows, U turned as many times as the algorithm says,
      // then the algorithm: the first two layers whole. The right slot the same way.
      for (const [set, cube] of [
        [
          c,
          mirrorPattern(placePair(puzzle.defaultPattern(), f2lState(c.state))),
        ],
        [r, placePair(puzzle.defaultPattern(), f2lState(r.state))],
      ] as const)
        for (const alg of set.algs) {
          const before = ["", "U", "U2", "U'"][alg.auf] as string;
          const after = (before ? cube.applyAlg(before) : cube).applyAlg(
            alg.moves,
          );
          expect(f2lSolved(after), `${set.id}: ${alg.moves}`).toBe(true);
        }
      // Its picture is the right one's in the mirror, a U turn there being U' here.
      expect(pictureOf(c)).toBe(f2lLeftStickers(f2lState(c.state)));
      for (const k of [1, 2, 3])
        expect(pictureOf(c, k)).toBe(pictureOf(r, 4 - k).replaceAll("R", "L"));
    }
    // The plainest insert on the left: L' U L makes the case L' U' L solves.
    const made = f2lKey(
      f2lOf(mirrorPattern(puzzle.defaultPattern().applyAlg("L' U L"))),
    );
    expect(left.find((c) => c.id === `f2l-left-${made}`)?.algs[0]?.moves).toBe(
      "L' U' L",
    );
    expect(built.rejected).toEqual([]);
  }, 120_000);
  for (const [set, slot, letters, insert, solves] of [
    ["f2l-back", "br", "RUB", "R' U R", "R' U' R"],
    ["f2l-back-left", "bl", "LUB", "L U' L'", "L U L'"],
  ] as const)
    it(`the ${slot.toUpperCase()} slot has the same 41 cases, each algorithm in ${[...letters].join(", ")} and verified there`, async () => {
      const built = await rebuilt(set);
      const right = trainerSet("f2l");
      const cases = trainerSet(set);
      expect(cases.map((c) => c.label)).toEqual(right.map((c) => c.label));
      const puzzle = await kpuzzle();
      const turn = new RegExp(`^[${letters}]['2]?( [${letters}]['2]?)*$`);
      for (const [i, c] of cases.entries()) {
        const key = (right[i] as (typeof right)[number]).id.slice(4);
        expect(c.id).toBe(`${set}-${key}`);
        expect(c.algs, c.label).toHaveLength(3);
        expect(c.algs[0]?.auf).toBe(0);
        // From the cube the picture shows, U turned as many times as the algorithm
        // says, then the algorithm: the first two layers whole.
        const cube = slotPattern(
          placePair(puzzle.defaultPattern(), f2lState(c.state)),
          slot as F2lSlot,
        );
        for (const alg of c.algs) {
          expect(alg.moves, c.label).toMatch(turn);
          const verdict = await verifyF2l(key, alg.moves, slot as F2lSlot);
          expect(verdict.ok, `${c.label}: ${alg.moves}`).toBe(true);
          const before = ["", "U", "U2", "U'"][alg.auf] as string;
          const after = (before ? cube.applyAlg(before) : cube).applyAlg(
            alg.moves,
          );
          expect(f2lSolved(after), `${c.id}: ${alg.moves}`).toBe(true);
        }
        expect(pictureOf(c)).toBe(
          slotStickers(f2lState(c.state), slot as F2lSlot),
        );
        expect(f2lKey(f2lState(c.state))).toBe(key);
      }
      // The plainest insert into the slot with the side beside it, no B turn.
      const made = f2lKey(
        f2lOf(
          unslotPattern(
            puzzle.defaultPattern().applyAlg(insert),
            slot as F2lSlot,
          ),
        ),
      );
      expect(cases.find((c) => c.id === `${set}-${made}`)?.algs[0]?.moves).toBe(
        solves,
      );
      expect(built.rejected).toEqual([]);
    }, 300_000);
});
