import { cubeState, type Face } from "./cube";

/**
 * The shortest cross in face-turn metric (a quarter or half turn of an outer face is one
 * turn). The four cross edges of D are tracked alone: their places (12·11·10·9 orders)
 * and flips (2⁴), 190080 states packed into one integer. One breadth-first pass from the
 * solved cross gives every state's distance; a shortest answer walks down the distances.
 * Any other face is solved by turning the cube so that face is D, solving there and
 * naming the answer's turns in the scramble's frame again.
 */
export type CrossState = number;
export type CrossResult = { moves: string[]; length: number };

export const CROSS_STATES = 12 * 11 * 10 * 9 * 16;
const FACES: readonly Face[] = ["U", "L", "F", "R", "B", "D"];
const AMOUNTS = ["", "2", "'"] as const;
/** The 18 outer face turns: U U2 U' L L2 L' … D'. */
export const CROSS_MOVES: readonly string[] = FACES.flatMap((face) =>
  AMOUNTS.map((amount) => face + amount),
);

/**
 * The twelve edge places as two stickers each (face, row-major index on a 3×3 face), the
 * reference sticker first: U or D on the top and bottom layers, F or B in the middle one.
 * An edge is flipped when its reference colour is not on its place's reference sticker.
 * Order: UF UR UB UL DF DR DB DL FR FL BR BL.
 */
export const EDGE_PLACES: readonly (readonly [Face, number, Face, number])[] = [
  ["U", 7, "F", 1],
  ["U", 5, "R", 1],
  ["U", 1, "B", 1],
  ["U", 3, "L", 1],
  ["D", 1, "F", 7],
  ["D", 5, "R", 7],
  ["D", 7, "B", 7],
  ["D", 3, "L", 7],
  ["F", 5, "R", 3],
  ["F", 3, "L", 5],
  ["B", 3, "R", 5],
  ["B", 5, "L", 3],
];
/** D's cross edges among the places above: DF DR DB DL. */
const CROSS_EDGES = [4, 5, 6, 7] as const;

export type EdgeMove = { place: Int8Array; flip: Int8Array };

let edgeMoves: EdgeMove[] | undefined;
/**
 * Per face turn, where the edge on each place goes and whether it flips, read from our
 * own sticker model: turn a solved cube once and see which edge each place now holds.
 */
export function edgeMoveTables(): readonly EdgeMove[] {
  if (edgeMoves) return edgeMoves;
  const key = (a: Face, b: Face) => [a, b].sort().join("");
  const home = new Map(
    EDGE_PLACES.map(([a, , b], index) => [key(a, b), index]),
  );
  edgeMoves = CROSS_MOVES.map((move) => {
    const state = cubeState(3, move);
    const place = new Int8Array(12);
    const flip = new Int8Array(12);
    for (const [to, [a, i, b, j]] of EDGE_PLACES.entries()) {
      const first = state[a][i] as Face;
      const second = state[b][j] as Face;
      const from = home.get(key(first, second));
      if (from === undefined) throw new Error(`No edge ${first}${second}`);
      const reference = (EDGE_PLACES[from] as (typeof EDGE_PLACES)[number])[0];
      place[from] = to;
      flip[from] = first === reference ? 0 : 1;
    }
    return { place, flip };
  });
  return edgeMoves;
}

/**
 * The eight corner places as three stickers each, the U or D sticker first and the other
 * two clockwise round the corner. A corner's twist is which of its place's stickers holds
 * its U or D colour. Order: URF UFL ULB UBR DFR DLF DBL DRB.
 */
export const CORNER_PLACES: readonly (readonly [
  Face,
  number,
  Face,
  number,
  Face,
  number,
])[] = [
  ["U", 8, "R", 0, "F", 2],
  ["U", 6, "F", 0, "L", 2],
  ["U", 0, "L", 0, "B", 2],
  ["U", 2, "B", 0, "R", 2],
  ["D", 2, "F", 8, "R", 6],
  ["D", 0, "L", 8, "F", 6],
  ["D", 6, "B", 8, "L", 6],
  ["D", 8, "R", 8, "B", 6],
];

export type CornerMove = { place: Int8Array; twist: Int8Array };

let cornerMoves: CornerMove[] | undefined;
/** Per face turn, where the corner on each place goes and how far it twists. */
export function cornerMoveTables(): readonly CornerMove[] {
  if (cornerMoves) return cornerMoves;
  const key = (faces: Face[]) => [...faces].sort().join("");
  const home = new Map(
    CORNER_PLACES.map(([a, , b, , c], index) => [key([a, b, c]), index]),
  );
  cornerMoves = CROSS_MOVES.map((move) => {
    const state = cubeState(3, move);
    const place = new Int8Array(8);
    const twist = new Int8Array(8);
    for (const [to, [a, i, b, j, c, k]] of CORNER_PLACES.entries()) {
      const colours = [state[a][i], state[b][j], state[c][k]] as Face[];
      const from = home.get(key(colours));
      if (from === undefined) throw new Error(`No corner ${colours.join("")}`);
      place[from] = to;
      twist[from] = colours.findIndex(
        (colour) => colour === "U" || colour === "D",
      );
    }
    return { place, twist };
  });
  return cornerMoves;
}

/** Packs the places (0–11, distinct) and flips (0 or 1) of the four cross edges. */
export function encodeCross(
  places: readonly number[],
  flips: readonly number[],
): CrossState {
  let used = 0;
  let index = 0;
  for (let k = 0; k < 4; k++) {
    const place = places[k] as number;
    // Its rank among the places still free.
    let rank = 0;
    for (let p = 0; p < place; p++) if (!(used & (1 << p))) rank++;
    used |= 1 << place;
    index = index * (12 - k) + rank;
  }
  let bits = 0;
  for (let k = 0; k < 4; k++) bits = (bits << 1) | ((flips[k] as number) & 1);
  return index * 16 + bits;
}

export function decodeCross(state: CrossState): {
  places: number[];
  flips: number[];
} {
  const bits = state % 16;
  let index = Math.floor(state / 16);
  const ranks = [0, 0, 0, 0];
  for (let k = 3; k >= 0; k--) {
    const base = 12 - k;
    ranks[k] = index % base;
    index = Math.floor(index / base);
  }
  let used = 0;
  const places = ranks.map((rank) => {
    let place = 0;
    for (let seen = -1; ; place++) {
      if (!(used & (1 << place))) seen++;
      if (seen === rank) break;
    }
    used |= 1 << place;
    return place;
  });
  const flips = [3, 2, 1, 0].map((shift) => (bits >> shift) & 1);
  return { places, flips };
}

/** The cross state after one of the 18 face turns (an index into CROSS_MOVES). */
export function crossMove(state: CrossState, move: number): CrossState {
  const table = edgeMoveTables()[move] as EdgeMove;
  const { places, flips } = decodeCross(state);
  return encodeCross(
    places.map((place) => table.place[place] as number),
    flips.map((flip, k) => flip ^ (table.flip[places[k] as number] as number)),
  );
}

export const SOLVED_CROSS = encodeCross(CROSS_EDGES, [0, 0, 0, 0]);

let distances: Uint8Array | undefined;
/** Every cross state's distance from solved, built once on first use (about 190 kB). */
function crossTable(): Uint8Array {
  if (distances) return distances;
  const table = new Uint8Array(CROSS_STATES).fill(255);
  const queue = new Int32Array(CROSS_STATES);
  let head = 0;
  let tail = 0;
  table[SOLVED_CROSS] = 0;
  queue[tail++] = SOLVED_CROSS;
  while (head < tail) {
    const state = queue[head++] as number;
    const next = (table[state] as number) + 1;
    for (let move = 0; move < CROSS_MOVES.length; move++) {
      const neighbour = crossMove(state, move);
      if (table[neighbour] !== 255) continue;
      table[neighbour] = next;
      queue[tail++] = neighbour;
    }
  }
  distances = table;
  return table;
}

export function crossDistance(state: CrossState): number {
  return crossTable()[state] as number;
}

/**
 * Where each face goes when the cube is turned so that `face` is at the bottom: the turn
 * of face X in the scramble's frame is the turn of ROTATED[face][X] in the solving frame.
 */
const ROTATED: Record<Face, Record<Face, Face>> = {
  D: { U: "U", L: "L", F: "F", R: "R", B: "B", D: "D" },
  // x2
  U: { U: "D", L: "L", F: "B", R: "R", B: "F", D: "U" },
  // x'
  F: { U: "F", L: "L", F: "D", R: "R", B: "U", D: "B" },
  // x
  B: { U: "B", L: "L", F: "U", R: "R", B: "D", D: "F" },
  // z
  R: { U: "R", L: "U", F: "F", R: "D", B: "B", D: "L" },
  // z'
  L: { U: "L", L: "D", F: "F", R: "U", B: "B", D: "R" },
};

/**
 * With the cross face at the bottom, the cube turned about the vertical axis `quarter`
 * times more (y' each), so that slot `quarter` of FR FL BL BR stands at front right.
 */
const SPUN: readonly Record<Face, Face>[] = [
  { U: "U", L: "L", F: "F", R: "R", B: "B", D: "D" },
  // y'
  { U: "U", L: "F", F: "R", R: "B", B: "L", D: "D" },
  // y2
  { U: "U", L: "R", F: "B", R: "L", B: "F", D: "D" },
  // y
  { U: "U", L: "B", F: "L", R: "F", B: "R", D: "D" },
];

function frame(face: Face, quarter: number): Record<Face, Face> {
  const spin = SPUN[quarter] as Record<Face, Face>;
  const turn = ROTATED[face];
  return Object.fromEntries(
    FACES.map((side) => [side, spin[turn[side]]]),
  ) as Record<Face, Face>;
}

/**
 * The scramble's turns as indices into CROSS_MOVES, seen with `face` at the bottom (and,
 * for a slot, turned `quarter` times about the vertical axis).
 */
export function framedMoves(
  scramble: string,
  face: Face,
  quarter = 0,
): number[] {
  const turn = frame(face, quarter);
  return scramble
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const match = /^([ULFRBD])(2|'|2')?$/.exec(token);
      if (!match) throw new RangeError(`Not an outer face turn: ${token}`);
      const amount = match[2] === "2'" ? "2" : (match[2] ?? "");
      return CROSS_MOVES.indexOf(turn[match[1] as Face] + amount);
    });
}

/** A solving-frame turn named in the scramble's frame. */
export function unframedMove(move: number, face: Face, quarter = 0): string {
  const name = CROSS_MOVES[move] as string;
  const turn = frame(face, quarter);
  const original = FACES.find((side) => turn[side] === name[0]) as Face;
  return original + name.slice(1);
}

export function crossStateOf(scramble: string, face: Face): CrossState {
  return framedMoves(scramble, face).reduce(crossMove, SOLVED_CROSS);
}

/** A shortest set of turns that solves the cross on `face` after `scramble`. */
export function solveCross(scramble: string, face: Face): CrossResult {
  const table = crossTable();
  let state = crossStateOf(scramble, face);
  const moves: string[] = [];
  while (table[state] !== 0) {
    const distance = table[state] as number;
    for (let move = 0; move < CROSS_MOVES.length; move++) {
      const next = crossMove(state, move);
      if (table[next] === distance - 1) {
        moves.push(unframedMove(move, face));
        state = next;
        break;
      }
    }
  }
  return { moves, length: moves.length };
}

/**
 * The shortest cross on each face asked for (a face is its colour's name in the
 * scramble's orientation: U white), or null when the scramble has a turn other than the
 * 18 outer face turns. Every face reads the same table, turned to that face (`frame`), so
 * each colour's length is the white solver's on the cube turned whole.
 */
export function crossLengths(
  scramble: string,
  faces: readonly Face[],
): Partial<Record<Face, number>> | null {
  try {
    return Object.fromEntries(
      faces.map((face) => [face, crossDistance(crossStateOf(scramble, face))]),
    );
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}
