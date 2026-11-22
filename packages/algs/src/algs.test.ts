import { readFileSync, writeFileSync } from "node:fs";
import { classifyLL, stickersOf } from "@cubehaus/scramble/last-layer";
import { fromKey } from "@cubehaus/scramble/last-layer-state";
import { generateTraining } from "@cubehaus/scramble/training";
import { describe, expect, it } from "vitest";
import { type BuiltSet, buildSet, render, turned } from "./build";
import { collWords } from "./collwords";
import { lights, upExactly } from "./diagram";
import { pictureOf, trainerSet } from "./index";
import type { SetId } from "./types";
import { kpuzzle, memberState, verify } from "./verify";

const dataFile = (set: SetId) => new URL(`./data/${set}.ts`, import.meta.url);

/**
 * The shipped data is rebuilt here from the candidates. With ALGS_WRITE=1 the build is
 * written; otherwise the committed file must equal it, so nothing unverified or stale
 * ships.
 */
async function rebuilt(set: SetId): Promise<BuiltSet> {
  const built = await buildSet(set);
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
      // A description is read from the picture; one shared by two cases of a shape is
      // dropped from both.
      const words = collWords(c.group as "S", pictureOf(c));
      const twins = cases.filter(
        (o) =>
          o.group === c.group &&
          collWords(o.group as "S", pictureOf(o)).en === words.en,
      );
      expect(c.recognise, c.label).toEqual(twins.length > 1 ? null : words);
    }
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
});
