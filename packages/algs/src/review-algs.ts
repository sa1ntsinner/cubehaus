import { placePair } from "@cubehaus/scramble/f2l";
import { f2lState } from "@cubehaus/scramble/f2l-state";
import type { KPuzzle } from "cubing/kpuzzle";
import { parseAlg } from "./metrics";
import {
  applyCube,
  type Cube,
  coIndex,
  cpIndex,
  efIndex,
  epIndex,
  type Goal,
  MOVES18,
} from "./optimal";
import { memberState } from "./verify";

/**
 * The algorithm review's goals and starting cubes for our own optimal search (optimal.ts),
 * one family per kind of set: PLL solved, COLL corners solved and edges oriented, OLL all
 * oriented (each with the first two layers whole and a U turn free after), F2L the first
 * two layers whole (the last layer anything). A case starts from its member after each of
 * the four U turns before. Build and test time only.
 */

export type Family = "pll" | "coll" | "oll" | "f2l";

const solved = (): Cube => ({
  corners: { pieces: [...Array(8).keys()], orientation: Array(8).fill(0) },
  edges: { pieces: [...Array(12).keys()], orientation: Array(12).fill(0) },
});

function perms4(): number[][] {
  const out: number[][] = [];
  const walk = (p: number[]) => {
    if (p.length === 4) out.push(p);
    else for (let v = 0; v < 4; v++) if (!p.includes(v)) walk([...p, v]);
  };
  walk([]);
  return out;
}

const home = (
  p: { pieces: number[]; orientation: number[] },
  places: readonly number[],
) => places.every((i) => p.pieces[i] === i && p.orientation[i] === 0);

/** The cube after U turned k times. */
export function uTurns(moves: readonly Cube[], k: number): Cube {
  let c = solved();
  for (let i = 0; i < k; i++)
    c = applyCube(c, moves[MOVES18.indexOf("U")] as Cube);
  return c;
}

export function goalOf(family: Family, moves: readonly Cube[]): Goal {
  const turns = [0, 1, 2, 3].map((k) => uTurns(moves, k));
  const withTop = (
    cp: number[],
    co: number[],
    ep: number[],
    eo: number[],
  ): Cube => ({
    corners: { pieces: [...cp, 4, 5, 6, 7], orientation: [...co, 0, 0, 0, 0] },
    edges: {
      pieces: [...ep, 4, 5, 6, 7, 8, 9, 10, 11],
      orientation: [...eo, ...Array(8).fill(0)],
    },
  });
  const firstTwo = (c: Cube) =>
    home(c.corners, [4, 5, 6, 7]) && home(c.edges, [4, 5, 6, 7, 8, 9, 10, 11]);
  const oriented = (c: Cube) =>
    [0, 1, 2, 3].every(
      (i) => c.corners.orientation[i] === 0 && c.edges.orientation[i] === 0,
    );
  const same = (a: Cube, b: Cube) =>
    a.corners.pieces.every((p, i) => p === b.corners.pieces[i]) &&
    a.edges.pieces.every((p, i) => p === b.edges.pieces[i]) &&
    a.corners.orientation.every((o, i) => o === b.corners.orientation[i]) &&
    a.edges.orientation.every((o, i) => o === b.edges.orientation[i]);
  const cornersAt = (c: Cube, u: Cube) =>
    c.corners.pieces.every((p, i) => p === u.corners.pieces[i]) &&
    c.corners.orientation.every((o, i) => o === u.corners.orientation[i]);
  const tops = perms4();
  const zero = [0, 0, 0, 0];
  const edgesB = [epIndex(solved(), 6) * 64 + efIndex(solved(), 6)];
  if (family === "pll")
    return {
      holds: (c) => turns.some((u) => same(c, u)),
      corners: turns.map((u) => cpIndex(u) * 2187 + coIndex(u)),
      edgesA: turns.map((u) => epIndex(u, 0) * 64 + efIndex(u, 0)),
      edgesB,
    };
  const anyTop = tops.map((p) => withTop(p, zero, p, zero));
  const edgesA = anyTop.map((c) => epIndex(c, 0) * 64 + efIndex(c, 0));
  if (family === "coll")
    return {
      holds: (c) =>
        firstTwo(c) && oriented(c) && turns.some((u) => cornersAt(c, u)),
      corners: turns.map((u) => cpIndex(u) * 2187 + coIndex(u)),
      edgesA,
      edgesB,
    };
  if (family === "oll")
    return {
      holds: (c) => firstTwo(c) && oriented(c),
      corners: anyTop.map((c) => cpIndex(c) * 2187 + coIndex(c)),
      edgesA,
      edgesB,
    };
  // F2L: the top anything, twists and flips that sum right.
  const corners: number[] = [];
  const edges: number[] = [];
  for (const p of tops)
    for (let t = 0; t < 27; t++) {
      const co = [t % 3, Math.floor(t / 3) % 3, Math.floor(t / 9)];
      co.push(
        (6 - (co[0] as number) - (co[1] as number) - (co[2] as number)) % 3,
      );
      const c = withTop(p, co, p, zero);
      corners.push(cpIndex(c) * 2187 + coIndex(c));
    }
  for (const p of tops)
    for (let f = 0; f < 8; f++) {
      const eo = [f & 1, (f >> 1) & 1, (f >> 2) & 1];
      eo.push(((eo[0] as number) + (eo[1] as number) + (eo[2] as number)) % 2);
      const c = withTop(p, zero, p, eo);
      edges.push(epIndex(c, 0) * 64 + efIndex(c, 0));
    }
  return { holds: firstTwo, corners, edgesA: edges, edgesB };
}

/** A case's member as a cube: last-layer sets from their key, F2L from its pair. */
export function memberCube(puzzle: KPuzzle, family: Family, key: string): Cube {
  if (family === "f2l") {
    const data = placePair(puzzle.defaultPattern(), f2lState(key))
      .patternData as unknown as {
      CORNERS: { pieces: number[]; orientation: number[] };
      EDGES: { pieces: number[]; orientation: number[] };
    };
    return {
      corners: {
        pieces: [...data.CORNERS.pieces],
        orientation: [...data.CORNERS.orientation],
      },
      edges: {
        pieces: [...data.EDGES.pieces],
        orientation: [...data.EDGES.orientation],
      },
    };
  }
  const top = memberState(family, key);
  return {
    corners: {
      pieces: [...top.cp, 4, 5, 6, 7],
      orientation: [...top.co, 0, 0, 0, 0],
    },
    edges: {
      pieces: [...top.ep, 4, 5, 6, 7, 8, 9, 10, 11],
      orientation: [...top.eo, ...Array(8).fill(0)],
    },
  };
}

/** The member after each U turn before. */
export const startsOf = (member: Cube, moves: readonly Cube[]) =>
  [0, 1, 2, 3].map((k) => applyCube(member, uTurns(moves, k)));

/**
 * An algorithm's length in the half-turn metric the search counts: a face or wide turn is
 * one, a slice two (both outer layers), a rotation none.
 */
export function htm(alg: string): number {
  let n = 0;
  for (const t of parseAlg(alg)) {
    if ("xyz".includes(t.letter)) continue;
    n += "MES".includes(t.letter) ? 2 : 1;
  }
  return n;
}
