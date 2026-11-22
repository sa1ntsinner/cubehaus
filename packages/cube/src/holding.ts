/**
 * How the person holds the cube while solving: the colour on top and the colour in
 * front, named by the faces the colours have when scrambling (WCA: white on top, green
 * in front). So `U` is white, `D` yellow, `F` green, `B` blue, `R` red, `L` orange, and
 * a holding is two letters, top then front: `UF` is the scrambling orientation, `DF`
 * yellow on top with green in front.
 *
 * Scrambles are always applied in the scrambling orientation. A drill that means the
 * faces as the person holds them (a last-layer case on their top) is renamed with
 * `renameTurns` so that, scrambled as usual, the case comes up where they solve it.
 */
export type FaceLetter = "U" | "D" | "F" | "B" | "R" | "L";

const VECTOR: Record<FaceLetter, readonly [number, number, number]> = {
  U: [0, 1, 0],
  D: [0, -1, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
  R: [1, 0, 0],
  L: [-1, 0, 0],
};
const LETTERS = Object.keys(VECTOR) as FaceLetter[];
const OPPOSITE: Record<FaceLetter, FaceLetter> = {
  U: "D",
  D: "U",
  F: "B",
  B: "F",
  R: "L",
  L: "R",
};

export const DEFAULT_HOLDING = "DF";

/** The colours that can be in front with `top` on top, in the order F, R, B, L of a turn. */
export function frontsFor(top: FaceLetter): FaceLetter[] {
  const ring: FaceLetter[] = ["F", "R", "B", "L", "U", "D"];
  return ring.filter((f) => f !== top && f !== OPPOSITE[top]);
}

/** All 24 holdings. */
export const HOLDINGS: readonly string[] = LETTERS.flatMap((top) =>
  frontsFor(top).map((front) => `${top}${front}`),
);

export function isHolding(value: unknown): value is string {
  return typeof value === "string" && HOLDINGS.includes(value);
}

const letterOf = (v: readonly number[]): FaceLetter =>
  LETTERS.find((l) => VECTOR[l].every((x, i) => x === v[i])) as FaceLetter;

/**
 * For each face as held (U is the top while solving), the face it is when scrambling,
 * which is also its colour's name.
 */
export function holdingFaces(holding: string): Record<FaceLetter, FaceLetter> {
  const h = isHolding(holding) ? holding : DEFAULT_HOLDING;
  const top = h[0] as FaceLetter;
  const front = h[1] as FaceLetter;
  const [a, b, c] = VECTOR[top];
  const [d, e, f] = VECTOR[front];
  const right = letterOf([b * f - c * e, c * d - a * f, a * e - b * d]);
  return {
    U: top,
    D: OPPOSITE[top],
    F: front,
    B: OPPOSITE[front],
    R: right,
    L: OPPOSITE[right],
  };
}

/**
 * The turns renamed face by face (`R` becomes the face held on the right). A rotation
 * keeps every turn's direction, so only the letter changes; wide turns keep their `w`.
 */
export function renameTurns(
  turns: string,
  faces: Record<FaceLetter, FaceLetter>,
): string {
  return turns
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((turn) => {
      const face = turn[0] as FaceLetter;
      if (!(face in faces)) throw new Error(`Cannot rename ${turn}`);
      return `${faces[face]}${turn.slice(1)}`;
    })
    .join(" ");
}
