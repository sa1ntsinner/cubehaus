/**
 * How the trainer shows a case and its algorithm: the algorithm split into the short
 * finger patterns cubers learn as one move (triggers), a picture turned and recoloured at
 * random so the case is recognised from any side, and a scramble turned the same way.
 */

/** Finger patterns, longest first, matched from the left. */
const TRIGGERS = [
  "R U R' U'",
  "U R U' R'",
  "R' F R F'",
  "F R' F' R",
  "R U2 R'",
  "R' U2 R",
  "R U R'",
  "R U' R'",
  "R' U R",
  "R' U' R",
  "L' U' L",
  "L U L'",
  "L' U L",
  "L U' L'",
].map((t) => t.split(" "));

/** The algorithm's moves in groups: each trigger a group, the moves between them another. */
export function groupMoves(alg: string): string[][] {
  const moves = alg.trim().split(/\s+/).filter(Boolean);
  const groups: string[][] = [];
  let loose: string[] = [];
  for (let i = 0; i < moves.length; ) {
    const found = TRIGGERS.find((t) => t.every((m, k) => moves[i + k] === m));
    if (found) {
      if (loose.length) groups.push(loose);
      loose = [];
      groups.push(found);
      i += found.length;
    } else {
      loose.push(moves[i] as string);
      i++;
    }
  }
  if (loose.length) groups.push(loose);
  return groups;
}

/** The groups, each marked when it is a finger trigger (so it stays on one line). */
export function algGroups(
  alg: string,
): { moves: string[]; trigger: boolean }[] {
  return groupMoves(alg).map((moves) => ({
    moves,
    trigger: TRIGGERS.some(
      (t) => t.length === moves.length && t.every((m, k) => moves[k] === m),
    ),
  }));
}

/** The side faces in the order a y turn carries them. */
const RING = ["F", "L", "B", "R"];

/**
 * The picture as seen with the cube turned `k` quarter turns about its top: the side
 * colours move round, so the same case shows other colours in front.
 */
export function recolour(picture: string, k: number): string {
  const n = ((k % 4) + 4) % 4;
  return [...picture]
    .map((c) => {
      const at = RING.indexOf(c);
      return at < 0 ? c : (RING[(at + n) % 4] as string);
    })
    .join("");
}

/**
 * The scramble for the cube held with another side in front (a y turn, `k` times): every
 * side turn is renamed round the ring, so the same case comes up with other colours.
 */
export function turnScramble(scramble: string, k: number): string {
  const n = ((k % 4) + 4) % 4;
  return scramble
    .trim()
    .split(/\s+/)
    .map((move) => {
      const at = RING.indexOf(move[0] as string);
      return at < 0 ? move : `${RING[(at + n) % 4]}${move.slice(1)}`;
    })
    .join(" ");
}
