import { type F2lState, placePair } from "@cubehaus/scramble/f2l";
import type { KPuzzle } from "cubing/kpuzzle";
import {
  apply,
  EDGE_SIZE,
  edgeIndex,
  type Full,
  fill,
  MOVES,
  movesOf,
  solved,
} from "./search";

/**
 * Our own search for the front right slot's algorithms in R, U and F, sharing the last-layer
 * search's moves and its first-two-layer edge table (DF DR FR FL BR, places and flips).
 * A second bound covers the three bottom corners R and F move (DRF DFL DBR, places among
 * the seven R, U and F reach, and twists). Both are zero exactly when the cross and all four
 * slots are whole, since R, U and F never move DLB, DB, DL or BL. Build time only.
 */

// cubing's corner places R, U and F move, and the three bottom corners among them.
const CORNERS = [0, 1, 2, 3, 4, 5, 7];
const BOTTOM = [4, 5, 7];
const CORNER_SIZE = 7 * 6 * 5 * 27;

function cornerIndex(s: Full): number {
  let index = 0;
  const used: number[] = [];
  let twists = 0;
  for (const piece of BOTTOM) {
    const place = s.corners.pieces.indexOf(piece);
    const local = CORNERS.indexOf(place);
    const free = local - used.filter((u) => u < local).length;
    index = index * (7 - used.length) + free;
    used.push(local);
    twists = twists * 3 + (s.corners.orientation[place] as number);
  }
  return index * 27 + twists;
}

export type F2lTables = {
  puzzle: KPuzzle;
  moves: Full[];
  corner: Uint8Array;
  edge: Uint8Array;
};

let cached: F2lTables | undefined;
export function f2lTables(puzzle: KPuzzle): F2lTables {
  if (cached) return cached;
  const moves = movesOf(puzzle);
  cached = {
    puzzle,
    moves,
    corner: fill(CORNER_SIZE, [solved()], cornerIndex, moves),
    edge: fill(EDGE_SIZE, [solved()], edgeIndex, moves),
  };
  return cached;
}

function startOf(puzzle: KPuzzle, state: F2lState): Full {
  const data = placePair(puzzle.defaultPattern(), state)
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

/**
 * Every algorithm of the fewest turns (and up to `extra` more) that solves the slot from
 * `state` as it stands, up to `limit`. None begins or ends with U: a U before is the case's
 * AUF, and a U after changes nothing the slot needs.
 */
export function searchF2l(
  t: F2lTables,
  state: F2lState,
  options: { extra: number; limit: number; maxDepth?: number },
): string[] {
  const found: string[] = [];
  const path: number[] = [];
  const bound = (s: Full) =>
    Math.max(
      t.corner[cornerIndex(s)] as number,
      t.edge[edgeIndex(s)] as number,
    );
  const start = startOf(t.puzzle, state);
  let first = -1;
  const dfs = (s: Full, depth: number, lastFace: number): void => {
    if (found.length >= options.limit) return;
    const h = bound(s);
    if (h === 0 && depth === 0) {
      if (path.length > 0 && lastFace !== 1)
        found.push(path.map((m) => MOVES[m]).join(" "));
      return;
    }
    if (h > depth) return;
    for (let m = 0; m < MOVES.length; m++) {
      const face = Math.floor(m / 3);
      if (face === lastFace) continue;
      if (path.length === 0 && face === 1) continue;
      path.push(m);
      dfs(apply(s, t.moves[m] as Full), depth - 1, face);
      path.pop();
    }
  };
  for (let depth = 1; depth <= (options.maxDepth ?? 14); depth++) {
    if (first >= 0 && depth > first + options.extra) break;
    const before = found.length;
    dfs(start, depth, -1);
    if (found.length > before && first < 0) first = depth;
    if (found.length >= options.limit) break;
  }
  return found;
}
