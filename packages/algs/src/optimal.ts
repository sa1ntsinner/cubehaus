import type { KPuzzle } from "cubing/kpuzzle";

/**
 * Our own optimal search on the 3×3 in all six faces (R U F L D B, each a quarter or half
 * turn: the half-turn metric, no rotations, no slices), used by the algorithm review
 * (review-algs.test.ts). Iterative deepening with three admissible bounds, each a table
 * filled breadth first backwards from the goal: the eight corners (places and twists, 8! ·
 * 3⁷), and the twelve edges in two halves of six (places and flips, 12·11·10·9·8·7 · 2⁶).
 * Deepening one turn at a time, the first depth with a solution is the optimum; when a
 * search is stopped by its budget, every depth below the one it was on is proven empty.
 * Build and test time only: the tables take a few hundred megabytes and a minute or two.
 *
 * Places and twists are cubing's (corners UFR URB UBL ULF DRF DFL DLB DBR, edges UF UR UB
 * UL DF DR DB DL FR FL BR BL); a turn says for each place which place's piece comes to it
 * and how much it twists or flips on the way.
 */

export const FACES = ["U", "R", "F", "D", "L", "B"] as const;
export const MOVES18 = FACES.flatMap((f) => [f, `${f}2`, `${f}'`]);
/** The face each face must not follow when it is the opposite one, to count each pair once. */
const OPPOSITE = [3, 4, 5, 0, 1, 2];

type Perm = { pieces: number[]; orientation: number[] };
export type Cube = { corners: Perm; edges: Perm };

export function movesOf18(puzzle: KPuzzle): Cube[] {
  return MOVES18.map((m) => {
    const t = puzzle.moveToTransformation(m).transformationData;
    const c = t.CORNERS as unknown as {
      permutation: number[];
      orientationDelta: number[];
    };
    const e = t.EDGES as unknown as {
      permutation: number[];
      orientationDelta: number[];
    };
    return {
      corners: {
        pieces: [...c.permutation],
        orientation: [...c.orientationDelta],
      },
      edges: {
        pieces: [...e.permutation],
        orientation: [...e.orientationDelta],
      },
    };
  });
}

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320];

function rankPerm(p: readonly number[]): number {
  let rank = 0;
  for (let i = 0; i < p.length; i++) {
    let smaller = 0;
    for (let j = i + 1; j < p.length; j++)
      if ((p[j] as number) < (p[i] as number)) smaller++;
    rank += smaller * (FACT[p.length - 1 - i] as number);
  }
  return rank;
}

function unrankPerm(rank: number, n: number): number[] {
  const left = [...Array(n).keys()];
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const f = FACT[i] as number;
    out.push(left.splice(Math.floor(rank / f), 1)[0] as number);
    rank %= f;
  }
  return out;
}

export const CP = 40320;
export const CO = 2187;
export const EP = 665280;
const EF = 64;

/** Corner places' pieces as a rank. */
export const cpIndex = (c: Cube) => rankPerm(c.corners.pieces);
/** Twists of places 0–6 (the eighth follows). */
export function coIndex(c: Cube): number {
  let n = 0;
  for (let i = 0; i < 7; i++) n = n * 3 + (c.corners.orientation[i] as number);
  return n;
}

/** The places of six edge pieces (`first` to `first + 5`), in piece order, as a rank. */
export function epIndex(c: Cube, first: number): number {
  const used: number[] = [];
  let index = 0;
  for (let k = 0; k < 6; k++) {
    const place = c.edges.pieces.indexOf(first + k);
    const free = place - used.filter((u) => u < place).length;
    index = index * (12 - k) + free;
    used.push(place);
  }
  return index;
}

/** The flips of the same six pieces, in piece order. */
export function efIndex(c: Cube, first: number): number {
  let n = 0;
  for (let k = 0; k < 6; k++) {
    const place = c.edges.pieces.indexOf(first + k);
    n = n * 2 + (c.edges.orientation[place] as number);
  }
  return n;
}

function unrankPlaces(index: number): number[] {
  const digits: number[] = [];
  for (let k = 5; k >= 0; k--) {
    digits.unshift(index % (12 - k));
    index = Math.floor(index / (12 - k));
  }
  const used: number[] = [];
  return digits.map((d) => {
    let place = 0;
    let free = -1;
    for (; place < 12; place++) {
      if (!used.includes(place)) free++;
      if (free === d) break;
    }
    used.push(place);
    return place;
  });
}

export type MoveTables = {
  cp: Int32Array;
  co: Int16Array;
  ep: Int32Array;
  /** XOR of the six flips (piece order) a move adds, by the places before it. */
  ef: Uint8Array;
};

let cachedMoves: MoveTables | undefined;

export function moveTables(moves: readonly Cube[]): MoveTables {
  if (cachedMoves) return cachedMoves;
  const M = moves.length;
  const cp = new Int32Array(CP * M);
  for (let r = 0; r < CP; r++) {
    const p = unrankPerm(r, 8);
    moves.forEach((m, k) => {
      cp[r * M + k] = rankPerm(
        m.corners.pieces.map((from) => p[from] as number),
      );
    });
  }
  const co = new Int16Array(CO * M);
  for (let t = 0; t < CO; t++) {
    const o: number[] = [];
    let x = t;
    for (let i = 0; i < 7; i++) {
      o.unshift(x % 3);
      x = Math.floor(x / 3);
    }
    o.push((3 - (o.reduce((a, b) => a + b, 0) % 3)) % 3);
    moves.forEach((m, k) => {
      let n = 0;
      for (let i = 0; i < 7; i++)
        n =
          n * 3 +
          (((o[m.corners.pieces[i] as number] as number) +
            (m.corners.orientation[i] as number)) %
            3);
      co[t * M + k] = n;
    });
  }
  const ep = new Int32Array(EP * M);
  const ef = new Uint8Array(EP * M);
  const inverse = moves.map((m) => {
    const inv = new Array<number>(12);
    m.edges.pieces.forEach((from, to) => {
      inv[from] = to;
    });
    return inv;
  });
  for (let r = 0; r < EP; r++) {
    const places = unrankPlaces(r);
    moves.forEach((m, k) => {
      const inv = inverse[k] as number[];
      const next = places.map((p) => inv[p] as number);
      let index = 0;
      const used: number[] = [];
      let mask = 0;
      next.forEach((place, j) => {
        const free = place - used.filter((u) => u < place).length;
        index = index * (12 - j) + free;
        used.push(place);
        mask = mask * 2 + (m.edges.orientation[place] as number);
      });
      ep[r * M + k] = index;
      ef[r * M + k] = mask;
    });
  }
  cachedMoves = { cp, co, ep, ef };
  return cachedMoves;
}

/** Fills a distance table breadth first from its goal indices, layer by layer. */
function fillTable(
  size: number,
  goals: Iterable<number>,
  next: (index: number, move: number) => number,
): Uint8Array {
  const table = new Uint8Array(size).fill(255);
  let count = 0;
  for (const g of goals)
    if (table[g] === 255) {
      table[g] = 0;
      count++;
    }
  for (let depth = 0; count < size; depth++) {
    let added = 0;
    for (let i = 0; i < size; i++) {
      if (table[i] !== depth) continue;
      for (let m = 0; m < 18; m++) {
        const j = next(i, m);
        if (table[j] === 255) {
          table[j] = depth + 1;
          added++;
        }
      }
    }
    if (added === 0) break;
    count += added;
  }
  return table;
}

export type Goal = {
  /** A cube is at the goal. */
  holds: (c: Cube) => boolean;
  /** Goal cubes' corner indices, and each edge half's (first piece 0 and 6). */
  corners: Iterable<number>;
  edgesA: Iterable<number>;
  edgesB: Iterable<number>;
};

export type Bounds = {
  corner: Uint8Array;
  edgeA: Uint8Array;
  edgeB: Uint8Array;
};

export function boundsFor(t: MoveTables, goal: Goal): Bounds {
  const corner = fillTable(CP * CO, goal.corners, (i, m) => {
    const p = Math.floor(i / CO);
    const o = i % CO;
    return (t.cp[p * 18 + m] as number) * CO + (t.co[o * 18 + m] as number);
  });
  const edge = (goals: Iterable<number>) =>
    fillTable(EP * EF, goals, (i, m) => {
      const p = i >> 6;
      const f = i & 63;
      return (
        ((t.ep[p * 18 + m] as number) << 6) | (f ^ (t.ef[p * 18 + m] as number))
      );
    });
  return { corner, edgeA: edge(goal.edgesA), edgeB: edge(goal.edgesB) };
}

export function applyCube(s: Cube, t: Cube): Cube {
  const orbit = (a: Perm, b: Perm, n: number): Perm => ({
    pieces: b.pieces.map((from) => a.pieces[from] as number),
    orientation: b.pieces.map(
      (from, i) =>
        ((a.orientation[from] as number) + (b.orientation[i] as number)) % n,
    ),
  });
  return {
    corners: orbit(s.corners, t.corners, 3),
    edges: orbit(s.edges, t.edges, 2),
  };
}

export type Optimum = {
  /** The shortest found, or null when the budget ran out first. */
  alg: string | null;
  /** Every length below this is proven to have no solution. */
  provenAtLeast: number;
  nodes: number;
};

/**
 * The shortest algorithm in R U F L D B from any of `starts` (the case after each U turn
 * before) to the goal, up to `maxDepth`, within `budget` nodes. Two turns of one face never
 * follow each other, and of two opposite faces one order only.
 */
export function optimal(
  t: MoveTables,
  b: Bounds,
  moves: readonly Cube[],
  goal: Goal,
  starts: readonly Cube[],
  options: { maxDepth: number; budget: number },
): Optimum {
  let nodes = 0;
  const path: number[] = [];
  let found: string | null = null;
  const h = (
    cp: number,
    co: number,
    ea: number,
    fa: number,
    eb: number,
    fb: number,
  ) =>
    Math.max(
      b.corner[cp * CO + co] as number,
      b.edgeA[(ea << 6) | fa] as number,
      b.edgeB[(eb << 6) | fb] as number,
    );
  let start: Cube = starts[0] as Cube;
  const dfs = (
    cp: number,
    co: number,
    ea: number,
    fa: number,
    eb: number,
    fb: number,
    depth: number,
    last: number,
  ): boolean => {
    nodes++;
    if (nodes > options.budget) return false;
    const bound = h(cp, co, ea, fa, eb, fb);
    if (bound > depth) return false;
    if (depth === 0) {
      if (bound !== 0) return false;
      let c = start;
      for (const m of path) c = applyCube(c, moves[m] as Cube);
      if (!goal.holds(c)) return false;
      found = path.map((m) => MOVES18[m]).join(" ");
      return true;
    }
    for (let face = 0; face < 6; face++) {
      if (face === last) continue;
      if (last >= 0 && OPPOSITE[face] === last && face > last) continue;
      for (let q = 0; q < 3; q++) {
        const m = face * 3 + q;
        path.push(m);
        if (
          dfs(
            t.cp[cp * 18 + m] as number,
            t.co[co * 18 + m] as number,
            t.ep[ea * 18 + m] as number,
            fa ^ (t.ef[ea * 18 + m] as number),
            t.ep[eb * 18 + m] as number,
            fb ^ (t.ef[eb * 18 + m] as number),
            depth - 1,
            face,
          )
        )
          return true;
        path.pop();
      }
    }
    return false;
  };
  for (let depth = 0; depth <= options.maxDepth; depth++) {
    for (const s of starts) {
      start = s;
      path.length = 0;
      if (
        dfs(
          cpIndex(s),
          coIndex(s),
          epIndex(s, 0),
          efIndex(s, 0),
          epIndex(s, 6),
          efIndex(s, 6),
          depth,
          -1,
        )
      )
        return { alg: found, provenAtLeast: depth, nodes };
      if (nodes > options.budget)
        return { alg: null, provenAtLeast: depth, nodes };
    }
  }
  return { alg: null, provenAtLeast: options.maxDepth + 1, nodes };
}

/**
 * Every algorithm in the given faces (indices into FACES) from the first depth with one up
 * to `extra` turns more, up to `limit`, within `budget` nodes: the same deepening as
 * `optimal`, collecting instead of stopping. Each comes with the U turns before it.
 */
export function collect(
  t: MoveTables,
  b: Bounds,
  moves: readonly Cube[],
  goal: Goal,
  starts: readonly Cube[],
  options: {
    faces: readonly number[];
    maxDepth: number;
    extra: number;
    limit: number;
    budget: number;
  },
): {
  algs: { alg: string; auf: number }[];
  first: number | null;
  nodes: number;
} {
  let nodes = 0;
  const path: number[] = [];
  const out: { alg: string; auf: number }[] = [];
  let start = starts[0] as Cube;
  let auf = 0;
  const dfs = (
    cp: number,
    co: number,
    ea: number,
    fa: number,
    eb: number,
    fb: number,
    depth: number,
    last: number,
  ): void => {
    nodes++;
    if (nodes > options.budget || out.length >= options.limit) return;
    const bound = Math.max(
      b.corner[cp * CO + co] as number,
      b.edgeA[(ea << 6) | fa] as number,
      b.edgeB[(eb << 6) | fb] as number,
    );
    if (bound > depth) return;
    if (depth === 0) {
      if (bound !== 0) return;
      let c = start;
      for (const m of path) c = applyCube(c, moves[m] as Cube);
      // A U turn last is a turn after, which the goal leaves free.
      if (goal.holds(c) && Math.floor((path[path.length - 1] ?? 0) / 3) !== 0)
        out.push({ alg: path.map((m) => MOVES18[m]).join(" "), auf });
      return;
    }
    for (const face of options.faces) {
      if (face === last) continue;
      if (last >= 0 && OPPOSITE[face] === last && face > last) continue;
      // A U turn first is a turn before, which the starts already cover.
      if (path.length === 0 && face === 0) continue;
      for (let q = 0; q < 3; q++) {
        const m = face * 3 + q;
        path.push(m);
        dfs(
          t.cp[cp * 18 + m] as number,
          t.co[co * 18 + m] as number,
          t.ep[ea * 18 + m] as number,
          fa ^ (t.ef[ea * 18 + m] as number),
          t.ep[eb * 18 + m] as number,
          fb ^ (t.ef[eb * 18 + m] as number),
          depth - 1,
          face,
        );
        path.pop();
      }
    }
  };
  let first: number | null = null;
  for (let depth = 1; depth <= options.maxDepth; depth++) {
    if (first !== null && depth > first + options.extra) break;
    const before = out.length;
    starts.forEach((s, k) => {
      start = s;
      auf = k;
      path.length = 0;
      dfs(
        cpIndex(s),
        coIndex(s),
        epIndex(s, 0),
        efIndex(s, 0),
        epIndex(s, 6),
        efIndex(s, 6),
        depth,
        -1,
      );
    });
    if (first === null && out.length > before) first = depth;
    if (nodes > options.budget || out.length >= options.limit) break;
  }
  return { algs: out, first, nodes };
}
