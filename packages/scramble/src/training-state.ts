/**
 * Whole 3×3 states with some pieces fixed and the rest drawn at random, in cubing's own
 * piece order (edges UF UR UB UL DF DR DB DL FR FL BR BL, corners UFR URB UBL ULF DRF DFL
 * DLB DBR): `pieces[i]` is the piece on place i, `orientation[i]` its flip or twist there.
 * Centres never move.
 */
export type Orbit = { pieces: number[]; orientation: number[] };
export type CubeLayout = { edges: Orbit; corners: Orbit };

/** A place given in advance: which piece stands there, and its flip or twist. */
export type Fixed = ReadonlyMap<number, { piece: number; orientation: number }>;

function shuffle(values: number[], rng: () => number): number[] {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [values[i], values[j]] = [values[j] as number, values[i] as number];
  }
  return values;
}

function parity(pieces: readonly number[]): number {
  let odd = 0;
  const seen = new Set<number>();
  for (let start = 0; start < pieces.length; start++) {
    if (seen.has(start)) continue;
    let length = 0;
    for (let at = start; !seen.has(at); at = pieces[at] as number) {
      seen.add(at);
      length++;
    }
    odd ^= (length - 1) & 1;
  }
  return odd;
}

function fill(
  size: number,
  modulus: number,
  fixed: Fixed,
  rng: () => number,
): { orbit: Orbit; free: number[] } {
  const pieces = Array<number>(size).fill(-1);
  const orientation = Array<number>(size).fill(0);
  const used = new Set<number>();
  for (const [place, { piece, orientation: turn }] of fixed) {
    pieces[place] = piece;
    orientation[place] = turn;
    used.add(piece);
  }
  const free = [...pieces.keys()].filter((place) => pieces[place] === -1);
  const left = shuffle(
    [...Array(size).keys()].filter((piece) => !used.has(piece)),
    rng,
  );
  for (const [k, place] of free.entries()) {
    pieces[place] = left[k] as number;
    orientation[place] = Math.floor(rng() * modulus);
  }
  // The flips or twists add up to a whole turn: the last free place balances them.
  const last = free.at(-1);
  if (last !== undefined) {
    const others = orientation.reduce(
      (sum, value, place) => (place === last ? sum : sum + value),
      0,
    );
    orientation[last] = (modulus - (others % modulus)) % modulus;
  }
  return { orbit: { pieces, orientation }, free };
}

/**
 * A uniformly random legal state among those with the given places fixed: the free
 * pieces in random order (the two parities made equal by swapping two free edges, or two
 * free corners when no two edges are free), random flips and twists balanced on the last
 * free place.
 */
export function randomLayout(
  fixedEdges: Fixed,
  fixedCorners: Fixed,
  rng: () => number,
): CubeLayout {
  const edges = fill(12, 2, fixedEdges, rng);
  const corners = fill(8, 3, fixedCorners, rng);
  if (parity(edges.orbit.pieces) !== parity(corners.orbit.pieces)) {
    const [orbit, free] =
      edges.free.length >= 2
        ? [edges.orbit, edges.free]
        : [corners.orbit, corners.free];
    const [a, b] = free as [number, number];
    if (b === undefined) throw new Error("No two free pieces to fix parity");
    [orbit.pieces[a], orbit.pieces[b]] = [
      orbit.pieces[b] as number,
      orbit.pieces[a] as number,
    ];
  }
  return { edges: edges.orbit, corners: corners.orbit };
}

/** Every place of an orbit at home. */
export function homes(size: number, except: readonly number[] = []): Fixed {
  return new Map(
    [...Array(size).keys()]
      .filter((place) => !except.includes(place))
      .map((place) => [place, { piece: place, orientation: 0 }]),
  );
}

export const isSolved = (orbit: Orbit) =>
  orbit.pieces.every((piece, place) => piece === place) &&
  orbit.orientation.every((turn) => turn === 0);
