/**
 * Where each sticker of cubing's 3×3 places sits on our own sticker model's faces
 * (packages/cube: each face read row by row from its top left as seen from outside, U from
 * the back left, D from the front left). A corner's stickers are listed in the order of
 * cubing's twist (its U or D sticker first, then clockwise as seen from outside), an edge's
 * as its name reads (its U or D sticker first, a middle-layer edge's F or B sticker first).
 * facelets.test.ts checks the table against the sticker model on random turns.
 */

export const CORNER_PLACES = [
  "UFR",
  "URB",
  "UBL",
  "ULF",
  "DRF",
  "DFL",
  "DLB",
  "DBR",
] as const;
export const EDGE_PLACES = [
  "UF",
  "UR",
  "UB",
  "UL",
  "DF",
  "DR",
  "DB",
  "DL",
  "FR",
  "FL",
  "BR",
  "BL",
] as const;

type Vec = [number, number, number];
const NORMAL: Record<string, Vec> = {
  R: [1, 0, 0],
  L: [-1, 0, 0],
  U: [0, 1, 0],
  D: [0, -1, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
};

/** A sticker: its face and its index (row · 3 + column) on that face. */
export type Facelet = { face: string; index: number };

function faceletOf(face: string, faces: readonly string[]): Facelet {
  // Cubie coordinates 1…3 along R, U and F; the missing axis is the middle.
  const at: Vec = [2, 2, 2];
  for (const f of faces) {
    const n = NORMAL[f] as Vec;
    for (let k = 0; k < 3; k++) if (n[k] !== 0) at[k] = n[k] === 1 ? 3 : 1;
  }
  const [x, y, z] = at;
  const [row, col] =
    face === "U"
      ? [z - 1, x - 1]
      : face === "D"
        ? [3 - z, x - 1]
        : face === "F"
          ? [3 - y, x - 1]
          : face === "B"
            ? [3 - y, 3 - x]
            : face === "R"
              ? [3 - y, 3 - z]
              : [3 - y, z - 1];
  return { face, index: row * 3 + col };
}

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** A corner's three faces, U or D first, then clockwise as seen from outside. */
function cornerFaces(name: string): string[] {
  const faces = [...name];
  const first = faces.find((f) => f === "U" || f === "D") as string;
  const [a, b] = faces.filter((f) => f !== first) as [string, string];
  const [p, q, r] = [first, a, b].map((f) => NORMAL[f] as Vec) as [
    Vec,
    Vec,
    Vec,
  ];
  const out: Vec = [p[0] + q[0] + r[0], p[1] + q[1] + r[1], p[2] + q[2] + r[2]];
  // Clockwise from outside: (first × next) points away from the viewer.
  return dot(cross(NORMAL[first] as Vec, NORMAL[a] as Vec), out) < 0
    ? [first, a, b]
    : [first, b, a];
}

export const CORNER_FACES: readonly (readonly string[])[] =
  CORNER_PLACES.map(cornerFaces);
export const EDGE_FACES: readonly (readonly string[])[] = EDGE_PLACES.map(
  (name) => [...name],
);

export const CORNER_FACELETS: readonly (readonly Facelet[])[] =
  CORNER_FACES.map((faces) => faces.map((f) => faceletOf(f, faces)));
export const EDGE_FACELETS: readonly (readonly Facelet[])[] = EDGE_FACES.map(
  (faces) => faces.map((f) => faceletOf(f, faces)),
);

type Orbit = { pieces: readonly number[]; orientation: readonly number[] };

/**
 * Every sticker of a cubing pattern (centres home) as our model's faces: for each place,
 * the colour of the piece there at each of its stickers. A piece with twist t shows at
 * sticker k the colour of its own sticker k − t.
 */
export function faceColours(
  corners: Orbit,
  edges: Orbit,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of "ULFRBD") out[f] = Array(9).fill(f);
  const paint = (
    orbit: Orbit,
    facelets: readonly (readonly Facelet[])[],
    faces: readonly (readonly string[])[],
    n: number,
  ) =>
    orbit.pieces.forEach((piece, place) => {
      const o = orbit.orientation[place] as number;
      (facelets[place] as readonly Facelet[]).forEach((at, k) => {
        (out[at.face] as string[])[at.index] = (faces[piece] as string[])[
          (k - o + n) % n
        ] as string;
      });
    });
  paint(corners, CORNER_FACELETS, CORNER_FACES, 3);
  paint(edges, EDGE_FACELETS, EDGE_FACES, 2);
  return out;
}

/**
 * Whether a corner and an edge are joined: the edge touches the corner (its faces are two
 * of the corner's) and on each face they share both show the same colour. `corner` and
 * `edge` are places with a twist and a flip; the colours are the pieces' own.
 */
export function joinedAt(
  corner: { place: number; twist: number; piece: number },
  edge: { place: number; flip: number; piece: number },
): boolean {
  const cf = CORNER_FACES[corner.place] as readonly string[];
  const ef = EDGE_FACES[edge.place] as readonly string[];
  if (!ef.every((f) => cf.includes(f))) return false;
  const colourC = (face: string) =>
    (CORNER_FACES[corner.piece] as readonly string[])[
      (cf.indexOf(face) - corner.twist + 3) % 3
    ];
  const colourE = (face: string) =>
    (EDGE_FACES[edge.piece] as readonly string[])[
      (ef.indexOf(face) - edge.flip + 2) % 2
    ];
  return ef.every((f) => colourC(f) === colourE(f));
}

/** Which piece shows each sticker: `c` and the corner's piece, `e` and the edge's, or null for a centre. */
export function faceletPieces(
  corners: Orbit,
  edges: Orbit,
): Record<string, (string | null)[]> {
  const out: Record<string, (string | null)[]> = {};
  for (const f of "ULFRBD") out[f] = Array(9).fill(null);
  corners.pieces.forEach((piece, place) => {
    for (const at of CORNER_FACELETS[place] as readonly Facelet[])
      (out[at.face] as (string | null)[])[at.index] = `c${piece}`;
  });
  edges.pieces.forEach((piece, place) => {
    for (const at of EDGE_FACELETS[place] as readonly Facelet[])
      (out[at.face] as (string | null)[])[at.index] = `e${piece}`;
  });
  return out;
}
