/**
 * Arrows for a PLL picture: which top piece goes where, read from the picture itself
 * (the 21 letters of `diagram.ts`), so they are computed, never drawn by hand.
 *
 * Each piece's side stickers name its home: a corner showing the front and right colours
 * belongs at the front right. PLL is solved up to a U turn after the algorithm, so the
 * homes are taken after the U turn that leaves the most pieces where they are. A piece already home has no arrow; two pieces that
 * swap share one arrow with two heads.
 */
export type Arrow = {
  piece: "corner" | "edge";
  /** Top places, 0–8 row by row from the back left, as in the picture. */
  from: number;
  to: number;
  /** A swap: the arrow has a head at both ends. */
  both: boolean;
};

const RING = ["F", "R", "B", "L"];
/** Each corner place and the side stickers it shows, as faces. */
const CORNERS: readonly [number, readonly [number, string][]][] = [
  [
    0,
    [
      [17, "B"],
      [18, "L"],
    ],
  ],
  [
    2,
    [
      [15, "B"],
      [14, "R"],
    ],
  ],
  [
    6,
    [
      [9, "F"],
      [20, "L"],
    ],
  ],
  [
    8,
    [
      [11, "F"],
      [12, "R"],
    ],
  ],
];
const EDGES: readonly [number, number, string][] = [
  [1, 16, "B"],
  [3, 19, "L"],
  [5, 13, "R"],
  [7, 10, "F"],
];

/** How many pieces move in cycles of four. */
function longCycles(moves: readonly Arrow[]): number {
  const next = new Map(moves.map((m) => [`${m.piece}${m.from}`, m]));
  let count = 0;
  for (const m of moves) {
    let length = 1;
    let at = next.get(`${m.piece}${m.to}`);
    while (at && at !== m && length < 5) {
      length++;
      at = next.get(`${at.piece}${at.to}`);
    }
    if (length >= 4) count++;
  }
  return count;
}

const compare = (a: readonly number[], b: readonly number[]) => {
  for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
  return 0;
};

const shift = (face: string, k: number) =>
  RING[(RING.indexOf(face) + k) % 4] as string;

export function pllArrows(picture: string): Arrow[] {
  let best: { rank: number[]; moves: Arrow[]; places: string } | null = null;
  for (let k = 0; k < 4; k++) {
    const moves: Arrow[] = [];
    let fixed = 0;
    for (const [at, stickers] of CORNERS) {
      const faces = stickers.map(([i]) => shift(picture[i] as string, k));
      const home = CORNERS.find(([, s]) =>
        s.every(([, face]) => faces.includes(face)),
      )?.[0];
      if (home === undefined) return [];
      if (home === at) fixed++;
      else moves.push({ piece: "corner", from: at, to: home, both: false });
    }
    for (const [at, i] of EDGES) {
      const face = shift(picture[i] as string, k);
      const home = EDGES.find(([, , f]) => f === face)?.[0];
      if (home === undefined) return [];
      if (home === at) fixed++;
      else moves.push({ piece: "edge", from: at, to: home, both: false });
    }
    // A tie goes to the reading with no four-cycle (G: corners and edges each round
    // three, not a swap and all four edges), then to the one that keeps the corners (H,
    // Z), then by place, never by colour, so a recoloured picture keeps its arrows (N).
    const rank = [
      fixed,
      -longCycles(moves),
      moves.filter((m) => m.piece === "edge").length,
    ];
    const places = moves
      .map((m) => m.from)
      .sort((a, b) => a - b)
      .join();
    const better =
      !best ||
      compare(rank, best.rank) > 0 ||
      (compare(rank, best.rank) === 0 && places < best.places);
    if (better) best = { rank, moves, places };
  }
  // Swaps become one arrow with two heads.
  const out: Arrow[] = [];
  for (const m of best?.moves ?? []) {
    const back = best?.moves.find((n) => n.from === m.to && n.to === m.from);
    if (back) {
      if (m.from < m.to) out.push({ ...m, both: true });
    } else out.push(m);
  }
  return out;
}
