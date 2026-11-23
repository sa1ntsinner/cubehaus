import { describe, expect, it } from "vitest";
import {
  applyCube,
  CO,
  CP,
  type Cube,
  coIndex,
  cpIndex,
  EP,
  efIndex,
  epIndex,
  MOVES18,
  movesOf18,
  moveTables,
  optimal,
} from "./optimal";
import { kpuzzle } from "./verify";

const solved = (): Cube => ({
  corners: { pieces: [...Array(8).keys()], orientation: Array(8).fill(0) },
  edges: { pieces: [...Array(12).keys()], orientation: Array(12).fill(0) },
});

describe("optimal search in six faces", () => {
  it("its move tables follow cubing's turns on every coordinate", async () => {
    const puzzle = await kpuzzle();
    const moves = movesOf18(puzzle);
    const t = moveTables(moves);
    let seed = 3;
    const rng = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    let c = solved();
    let co = [
      cpIndex(c),
      coIndex(c),
      epIndex(c, 0),
      efIndex(c, 0),
      epIndex(c, 6),
      efIndex(c, 6),
    ];
    for (let n = 0; n < 2000; n++) {
      const m = Math.floor(rng() * 18);
      c = applyCube(c, moves[m] as Cube);
      const [p, o, ea, fa, eb, fb] = co as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      co = [
        t.cp[p * 18 + m] as number,
        t.co[o * 18 + m] as number,
        t.ep[ea * 18 + m] as number,
        fa ^ (t.ef[ea * 18 + m] as number),
        t.ep[eb * 18 + m] as number,
        fb ^ (t.ef[eb * 18 + m] as number),
      ];
      expect(co).toEqual([
        cpIndex(c),
        coIndex(c),
        epIndex(c, 0),
        efIndex(c, 0),
        epIndex(c, 6),
        efIndex(c, 6),
      ]);
    }
    // The cube after the turns is cubing's cube after the same turns.
    const data = puzzle.defaultPattern().applyAlg("R U F' L2 D B'")
      .patternData as unknown as {
      CORNERS: { pieces: number[] };
      EDGES: { pieces: number[] };
    };
    let mine = solved();
    for (const m of ["R", "U", "F'", "L2", "D", "B'"])
      mine = applyCube(mine, moves[MOVES18.indexOf(m)] as Cube);
    expect(mine.corners.pieces).toEqual(data.CORNERS.pieces);
    expect(mine.edges.pieces).toEqual(data.EDGES.pieces);
  }, 120_000);

  it("deepens one turn at a time, so the first found is the shortest", async () => {
    const puzzle = await kpuzzle();
    const moves = movesOf18(puzzle);
    const t = moveTables(moves);
    // No bounds at all: plain deepening, every depth searched in full.
    const zero = {
      corner: new Uint8Array(CP * CO),
      edgeA: new Uint8Array(EP * 64),
      edgeB: new Uint8Array(EP * 64),
    };
    const isSolved = (c: Cube) =>
      c.corners.pieces.every((p, i) => p === i) &&
      c.edges.pieces.every((p, i) => p === i) &&
      c.corners.orientation.every((o) => o === 0) &&
      c.edges.orientation.every((o) => o === 0);
    const goal = { holds: isSolved, corners: [], edgesA: [], edgesB: [] };
    let start = solved();
    for (const m of ["L'", "D2", "B"])
      start = applyCube(start, moves[MOVES18.indexOf(m)] as Cube);
    const found = optimal(t, zero, moves, goal, [start], {
      maxDepth: 4,
      budget: 1e7,
    });
    expect(found.alg).toBe("B' D2 L");
    expect(found.provenAtLeast).toBe(3);
    // A budget too small stops early and says how far it proved.
    const stopped = optimal(t, zero, moves, goal, [start], {
      maxDepth: 4,
      budget: 50,
    });
    expect(stopped.alg).toBeNull();
    expect(stopped.provenAtLeast).toBeLessThan(3);
  }, 120_000);
});
