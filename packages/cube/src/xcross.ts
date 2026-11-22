import {
  CROSS_STATES,
  cornerMoveTables,
  crossDistance,
  decodeCross,
  edgeMoveTables,
  framedMoves,
  unframedMove,
} from "./cross";
import type { Face } from "./cube";

/**
 * The shortest xcross: the cross and one first-layer slot (its corner and middle-layer
 * edge) solved, in face-turn metric, over all four slots.
 *
 * Each slot is searched in a frame turned about the vertical axis so the slot stands at
 * front right; one set of tables then serves every slot and every cross face. Six pieces
 * are tracked, each as one of 24 values (place and flip or twist): the four cross edges,
 * the slot's edge and its corner. Three lower bounds are looked up in 24⁴ byte tables
 * (324 kB each), indexed straight from four piece values:
 * - the cross alone (task 25's exact table, re-indexed);
 * - DF, DR, the slot edge and the corner;
 * - DB, DL, the slot edge and the corner.
 * Their maximum never overestimates, so iterative deepening on the turn count with that
 * bound (IDA*) finds a shortest answer. All four slots are tried at one bound before
 * the bound grows, so the first answer is the shortest over all slots.
 */
export type XCrossResult = { moves: string[]; length: number; slot: number };
export type XCrossOptions = {
  /** The longest answer to look for; null past it. Default 20. */
  maxDepth?: number;
  /** Asked now and then; true stops the search with null. */
  cancelled?: () => boolean;
  /** Told each bound as the search reaches it (the answer is at least that long). */
  onBound?: (bound: number) => void;
};

/** The slots by name, in the frame where the cross face is at the bottom. */
export const XCROSS_SLOTS = ["FR", "FL", "BL", "BR"] as const;

const SIZE = 24 ** 4;
const UNSEEN = 255;
// Solved piece values: edge place × 2 + flip, corner place × 3 + twist.
const DF = 4 * 2;
const DR = 5 * 2;
const DB = 6 * 2;
const DL = 7 * 2;
const FR = 8 * 2;
const DFR = 4 * 3;

type Tables = {
  edge: Uint8Array;
  corner: Uint8Array;
  cross: Uint8Array;
  front: Uint8Array;
  back: Uint8Array;
};
let tables: Tables | undefined;

const index4 = (a: number, b: number, c: number, d: number) =>
  ((a * 24 + b) * 24 + c) * 24 + d;

/** A breadth-first distance table over four pieces from their solved values. */
function pieceTable(
  next: (slot: number, value: number, move: number) => number,
  solved: readonly [number, number, number, number],
): Uint8Array {
  const table = new Uint8Array(SIZE).fill(UNSEEN);
  const queue = new Int32Array(SIZE);
  let head = 0;
  let tail = 0;
  const start = index4(...solved);
  table[start] = 0;
  queue[tail++] = start;
  while (head < tail) {
    const state = queue[head++] as number;
    const d = state % 24;
    const c = Math.floor(state / 24) % 24;
    const b = Math.floor(state / 576) % 24;
    const a = Math.floor(state / 13_824);
    const distance = (table[state] as number) + 1;
    for (let move = 0; move < 18; move++) {
      const to = index4(
        next(0, a, move),
        next(1, b, move),
        next(2, c, move),
        next(3, d, move),
      );
      if (table[to] !== UNSEEN) continue;
      table[to] = distance;
      queue[tail++] = to;
    }
  }
  return table;
}

/** Builds the tables once, on first use (about 30 ms here, 1.3 MB). */
function xcrossTables(): Tables {
  if (tables) return tables;
  const edge = new Uint8Array(18 * 24);
  const corner = new Uint8Array(18 * 24);
  for (const [move, { place, flip }] of edgeMoveTables().entries())
    for (let value = 0; value < 24; value++) {
      const at = value >> 1;
      edge[move * 24 + value] =
        (place[at] as number) * 2 + (((value & 1) ^ (flip[at] as number)) & 1);
    }
  for (const [move, { place, twist }] of cornerMoveTables().entries())
    for (let value = 0; value < 24; value++) {
      const at = Math.floor(value / 3);
      corner[move * 24 + value] =
        (place[at] as number) * 3 + (((value % 3) + (twist[at] as number)) % 3);
    }
  // The exact cross distances, from task 25's packed coordinate.
  const cross = new Uint8Array(SIZE).fill(UNSEEN);
  for (let state = 0; state < CROSS_STATES; state++) {
    const { places, flips } = decodeCross(state);
    const [a, b, c, d] = places.map(
      (place, k) => place * 2 + (flips[k] as number),
    ) as [number, number, number, number];
    cross[index4(a, b, c, d)] = crossDistance(state);
  }
  const withCorner = (slot: number, value: number, move: number) =>
    slot === 3
      ? (corner[move * 24 + value] as number)
      : (edge[move * 24 + value] as number);
  tables = {
    edge,
    corner,
    cross,
    front: pieceTable(withCorner, [DF, DR, FR, DFR]),
    back: pieceTable(withCorner, [DB, DL, FR, DFR]),
  };
  return tables;
}

const FACE_OF = (move: number) => Math.floor(move / 3);
// Faces in CROSS_MOVES order: U L F R B D. Opposite pairs: U–D, L–R, F–B.
const OPPOSITE = [5, 3, 4, 1, 2, 0];

export function solveXCross(
  scramble: string,
  face: Face,
  options: XCrossOptions = {},
): XCrossResult | null {
  const { maxDepth = 20, cancelled, onBound } = options;
  if (cancelled?.()) return null;
  const { edge, corner, cross, front, back } = xcrossTables();

  // Each slot's frame: the scramble applied to the six tracked pieces.
  const starts = [0, 1, 2, 3].map((quarter) => {
    const pieces = [DF, DR, DB, DL, FR, DFR];
    for (const move of framedMoves(scramble, face, quarter)) {
      for (let k = 0; k < 5; k++)
        pieces[k] = edge[move * 24 + (pieces[k] as number)] as number;
      pieces[5] = corner[move * 24 + (pieces[5] as number)] as number;
    }
    return pieces;
  });

  const bound = (p: Int8Array | number[]) =>
    Math.max(
      cross[
        index4(p[0] as number, p[1] as number, p[2] as number, p[3] as number)
      ] as number,
      front[
        index4(p[0] as number, p[1] as number, p[4] as number, p[5] as number)
      ] as number,
      back[
        index4(p[2] as number, p[3] as number, p[4] as number, p[5] as number)
      ] as number,
    );

  const path = new Int8Array(32);
  let nodes = 0;
  let stopped = false;
  // pieces[depth] holds the six values at that depth.
  const stack = Array.from({ length: 32 }, () => new Int8Array(6));

  function search(depth: number, limit: number, last: number): boolean {
    const here = stack[depth] as Int8Array;
    const estimate = bound(here);
    if (estimate === 0) return true;
    if (depth + estimate > limit) return false;
    if ((++nodes & 4095) === 0 && cancelled?.()) {
      stopped = true;
      return false;
    }
    const there = stack[depth + 1] as Int8Array;
    for (let move = 0; move < 18; move++) {
      const turned = FACE_OF(move);
      if (last >= 0) {
        // Never the same face twice; two opposite faces only in one order.
        if (turned === last) continue;
        if (OPPOSITE[turned] === last && turned < last) continue;
      }
      const base = move * 24;
      there[0] = edge[base + (here[0] as number)] as number;
      there[1] = edge[base + (here[1] as number)] as number;
      there[2] = edge[base + (here[2] as number)] as number;
      there[3] = edge[base + (here[3] as number)] as number;
      there[4] = edge[base + (here[4] as number)] as number;
      there[5] = corner[base + (here[5] as number)] as number;
      path[depth] = move;
      if (search(depth + 1, limit, turned)) return true;
      if (stopped) return false;
    }
    return false;
  }

  const lowest = Math.min(...starts.map(bound));
  for (let limit = lowest; limit <= maxDepth; limit++) {
    onBound?.(limit);
    for (let quarter = 0; quarter < 4; quarter++) {
      (stack[0] as Int8Array).set(starts[quarter] as number[]);
      if (search(0, limit, -1)) {
        // The search stops at the first depth with the slot whole: that is `limit`.
        const moves: string[] = [];
        for (let depth = 0; depth < 32; depth++) {
          if (bound(stack[depth] as Int8Array) === 0) break;
          moves.push(unframedMove(path[depth] as number, face, quarter));
        }
        return { moves, length: moves.length, slot: quarter };
      }
      if (stopped) return null;
    }
    if (cancelled?.()) return null;
  }
  return null;
}
