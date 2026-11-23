import { KPattern, type KPuzzle } from "cubing/kpuzzle";

/**
 * Last-slot cases on cubing's cube: the last F2L pair joined on top where a three-turn
 * insert puts it in the front right slot (R U' R' or F' U F), every last-layer edge
 * oriented. A member is a last layer X (first two layers whole, edges oriented) with the
 * insert undone after it; a case is X's four top twists (cubing's places UFR URB UBL ULF),
 * not all zero: 26 a set. Case ids are the set and the twists (`ls-right-1011`).
 */

export type LastSlotSet = "ls-right" | "ls-front";

export const LAST_SLOT: Record<LastSlotSet, { insert: string; undo: string }> =
  {
    "ls-right": { insert: "R U' R'", undo: "R U R'" },
    "ls-front": { insert: "F' U F", undo: "F' U' F" },
  };

/** The 26 case keys: twists of the top places UFR URB UBL ULF, not all zero. */
export const LAST_SLOT_KEYS: readonly string[] = (() => {
  const out: string[] = [];
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 3; b++)
      for (let c = 0; c < 3; c++) {
        const key = `${a}${b}${c}${(6 - a - b - c) % 3}`;
        if (key !== "0000") out.push(key);
      }
  return out;
})();

type Orbit = { pieces: number[]; orientation: number[] };
type Data = { CORNERS: Orbit; EDGES: Orbit };
const dataOf = (p: KPattern) => p.patternData as unknown as Data;

/** A last layer with these top twists, the pieces where `cp` and `ep` put them. */
export function lastLayerPattern(
  puzzle: KPuzzle,
  key: string,
  cp: readonly number[] = [0, 1, 2, 3],
  ep: readonly number[] = [0, 1, 2, 3],
): KPattern {
  const solved = puzzle.defaultPattern().patternData;
  return new KPattern(puzzle, {
    ...solved,
    CORNERS: {
      pieces: [...cp, 4, 5, 6, 7],
      orientation: [...[...key].map(Number), 0, 0, 0, 0],
    },
    EDGES: {
      pieces: [...ep, 4, 5, 6, 7, 8, 9, 10, 11],
      orientation: Array(12).fill(0),
    },
  });
}

/** The case's member with the last layer's pieces in place. */
export function lastSlotMember(
  puzzle: KPuzzle,
  set: LastSlotSet,
  key: string,
): KPattern {
  return lastLayerPattern(puzzle, key).applyAlg(LAST_SLOT[set].undo);
}

const home = (o: Orbit, place: number) =>
  o.pieces[place] === place && o.orientation[place] === 0;

/** The case of a cube in the set's position (the insert then leaves a last layer), or null. */
export function lastSlotKey(
  set: LastSlotSet,
  pattern: KPattern,
): string | null {
  const after = dataOf(pattern.applyAlg(LAST_SLOT[set].insert));
  if (![4, 5, 6, 7].every((p) => home(after.CORNERS, p))) return null;
  if (![4, 5, 6, 7, 8, 9, 10, 11].every((p) => home(after.EDGES, p)))
    return null;
  if (![0, 1, 2, 3].every((p) => after.EDGES.orientation[p] === 0)) return null;
  const key = after.CORNERS.orientation.slice(0, 4).join("");
  return key === "0000" ? null : key;
}

/** The first two layers whole and every last-layer piece oriented. */
export function lastSlotDone(pattern: KPattern): boolean {
  const d = dataOf(pattern);
  return (
    [4, 5, 6, 7].every((p) => home(d.CORNERS, p)) &&
    [4, 5, 6, 7, 8, 9, 10, 11].every((p) => home(d.EDGES, p)) &&
    [0, 1, 2, 3].every(
      (p) => d.CORNERS.orientation[p] === 0 && d.EDGES.orientation[p] === 0,
    )
  );
}

/**
 * A drill cube for a case: a member with its last layer's pieces placed at random (corner
 * and edge swaps of one parity, so turns can reach it), then the top turned at random, so
 * a U turn may be needed to bring the pair over its slot.
 */
export function lastSlotDrawn(
  puzzle: KPuzzle,
  set: LastSlotSet,
  key: string,
  rng: () => number,
): KPattern {
  const shuffle = () => {
    const a = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j] as number, a[i] as number];
    }
    return a;
  };
  const parity = (p: number[]) => {
    let n = 0;
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++)
        if ((p[i] as number) > (p[j] as number)) n++;
    return n % 2;
  };
  const cp = shuffle();
  let ep = shuffle();
  while (parity(ep) !== parity(cp)) ep = shuffle();
  const turn = ["", "U", "U2", "U'"][Math.floor(rng() * 4)] as string;
  const target = lastLayerPattern(puzzle, key, cp, ep).applyAlg(
    LAST_SLOT[set].undo,
  );
  return turn ? target.applyAlg(turn) : target;
}

/** The case a scrambled cube shows, the top turned as needed, or null. */
export function lastSlotOf(set: LastSlotSet, pattern: KPattern): string | null {
  for (const turn of ["", "U", "U2", "U'"]) {
    const key = lastSlotKey(set, turn ? pattern.applyAlg(turn) : pattern);
    if (key) return key;
  }
  return null;
}
