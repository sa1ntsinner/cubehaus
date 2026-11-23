/**
 * The cases of the front right slot in the first two layers: the cross and the other three
 * slots whole, the last layer anything, the slot's corner (piece DRF) and edge (piece FR)
 * on top or in the slot. Places are cubing's (corners UFR URB UBL ULF DRF DFL DLB DBR,
 * edges UF UR UB UL DF DR DB DL FR FL BR BL); a twist or flip is cubing's orientation of the
 * piece on its place.
 *
 * A case is a state counted up to a U turn. A U turn moves the four top places round one
 * step and changes no orientation, and corner place k sits between edge places k and k + 1,
 * so turning both by the same step is a U turn (the test checks it on cubing's cube). The key
 * is the state turned until the corner, or with the corner in the slot the edge, stands on
 * place 0. 24 cases with both on top, 6 with the edge in the slot, 6 with the corner in the
 * slot, 5 with both in the slot: 41.
 */
export type F2lState = {
  corner: number;
  twist: number;
  edge: number;
  flip: number;
};
/** Where the pair is: both on top, the edge in the slot, the corner in the slot, both in it. */
export type F2lGroup = "top" | "edge" | "corner" | "slot";
export type F2lCase = {
  id: string;
  key: string;
  label: string;
  group: F2lGroup;
};

export const PAIR_CORNER = 4;
export const PAIR_EDGE = 8;
const onTop = (place: number) => place < 4;

/** The state with its top places turned k steps. */
export function turnTop(state: F2lState, k: number): F2lState {
  const turn = (place: number) => (onTop(place) ? (place + k + 4) % 4 : place);
  return { ...state, corner: turn(state.corner), edge: turn(state.edge) };
}

/** The state after k U turns of the cube (a U turn takes each top place to the one before). */
export const f2lTurned = (state: F2lState, k: number) => turnTop(state, -k);

const keyOf = (s: F2lState) => `${s.corner}${s.twist}${s.edge}${s.flip}`;

/** The case key of a state, or null when the pair is solved. */
export function f2lKey(state: F2lState): string | null {
  if (state.corner === PAIR_CORNER && state.edge === PAIR_EDGE)
    return state.twist === 0 && state.flip === 0 ? null : keyOf(state);
  const lead = onTop(state.corner) ? state.corner : state.edge;
  return keyOf(turnTop(state, -lead));
}

export function f2lState(key: string): F2lState {
  if (!/^[0-4][0-2][0-38][01]$/.test(key))
    throw new RangeError(`No F2L key ${key}`);
  const [corner, twist, edge, flip] = [...key].map(Number) as [
    number,
    number,
    number,
    number,
  ];
  return { corner, twist, edge, flip };
}

export function groupOf(state: F2lState): F2lGroup {
  const corner = onTop(state.corner);
  const edge = onTop(state.edge);
  return corner && edge ? "top" : corner ? "edge" : edge ? "corner" : "slot";
}

const GROUPS: readonly F2lGroup[] = ["top", "edge", "corner", "slot"];

/** The 41 cases, ids `f2l-` and the key, labelled `F2L 1` to `F2L 41` in our own order. */
export const F2L_CASES: readonly F2lCase[] = (() => {
  const keys = new Set<string>();
  for (const corner of [0, 1, 2, 3, 4])
    for (const twist of [0, 1, 2])
      for (const edge of [0, 1, 2, 3, 8])
        for (const flip of [0, 1]) {
          const key = f2lKey({ corner, twist, edge, flip });
          if (key !== null) keys.add(key);
        }
  const sorted = [...keys].sort(
    (a, b) =>
      GROUPS.indexOf(groupOf(f2lState(a))) -
        GROUPS.indexOf(groupOf(f2lState(b))) || a.localeCompare(b),
  );
  return sorted.map((key, i) => ({
    id: `f2l-${key}`,
    key,
    label: `F2L ${i + 1}`,
    group: groupOf(f2lState(key)),
  }));
})();

/*
 * The picture: 27 letters, U 0–8 row by row from the back left, then F 9–17 and R 18–26
 * row by row from the top left as each is seen from outside; each letter is the face whose
 * colour the sticker has, `x` for a last-layer sticker that says nothing (grey).
 *
 * Sticker places of each cubing place, in the order of its orientation: a corner's U or D
 * sticker first, then clockwise as seen from outside; an edge's U or D sticker first, the
 * front right edge's F sticker first. -1 is a sticker the picture does not show.
 */
const CORNER_STICKERS: Record<number, readonly number[]> = {
  0: [8, 18, 11],
  1: [2, -1, 20],
  2: [0, -1, -1],
  3: [6, 9, -1],
  4: [-1, 17, 24],
};
const EDGE_STICKERS: Record<number, readonly number[]> = {
  0: [7, 10],
  1: [5, 19],
  2: [1, -1],
  3: [3, -1],
  8: [14, 21],
};
/** The pair's own colours in the same order: the corner D F R, the edge F R. */
const CORNER_COLOURS = ["D", "F", "R"] as const;
const EDGE_COLOURS = ["F", "R"] as const;

export function f2lStickers(state: F2lState): string {
  const out = [..."xxxxxxxxx", ..."xxxFFFFFF", ..."xxxRRRRRR"];
  // The slot's own places, which the pair fills or leaves to a last-layer piece.
  for (const at of [14, 17, 21, 24]) out[at] = "x";
  const corner = CORNER_STICKERS[state.corner] as readonly number[];
  for (let k = 0; k < 3; k++) {
    const at = corner[(k + state.twist) % 3] as number;
    if (at >= 0) out[at] = CORNER_COLOURS[k] as string;
  }
  const edge = EDGE_STICKERS[state.edge] as readonly number[];
  for (let k = 0; k < 2; k++) {
    const at = edge[(k + state.flip) % 2] as number;
    if (at >= 0) out[at] = EDGE_COLOURS[k] as string;
  }
  return out.join("");
}

/*
 * The front left slot: the same cases in a mirror through the M slice, so case n there is
 * case n here seen in the mirror, turn for turn. A left case is kept as the right case it
 * mirrors.
 */

/** Sides seen in the mirror: R and L trade places, the others stay. */
const MIRRORED: Record<string, string> = { R: "L", L: "R", r: "l", l: "r" };

/**
 * An algorithm seen in the mirror through the M slice. The mirror turns every turn the
 * other way, except those about the x axis: R and L trade places and turn the other way,
 * M and x keep their face and direction (R is L' there, M is M, U is U').
 */
export function mirrorAlg(alg: string): string {
  return alg
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((turn) => {
      const m = /^([RLUDFBrludfbMESxyz])(w?)(\d*)('?)$/.exec(turn);
      if (!m) throw new RangeError(`No turn ${turn}`);
      const [, face, wide, times, prime] = m as unknown as [
        string,
        string,
        string,
        string,
        string,
      ];
      const keeps = face === "M" || face === "x";
      const named = MIRRORED[face] ?? face;
      const double = times === "2";
      const back = keeps ? prime : prime ? "" : "'";
      return `${named}${wide}${times}${double ? "" : back}`;
    })
    .join(" ");
}

/**
 * A left case's picture: the right case's 27 letters with its R stickers now L. It is
 * drawn mirrored (seen from above the front left corner), so the third face is L and every
 * row reads the other way: place 18 + i shows L's sticker at row i / 3, column 2 - i % 3
 * as L is seen from outside, and the same column flip holds on U and F.
 */
export const f2lLeftStickers = (state: F2lState) =>
  f2lStickers(state).replaceAll("R", "L");
