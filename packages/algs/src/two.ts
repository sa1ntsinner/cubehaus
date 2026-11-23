/**
 * Our own model of the 2×2: eight corners, each a piece on a place with a twist. Places
 * 0–7 are URF UFL ULB UBR DFR DLF DBL DRB; a twist is 0 when the piece's U or D sticker
 * is on the U or D face, else 1 or 2 turning clockwise. A turn says, for each place, which
 * place's piece comes to it and how much it twists on the way. R, U and F never move the
 * DBL corner, so a state in those turns keeps it home: 7! · 3⁶ = 3 674 160 states, every
 * position of the puzzle once. Test and build time, and the pictures at run time.
 */
export type Two = {
  readonly cp: readonly number[];
  readonly co: readonly number[];
};

const TURNS: Record<string, { cp: number[]; co: number[] }> = {
  U: { cp: [3, 0, 1, 2, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0] },
  R: { cp: [4, 1, 2, 0, 7, 5, 6, 3], co: [2, 0, 0, 1, 1, 0, 0, 2] },
  F: { cp: [1, 5, 2, 3, 0, 4, 6, 7], co: [1, 2, 0, 0, 2, 1, 0, 0] },
  D: { cp: [0, 1, 2, 3, 5, 6, 7, 4], co: [0, 0, 0, 0, 0, 0, 0, 0] },
  L: { cp: [0, 2, 6, 3, 4, 1, 5, 7], co: [0, 1, 2, 0, 0, 2, 1, 0] },
  B: { cp: [0, 1, 3, 7, 4, 5, 2, 6], co: [0, 0, 1, 2, 0, 0, 2, 1] },
};

export const SOLVED: Two = {
  cp: [0, 1, 2, 3, 4, 5, 6, 7],
  co: [0, 0, 0, 0, 0, 0, 0, 0],
};

/** The state after one quarter turn of a face clockwise. */
function quarter(s: Two, face: string): Two {
  const t = TURNS[face];
  if (!t) throw new RangeError(`No 2×2 turn ${face}`);
  return {
    cp: t.cp.map((from) => s.cp[from] as number),
    co: t.cp.map(
      (from, i) => ((s.co[from] as number) + (t.co[i] as number)) % 3,
    ),
  };
}

/** The turns of a written algorithm: face letters with `'` or `2` (no rotations). */
export function parseTwo(alg: string): { face: string; quarters: number }[] {
  return alg
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const m = /^([URFDLB])(2|')?$/.exec(token);
      if (!m) throw new RangeError(`No 2×2 turn ${token}`);
      const quarters = m[2] === "2" ? 2 : m[2] === "'" ? 3 : 1;
      return { face: m[1] as string, quarters };
    });
}

export function applyTwo(s: Two, alg: string): Two {
  let out = s;
  for (const { face, quarters } of parseTwo(alg))
    for (let q = 0; q < quarters; q++) out = quarter(out, face);
  return out;
}

export function invertTwo(alg: string): string {
  return parseTwo(alg)
    .reverse()
    .map(
      ({ face, quarters }) =>
        `${face}${quarters === 2 ? "2" : quarters === 1 ? "'" : ""}`,
    )
    .join(" ");
}

export const sameTwo = (a: Two, b: Two) =>
  a.cp.every((p, i) => p === b.cp[i]) && a.co.every((o, i) => o === b.co[i]);

/** The state with its top turned `k` times (U^k after it). */
export const afterU = (s: Two, k: number) =>
  applyTwo(s, ["", "U", "U2", "U'"][((k % 4) + 4) % 4] as string);

/*
 * Stickers. Each place's three stickers, U or D first then clockwise as seen from
 * outside, as [face, row, column] on that face read the way our sticker model reads it
 * (packages/cube: U from the back left, D from the front left, a side from its top left
 * as seen from outside).
 */
type Facelet = readonly [string, number, number];
const FACELETS: readonly (readonly [Facelet, Facelet, Facelet])[] = [
  [
    ["U", 1, 1],
    ["R", 0, 0],
    ["F", 0, 1],
  ],
  [
    ["U", 1, 0],
    ["F", 0, 0],
    ["L", 0, 1],
  ],
  [
    ["U", 0, 0],
    ["L", 0, 0],
    ["B", 0, 1],
  ],
  [
    ["U", 0, 1],
    ["B", 0, 0],
    ["R", 0, 1],
  ],
  [
    ["D", 0, 1],
    ["F", 1, 1],
    ["R", 1, 0],
  ],
  [
    ["D", 0, 0],
    ["L", 1, 1],
    ["F", 1, 0],
  ],
  [
    ["D", 1, 0],
    ["B", 1, 1],
    ["L", 1, 0],
  ],
  [
    ["D", 1, 1],
    ["R", 1, 1],
    ["B", 1, 0],
  ],
];
/** A piece's colours in the same order: its home place's faces. */
const COLOURS = FACELETS.map((stickers) => stickers.map(([face]) => face));

/** Every face's four stickers, row by row as our sticker model reads them. */
export function facesOf(s: Two): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const face of "URFDLB") out[face] = ["", "", "", ""];
  for (let place = 0; place < 8; place++) {
    const piece = s.cp[place] as number;
    const twist = s.co[place] as number;
    for (let k = 0; k < 3; k++) {
      const [face, row, col] = (FACELETS[place] as readonly Facelet[])[
        k
      ] as Facelet;
      (out[face] as string[])[row * 2 + col] = (COLOURS[piece] as string[])[
        (k - twist + 3) % 3
      ] as string;
    }
  }
  return out;
}

/**
 * The picture of a 2×2 case: U's four stickers row by row from the back left, then the
 * top row of F, R, B and L, each as seen from outside (12 letters); with `bottom`, the
 * bottom row of F, R, B and L after them (20).
 */
export function twoStickers(s: Two, bottom = false): string {
  const f = facesOf(s);
  const top = (face: string) => (f[face] as string[]).slice(0, 2).join("");
  const low = (face: string) => (f[face] as string[]).slice(2, 4).join("");
  return [
    (f.U as string[]).join(""),
    ..."FRBL".split("").map(top),
    ...(bottom ? "FRBL".split("").map(low) : []),
  ].join("");
}
