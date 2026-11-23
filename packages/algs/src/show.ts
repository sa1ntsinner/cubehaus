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

export type AlgPiece = {
  moves: string[];
  trigger: boolean;
  /** Goes on from the piece before it, in the same run of moves: no group gap. */
  cont?: boolean;
};

/** The longest run of loose moves kept on one line before it is cut. */
const LONGEST = 4;

/**
 * Where an algorithm may break across lines: units that each stay on one line. Every
 * trigger is a unit; a run of moves between triggers longer than four is cut into even
 * pieces; and a unit of a single move joins its shorter neighbour (the one after it on a
 * tie), so no line ever starts or ends with one move standing alone.
 */
export function algUnits(alg: string): AlgPiece[][] {
  const units: AlgPiece[][] = [];
  for (const group of algGroups(alg)) {
    const n = group.moves.length;
    if (group.trigger || n <= LONGEST) {
      units.push([group]);
      continue;
    }
    const parts = Math.ceil(n / LONGEST);
    let at = 0;
    for (let k = 0; k < parts; k++) {
      const size = Math.ceil((n - at) / (parts - k));
      units.push([
        {
          moves: group.moves.slice(at, at + size),
          trigger: false,
          ...(k > 0 ? { cont: true } : {}),
        },
      ]);
      at += size;
    }
  }
  const size = (u: AlgPiece[]) => u.reduce((sum, g) => sum + g.moves.length, 0);
  for (let i = 0; i < units.length && units.length > 1; ) {
    if (size(units[i] as AlgPiece[]) > 1) {
      i++;
      continue;
    }
    const before = units[i - 1];
    const after = units[i + 1];
    const intoBefore =
      before !== undefined &&
      (after === undefined || size(before) < size(after));
    if (intoBefore) {
      before.push(...(units[i] as AlgPiece[]));
      units.splice(i, 1);
    } else {
      (after as AlgPiece[]).unshift(...(units[i] as AlgPiece[]));
      units.splice(i, 1);
    }
    i = Math.max(0, i - 1);
  }
  return units;
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
