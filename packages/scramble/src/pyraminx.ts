// Pyraminx scrambles of exactly 11 main moves, as the official program
// writes them. The library gives a random state solved in as few moves as
// possible (7 to 11); this finds a sequence of exactly 11 moves of U L R B,
// no two in a row on one vertex, that reaches the same state, and keeps the
// library's tip moves.
//
// The state without tips is the six edges (where each is and how it is
// flipped) and the four centres under the tips (how each is turned):
// 933,120 states reachable. A table of the distance of every state from
// solved, built once by breadth-first search, lets a depth-first search keep
// only paths that can still end solved in the moves left.

export interface OrbitMove {
  permutation: readonly number[];
  orientationDelta: readonly number[];
}
export interface PyraminxMove {
  EDGES: OrbitMove;
  CORNERS: OrbitMove;
}
export type PyraminxMoves = Record<"U" | "L" | "R" | "B", PyraminxMove>;

const faces = ["U", "L", "R", "B"] as const;
const LENGTH = 11;
const PERMS = 720; // 6!
const FLIPS = 64; // 2^6, half of them reachable
const TWISTS = 81; // 3^4
const SIZE = PERMS * FLIPS * TWISTS;
const UNSEEN = 255;

function permIndex(pieces: readonly number[]): number {
  let index = 0;
  for (let i = 0; i < 6; i++) {
    let smaller = 0;
    for (let j = i + 1; j < 6; j++)
      if ((pieces[j] as number) < (pieces[i] as number)) smaller++;
    index = index * (6 - i) + smaller;
  }
  return index;
}

function permOf(index: number): number[] {
  const digits: number[] = [];
  for (let i = 5; i >= 0; i--) {
    digits.unshift(index % (6 - i));
    index = Math.floor(index / (6 - i));
  }
  const left = [0, 1, 2, 3, 4, 5];
  return digits.map((d) => left.splice(d, 1)[0] as number);
}

function digitsOf(index: number, base: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(index % base);
    index = Math.floor(index / base);
  }
  return out;
}

function indexOf(digits: readonly number[], base: number): number {
  let index = 0;
  for (let i = digits.length - 1; i >= 0; i--)
    index = index * base + (digits[i] as number);
  return index;
}

export interface PyraminxSolver {
  // Main moves only (U L R B, with '), as written by the library.
  stateOf(moves: string): number;
  // Exactly 11 moves reaching that state, written as a scramble.
  elevenMoves(state: number): string;
  distance(state: number): number;
  // How many states the table reached, and the farthest one's distance.
  census(): { states: number; deepest: number };
}

export function createPyraminxSolver(moves: PyraminxMoves): PyraminxSolver {
  // Move tables: 8 moves, each face clockwise then anticlockwise.
  const permMove = new Uint16Array(PERMS * 8);
  const flipMove = new Uint8Array(FLIPS * 8);
  const twistMove = new Uint8Array(TWISTS * 8);
  faces.forEach((face, f) => {
    const { EDGES, CORNERS } = moves[face];
    for (let power = 1; power <= 2; power++) {
      const m = f * 2 + power - 1;
      for (let p = 0; p < PERMS; p++) {
        let pieces = permOf(p);
        for (let k = 0; k < power; k++)
          pieces = EDGES.permutation.map((from) => pieces[from] as number);
        permMove[p * 8 + m] = permIndex(pieces);
      }
      for (let e = 0; e < FLIPS; e++) {
        let flips = digitsOf(e, 2, 6);
        for (let k = 0; k < power; k++)
          flips = EDGES.permutation.map(
            (from, i) =>
              ((flips[from] as number) +
                (EDGES.orientationDelta[i] as number)) %
              2,
          );
        flipMove[e * 8 + m] = indexOf(flips, 2);
      }
      for (let c = 0; c < TWISTS; c++) {
        let twists = digitsOf(c, 3, 4);
        for (let k = 0; k < power; k++)
          twists = CORNERS.permutation.map(
            (from, i) =>
              ((twists[from] as number) +
                (CORNERS.orientationDelta[i] as number)) %
              3,
          );
        twistMove[c * 8 + m] = indexOf(twists, 3);
      }
    }
  });

  const apply = (state: number, m: number) => {
    const c = state % TWISTS;
    const rest = (state - c) / TWISTS;
    const e = rest % FLIPS;
    const p = (rest - e) / FLIPS;
    return (
      ((permMove[p * 8 + m] as number) * FLIPS +
        (flipMove[e * 8 + m] as number)) *
        TWISTS +
      (twistMove[c * 8 + m] as number)
    );
  };

  const solved = 0; // identity permutation, nothing flipped or turned
  const distance = new Uint8Array(SIZE).fill(UNSEEN);
  distance[solved] = 0;
  let frontier = [solved];
  for (let depth = 0; frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const state of frontier)
      for (let m = 0; m < 8; m++) {
        const to = apply(state, m);
        if (distance[to] === UNSEEN) {
          distance[to] = depth + 1;
          next.push(to);
        }
      }
    frontier = next;
  }

  const name = (m: number) => faces[m >> 1] + (m & 1 ? "'" : "");

  return {
    distance: (state) => distance[state] as number,
    census() {
      let states = 0;
      let deepest = 0;
      for (const d of distance)
        if (d !== UNSEEN) {
          states++;
          deepest = Math.max(deepest, d);
        }
      return { states, deepest };
    },
    stateOf(text) {
      let state = solved;
      for (const token of text.split(/\s+/).filter(Boolean)) {
        const f = faces.indexOf(token[0] as (typeof faces)[number]);
        if (f < 0 || !/^[ULRB]'?$/.test(token))
          throw new RangeError(`Not a Pyraminx main move: ${token}`);
        state = apply(state, f * 2 + (token.endsWith("'") ? 1 : 0));
      }
      return state;
    },
    elevenMoves(target) {
      // Search from the target back to solved in exactly 11 moves; the
      // scramble is that path undone, so it reaches the target from solved.
      const path: number[] = [];
      const search = (
        state: number,
        left: number,
        lastFace: number,
      ): boolean => {
        if (left === 0) return state === solved;
        if ((distance[state] as number) > left) return false;
        for (let m = 0; m < 8; m++) {
          if (m >> 1 === lastFace) continue;
          path.push(m);
          if (search(apply(state, m), left - 1, m >> 1)) return true;
          path.pop();
        }
        return false;
      };
      if (!search(target, LENGTH, -1))
        throw new RangeError("No 11-move sequence reaches this state");
      return path
        .reverse()
        .map((m) => name(m ^ 1))
        .join(" ");
    },
  };
}

// Split a library Pyraminx scramble into its main moves and its tip moves.
export function splitPyraminx(scramble: string): {
  main: string;
  tips: string;
} {
  const tokens = scramble.split(/\s+/).filter(Boolean);
  return {
    main: tokens.filter((t) => /^[ULRB]/.test(t)).join(" "),
    tips: tokens.filter((t) => /^[ulrb]/.test(t)).join(" "),
  };
}
