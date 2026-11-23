import { readFileSync, writeFileSync } from "node:fs";
import { solve333 } from "@cubehaus/scramble/cubing";
import { describe, expect, it } from "vitest";
import SCRAMBLES from "./candidates/ls-scrambles.json";
import SEARCHED from "./candidates/ls-search.json";
import { LS_FRONT } from "./data/ls-front";
import { LS_RIGHT } from "./data/ls-right";
import { pictureOf } from "./index";
import {
  buildLastSlot,
  fullOf,
  LAST_SLOT,
  LAST_SLOT_KEYS,
  type LastSlotSet,
  lastLayerPattern,
  lastSlotKey,
  lastSlotMember,
  lastSlotPictures,
  lastSlotScramble,
  renderLastSlot,
  verifyLastSlot,
} from "./last-slot";
import { searchFrom, tables } from "./search";
import { kpuzzle } from "./verify";

const SETS = [
  ["ls-right", LS_RIGHT],
  ["ls-front", LS_FRONT],
] as const;
const dataFile = (set: LastSlotSet) =>
  new URL(`./data/${set}.ts`, import.meta.url);
type Searched = Record<LastSlotSet, Record<string, string[]>>;

function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

/** The search as the writer runs it: shortest in R, U, F and up to two turns more. */
const SEARCH = { maxDepth: 16, extra: 2, limit: 60, startU: true };

describe("last slot: insert the joined pair and orient the corners", () => {
  it("has 26 cases a set: a case is the top's twists alone, whatever the pieces' places", async () => {
    const puzzle = await kpuzzle();
    expect(LAST_SLOT_KEYS).toHaveLength(26);
    for (const set of ["ls-right", "ls-front"] as const) {
      // Every key is made by its member and the keys are distinct cases.
      for (const key of LAST_SLOT_KEYS)
        expect(lastSlotKey(set, lastSlotMember(puzzle, set, key))).toBe(key);
      // The pieces' places change nothing: any last layer with oriented edges and the
      // same twists, the insert undone after it, is the same case.
      const rng = seeded(5);
      const perms = [
        [0, 1, 2, 3],
        [1, 0, 2, 3],
        [2, 3, 0, 1],
        [3, 0, 1, 2],
      ];
      for (let n = 0; n < 200; n++) {
        const key = LAST_SLOT_KEYS[
          Math.floor(rng() * LAST_SLOT_KEYS.length)
        ] as string;
        const cp = perms[Math.floor(rng() * 4)] as number[];
        const ep = perms[Math.floor(rng() * 4)] as number[];
        const cube = lastLayerPattern(puzzle, key, cp, ep).applyAlg(
          LAST_SLOT[set].undo,
        );
        expect(lastSlotKey(set, cube)).toBe(key);
      }
      // No twist at all is the insert alone, not a case.
      expect(
        lastSlotKey(set, puzzle.defaultPattern().applyAlg(LAST_SLOT[set].undo)),
      ).toBeNull();
    }
  });

  for (const [set, shipped] of SETS)
    it(`${set}: every algorithm inserts and orients its case on both models, every scramble leads to it`, async () => {
      const puzzle = await kpuzzle();
      const built = await buildLastSlot(
        puzzle,
        set,
        (SEARCHED as Searched)[set],
        (SCRAMBLES as Searched)[set],
      );
      const text = renderLastSlot(built);
      if (process.env.ALGS_WRITE === "1") writeFileSync(dataFile(set), text);
      expect(readFileSync(dataFile(set), "utf8")).toBe(text);
      expect(built.rejected).toEqual([]);
      expect(shipped).toHaveLength(26);
      expect(new Set(shipped.map((c) => c.state))).toEqual(
        new Set(LAST_SLOT_KEYS),
      );
      for (const c of shipped) {
        expect(c.algs.length, c.label).toBeGreaterThanOrEqual(1);
        expect(c.algs.length, c.label).toBeLessThanOrEqual(3);
        for (const alg of c.algs) {
          expect(alg.auf).toBe(0);
          expect(alg.moves).toMatch(/^[RUF]['2]?( [RUF]['2]?)*$/);
          expect(
            await verifyLastSlot(puzzle, set, c.state, alg.moves),
            `${c.label}: ${alg.moves}`,
          ).toEqual({ ok: true });
        }
        // Pictures: as the OLL (21 letters) and F2L (27 letters) pictures, of the member.
        const member = lastSlotMember(puzzle, set, c.state);
        expect(c.pictures).toEqual(lastSlotPictures(member));
        expect(c.pictures.top).toHaveLength(21);
        expect(c.pictures.slot).toHaveLength(27);
        expect(pictureOf(c)).toBe(c.pictures.top);
        // A U turn of the picture is the picture of the cube after a U turn.
        for (const k of [1, 2, 3])
          expect(pictureOf(c, k)).toBe(
            lastSlotPictures(
              member.applyAlg(["", "U", "U2", "U'"][k] as string),
            ).top,
          );
        // Every drill scramble leads to the case, the top turned at most once.
        expect(c.scrambles).toHaveLength(8);
        for (const scramble of c.scrambles) {
          const cube = puzzle.defaultPattern().applyAlg(scramble);
          const keys = ["", "U", "U2", "U'"].map((t) =>
            lastSlotKey(set, t ? cube.applyAlg(t) : cube),
          );
          expect(
            keys.filter((k) => k !== null),
            scramble,
          ).toEqual([c.state]);
        }
      }
    }, 300_000);

  it("our search finds the same algorithms again for a sample of cases, and nothing shorter exists in R, U and F", async () => {
    const puzzle = await kpuzzle();
    const t = tables(puzzle, "oriented");
    for (const [set, key] of [
      ["ls-right", "1011"],
      ["ls-front", "2121"],
      ["ls-right", "0222"],
    ] as const) {
      const found = searchFrom(
        t,
        fullOf(lastSlotMember(puzzle, set, key)),
        SEARCH,
      );
      expect(found).toEqual((SEARCHED as Searched)[set][key]);
      // Shortest first: the search is admissible and deepens one turn at a time.
      const shortest = (found[0] as string).split(" ").length;
      const shorter = searchFrom(t, fullOf(lastSlotMember(puzzle, set, key)), {
        ...SEARCH,
        maxDepth: shortest - 1,
      });
      expect(shorter).toEqual([]);
    }
  }, 120_000);
});

/**
 * Writes `candidates/ls-search.json` (every case's algorithms in R, U and F: the shortest
 * and up to two turns longer, up to 60) and `candidates/ls-scrambles.json` (eight drill
 * scrambles a case from cubing's solver, a fixed seed). Run with ALGS_SEARCH=1.
 */
describe.runIf(process.env.ALGS_SEARCH === "1")("last slot search", () => {
  it("writes the candidates and the drill scrambles", async () => {
    const puzzle = await kpuzzle();
    const t = tables(puzzle, "oriented");
    const searched: Record<string, Record<string, string[]>> = {};
    const scrambles: Record<string, Record<string, string[]>> = {};
    const started = Date.now();
    for (const set of ["ls-right", "ls-front"] as const) {
      searched[set] = {};
      scrambles[set] = {};
      const rng = seeded(set === "ls-right" ? 101 : 202);
      for (const key of LAST_SLOT_KEYS) {
        (searched[set] as Record<string, string[]>)[key] = searchFrom(
          t,
          fullOf(lastSlotMember(puzzle, set, key)),
          SEARCH,
        );
        const list: string[] = [];
        for (let n = 0; n < 8; n++)
          list.push(await lastSlotScramble(puzzle, set, key, rng, solve333));
        (scrambles[set] as Record<string, string[]>)[key] = list;
      }
    }
    process.stdout.write(`last slot search: ${Date.now() - started} ms\n`);
    writeFileSync(
      new URL("./candidates/ls-search.json", import.meta.url),
      `${JSON.stringify(searched, null, 2)}\n`,
    );
    writeFileSync(
      new URL("./candidates/ls-scrambles.json", import.meta.url),
      `${JSON.stringify(scrambles, null, 2)}\n`,
    );
  }, 1_200_000);
});
