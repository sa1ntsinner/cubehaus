import type { LastLayer } from "@cubehaus/scramble/last-layer-state";
import type { KPuzzle } from "cubing/kpuzzle";

/**
 * Our own search for last-layer algorithms in the turns R, U and F, used where memory of
 * the usual algorithms is unsure. Build time only: the tables take a few seconds to make.
 *
 * Iterative deepening with three admissible bounds, each a table filled backwards from
 * the goal: the seven corners R, U and F move (places and twists), the five first-two-layer
 * edges they move (places and flips), and the flips of the nine edges they move. A state
 * is at the goal when all three are: the first two layers whole, every edge oriented, and
 * the corners either all in place after some U turn (`corners: "solved"`, COLL) or only
 * twisted right (`corners: "oriented"`, OLL with a cross).
 *
 * Every algorithm it finds still goes through verify.ts like any written by hand.
 */

// cubing's places. Corners UFR URB UBL ULF DRF DFL DLB DBR; edges UF UR UB UL DF DR DB DL
// FR FL BR BL. R, U and F never move DLB (6) or DB, DL, BL (6, 7, 11).
const CORNERS = [0, 1, 2, 3, 4, 5, 7];
const EDGES = [0, 1, 2, 3, 4, 5, 8, 9, 10];
const F2L_EDGES = [4, 5, 8, 9, 10];
const FACES = ["R", "U", "F"] as const;
const POWERS = ["", "2", "'"] as const;
export const MOVES = FACES.flatMap((f) => POWERS.map((p) => f + p));

export type Perm = { pieces: number[]; orientation: number[] };
export type Full = { corners: Perm; edges: Perm };

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040];

function rankPerm(p: readonly number[]): number {
  let rank = 0;
  const n = p.length;
  for (let i = 0; i < n; i++) {
    let smaller = 0;
    for (let j = i + 1; j < n; j++)
      if ((p[j] as number) < (p[i] as number)) smaller++;
    rank += smaller * (FACT[n - 1 - i] as number);
  }
  return rank;
}

// Corner coordinate: the permutation of the seven movable corners among their places, and
// the twists of the first six (the seventh follows).
const CORNER_SIZE = 5040 * 729;
function cornerIndex(s: Full): number {
  const local = CORNERS.map((place) =>
    CORNERS.indexOf(s.corners.pieces[place] as number),
  );
  let twist = 0;
  for (let i = 0; i < 6; i++)
    twist = twist * 3 + (s.corners.orientation[CORNERS[i] as number] as number);
  return rankPerm(local) * 729 + twist;
}

// First-two-layer edge coordinate: where each of the five is among the nine places, and
// its flip.
export const EDGE_SIZE = 9 * 8 * 7 * 6 * 5 * 32;
export function edgeIndex(s: Full): number {
  let index = 0;
  const used: number[] = [];
  let flips = 0;
  for (const piece of F2L_EDGES) {
    const place = s.edges.pieces.indexOf(piece);
    const local = EDGES.indexOf(place);
    const free = local - used.filter((u) => u < local).length;
    index = index * (9 - used.length) + free;
    used.push(local);
    flips = flips * 2 + (s.edges.orientation[place] as number);
  }
  return index * 32 + flips;
}

// Flips of the nine movable edges.
const FLIP_SIZE = 512;
function flipIndex(s: Full): number {
  let index = 0;
  for (const place of EDGES)
    index = index * 2 + (s.edges.orientation[place] as number);
  return index;
}

export type Tables = {
  moves: Full[];
  corner: Uint8Array;
  edge: Uint8Array;
  flip: Uint8Array;
  goalCorners: "solved" | "oriented";
};

export function apply(s: Full, t: Full): Full {
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

export function solved(): Full {
  return {
    corners: { pieces: [...Array(8).keys()], orientation: Array(8).fill(0) },
    edges: { pieces: [...Array(12).keys()], orientation: Array(12).fill(0) },
  };
}

/** Fills a distance table by breadth-first search from the goal states. */
export function fill(
  size: number,
  starts: readonly Full[],
  index: (s: Full) => number,
  moves: readonly Full[],
): Uint8Array {
  const table = new Uint8Array(size).fill(255);
  let frontier: Full[] = [];
  for (const s of starts) {
    const i = index(s);
    if (table[i] === 255) {
      table[i] = 0;
      frontier.push(s);
    }
  }
  for (let depth = 1; frontier.length > 0; depth++) {
    const next: Full[] = [];
    for (const s of frontier)
      for (const m of moves) {
        const t = apply(s, m);
        const i = index(t);
        if (table[i] === 255) {
          table[i] = depth;
          next.push(t);
        }
      }
    frontier = next;
  }
  return table;
}

/**
 * The corner table, filled on coordinates: a move changes the seven corners' places and
 * their twists independently, so each has a small move table (5040 and 729 rows) and the
 * 3.7 million entries are filled from those.
 */
function fillCorners(
  starts: readonly Full[],
  moves: readonly Full[],
): Uint8Array {
  const local = moves.map((m) =>
    CORNERS.map((place) => CORNERS.indexOf(m.corners.pieces[place] as number)),
  );
  const delta = moves.map((m) =>
    CORNERS.map((place) => m.corners.orientation[place] as number),
  );
  const count = moves.length;
  const permMove = new Int32Array(5040 * count);
  const perms: number[][] = [];
  const build = (prefix: number[]) => {
    if (prefix.length === 7) perms.push(prefix);
    else
      for (let v = 0; v < 7; v++)
        if (!prefix.includes(v)) build([...prefix, v]);
  };
  build([]);
  for (const p of perms) {
    const r = rankPerm(p);
    for (let m = 0; m < count; m++)
      permMove[r * count + m] = rankPerm(
        (local[m] as number[]).map((from) => p[from] as number),
      );
  }
  const twistMove = new Int32Array(729 * count);
  for (let t = 0; t < 729; t++) {
    const ori: number[] = [];
    let x = t;
    for (let i = 0; i < 6; i++) {
      ori.unshift(x % 3);
      x = Math.floor(x / 3);
    }
    ori.push((3 - (ori.reduce((a, b) => a + b, 0) % 3)) % 3);
    for (let m = 0; m < count; m++) {
      let n = 0;
      for (let i = 0; i < 6; i++) {
        const from = (local[m] as number[])[i] as number;
        n =
          n * 3 +
          (((ori[from] as number) + ((delta[m] as number[])[i] as number)) % 3);
      }
      twistMove[t * count + m] = n;
    }
  }
  const table = new Uint8Array(CORNER_SIZE).fill(255);
  let frontier: number[] = [];
  for (const s of starts) {
    const i = cornerIndex(s);
    if (table[i] === 255) {
      table[i] = 0;
      frontier.push(i);
    }
  }
  for (let depth = 1; frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const index of frontier) {
      const r = Math.floor(index / 729);
      const t = index % 729;
      for (let m = 0; m < count; m++) {
        const n =
          (permMove[r * count + m] as number) * 729 +
          (twistMove[t * count + m] as number);
        if (table[n] === 255) {
          table[n] = depth;
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return table;
}

function goalCornerStates(kind: "solved" | "oriented"): Full[] {
  const out: Full[] = [];
  const perms: number[][] = [];
  const build = (prefix: number[]) => {
    if (prefix.length === 4) perms.push(prefix);
    else
      for (let p = 0; p < 4; p++)
        if (!prefix.includes(p)) build([...prefix, p]);
  };
  build([]);
  for (const p of perms) {
    const cyclic = [0, 1, 2, 3].some((k) =>
      p.every((v, i) => v === (i + k) % 4),
    );
    if (kind === "solved" && !cyclic) continue;
    const s = solved();
    s.corners.pieces = [...p, 4, 5, 6, 7];
    out.push(s);
  }
  return out;
}

/** R, U and F in their three powers, as cubing's transformations. */
export function movesOf(puzzle: KPuzzle): Full[] {
  return MOVES.map((m) => {
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

const cache = new Map<string, Tables>();

export function tables(
  puzzle: KPuzzle,
  goalCorners: "solved" | "oriented",
): Tables {
  const found = cache.get(goalCorners);
  if (found) return found;
  const moves = movesOf(puzzle);
  const built: Tables = {
    moves,
    corner: fillCorners(goalCornerStates(goalCorners), moves),
    edge: fill(EDGE_SIZE, [solved()], edgeIndex, moves),
    flip: fill(FLIP_SIZE, [solved()], flipIndex, moves),
    goalCorners,
  };
  cache.set(goalCorners, built);
  return built;
}

function startOf(top: LastLayer): Full {
  return {
    corners: {
      pieces: [...top.cp, 4, 5, 6, 7],
      orientation: [...top.co, 0, 0, 0, 0],
    },
    edges: {
      pieces: [...top.ep, 4, 5, 6, 7, 8, 9, 10, 11],
      orientation: [...top.eo, 0, 0, 0, 0, 0, 0, 0, 0],
    },
  };
}

/**
 * Every algorithm of the fewest turns (and up to `extra` more) that takes `top` to the
 * goal, up to `limit` of them. None begins or ends with U: a U there is an AUF.
 */
export function searchLL(
  t: Tables,
  top: LastLayer,
  options: { maxDepth: number; extra: number; limit: number },
): string[] {
  return searchFrom(t, startOf(top), options);
}

/**
 * searchLL from any state R, U and F reach: the same goal and bounds. With `startU` an
 * algorithm may begin with U (where the case is held fixed and no AUF comes before).
 */
export function searchFrom(
  t: Tables,
  start: Full,
  options: { maxDepth: number; extra: number; limit: number; startU?: boolean },
): string[] {
  const found: string[] = [];
  const path: number[] = [];
  const bound = (s: Full) =>
    Math.max(
      t.corner[cornerIndex(s)] as number,
      t.edge[edgeIndex(s)] as number,
      t.flip[flipIndex(s)] as number,
    );
  let first = -1;
  const dfs = (s: Full, depth: number, lastFace: number): void => {
    if (found.length >= options.limit) return;
    const h = bound(s);
    if (h === 0 && depth === 0) {
      const last = path[path.length - 1];
      if (path.length > 0 && Math.floor((last as number) / 3) !== 1)
        found.push(path.map((m) => MOVES[m]).join(" "));
      return;
    }
    if (h > depth) return;
    for (let m = 0; m < MOVES.length; m++) {
      const face = Math.floor(m / 3);
      if (face === lastFace) continue;
      if (path.length === 0 && face === 1 && !options.startU) continue;
      path.push(m);
      dfs(apply(s, t.moves[m] as Full), depth - 1, face);
      path.pop();
    }
  };
  for (let depth = 1; depth <= options.maxDepth; depth++) {
    if (first >= 0 && depth > first + options.extra) break;
    const before = found.length;
    dfs(start, depth, -1);
    if (found.length > before && first < 0) first = depth;
    if (found.length >= options.limit) break;
  }
  return found;
}
