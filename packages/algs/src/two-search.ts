import { applyTwo, SOLVED, type Two } from "./two";

/**
 * Our own exhaustive search on the 2×2 (two.ts) in R, U and F. The DBL corner never moves,
 * so a state is the places of the other seven pieces (7! = 5 040) and the twists of six
 * of them (3⁶ = 729; the seventh follows): 3 674 160 states, every one reached. A distance
 * table filled backwards from the goal gives every state's exact distance, so the search
 * finds every shortest algorithm, and those a turn or two longer, without guessing.
 * Build and test time only.
 */

const FACES = ["R", "U", "F"] as const;
const POWERS = ["", "2", "'"] as const;
export const TWO_MOVES = FACES.flatMap((f) => POWERS.map((p) => f + p));

const PLACES = [0, 1, 2, 3, 4, 5, 7];
const FACT = [1, 1, 2, 6, 24, 120, 720, 5040];
export const PERMS = 5040;
export const TWISTS = 729;
export const STATES = PERMS * TWISTS;

/** The places of the seven pieces, as a rank of 0 to 5 039. */
export function permIndex(s: Two): number {
  const local = PLACES.map((place) => {
    const piece = s.cp[place] as number;
    return piece === 7 ? 6 : piece;
  });
  let rank = 0;
  for (let i = 0; i < 7; i++) {
    let smaller = 0;
    for (let j = i + 1; j < 7; j++)
      if ((local[j] as number) < (local[i] as number)) smaller++;
    rank += smaller * (FACT[6 - i] as number);
  }
  return rank;
}

/** The twists of places 0 to 5 as a number of 0 to 728. */
export function twistIndex(s: Two): number {
  let index = 0;
  for (let place = 0; place < 6; place++)
    index = index * 3 + (s.co[place] as number);
  return index;
}

export const indexOf = (s: Two) => permIndex(s) * TWISTS + twistIndex(s);

/** The state of an index: the inverse of indexOf. */
export function stateOf(index: number): Two {
  let perm = Math.floor(index / TWISTS);
  let twist = index % TWISTS;
  const left = [0, 1, 2, 3, 4, 5, 6];
  const local: number[] = [];
  for (let i = 0; i < 7; i++) {
    const f = FACT[6 - i] as number;
    const k = Math.floor(perm / f);
    perm %= f;
    local.push(left.splice(k, 1)[0] as number);
  }
  const cp = [0, 0, 0, 0, 0, 0, 6, 0];
  PLACES.forEach((place, i) => {
    const piece = local[i] as number;
    cp[place] = piece === 6 ? 7 : piece;
  });
  const co = [0, 0, 0, 0, 0, 0, 0, 0];
  let sum = 0;
  for (let place = 5; place >= 0; place--) {
    co[place] = twist % 3;
    sum += co[place] as number;
    twist = Math.floor(twist / 3);
  }
  co[7] = (3 - (sum % 3)) % 3;
  return { cp, co };
}

type Tables = { perm: Uint16Array; twist: Uint16Array };
let moveTables: Tables | undefined;

/** Where each move takes each coordinate, from the model itself. */
function tables(): Tables {
  if (moveTables) return moveTables;
  const perm = new Uint16Array(PERMS * TWO_MOVES.length);
  const twist = new Uint16Array(TWISTS * TWO_MOVES.length);
  for (let p = 0; p < PERMS; p++) {
    const s = stateOf(p * TWISTS);
    TWO_MOVES.forEach((m, k) => {
      perm[p * TWO_MOVES.length + k] = permIndex(applyTwo(s, m));
    });
  }
  for (let t = 0; t < TWISTS; t++) {
    const s = stateOf(t);
    TWO_MOVES.forEach((m, k) => {
      twist[t * TWO_MOVES.length + k] = twistIndex(applyTwo(s, m));
    });
  }
  moveTables = { perm, twist };
  return moveTables;
}

/** The index after one of the nine moves. */
export function step(index: number, move: number): number {
  const t = tables();
  const p = Math.floor(index / TWISTS);
  const w = index % TWISTS;
  return (
    (t.perm[p * TWO_MOVES.length + move] as number) * TWISTS +
    (t.twist[w * TWO_MOVES.length + move] as number)
  );
}

/** Every state's distance from the nearest goal state, by breadth-first search. */
export function distances(goals: readonly Two[]): Uint8Array {
  const table = new Uint8Array(STATES).fill(255);
  let frontier: number[] = [];
  for (const g of goals) {
    const i = indexOf(g);
    if (table[i] === 255) {
      table[i] = 0;
      frontier.push(i);
    }
  }
  for (let depth = 1; frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const i of frontier)
      for (let m = 0; m < TWO_MOVES.length; m++) {
        const j = step(i, m);
        if (table[j] === 255) {
          table[j] = depth;
          next.push(j);
        }
      }
    frontier = next;
  }
  return table;
}

/** Solved, and solved but for a turn of the top: the last layer's goal. */
export const SOLVED_UP_TO_U: readonly Two[] = [0, 1, 2, 3].map((k) =>
  applyTwo(SOLVED, ["", "U", "U2", "U'"][k] as string),
);

/**
 * Every algorithm from `start` to a goal of `table` of at most the shortest length plus
 * `extra`, up to `limit`, shortest first. No two turns of one face follow each other, and
 * none begins with U (a U before is the case's turn before the algorithm) or, when
 * `endU` is false, ends with one (`startU` allows the first).
 */
export function solveTwo(
  table: Uint8Array,
  start: Two,
  options: { extra: number; limit: number; endU?: boolean; startU?: boolean },
): string[] {
  const from = indexOf(start);
  const least = table[from] as number;
  if (least === 255) return [];
  const found: string[] = [];
  const path: number[] = [];
  const dfs = (i: number, depth: number, lastFace: number) => {
    if (found.length >= options.limit) return;
    if (depth === 0) {
      if (table[i] === 0 && path.length > 0) {
        const last = Math.floor((path[path.length - 1] as number) / 3);
        if (options.endU || last !== 1)
          found.push(path.map((m) => TWO_MOVES[m]).join(" "));
      }
      return;
    }
    if ((table[i] as number) > depth) return;
    for (let m = 0; m < TWO_MOVES.length; m++) {
      const face = Math.floor(m / 3);
      if (face === lastFace) continue;
      if (path.length === 0 && face === 1 && !options.startU) continue;
      path.push(m);
      dfs(step(i, m), depth - 1, face);
      path.pop();
    }
  };
  for (let depth = Math.max(1, least); depth <= least + options.extra; depth++)
    dfs(from, depth, -1);
  return found;
}

/**
 * A scramble that leads from a solved cube to `target`: the reverse of a shortest way
 * from `target` to solved (`table` is distances([SOLVED])), one of the shortest chosen by
 * `pick` (0 to 1).
 */
export function scrambleTo(
  table: Uint8Array,
  target: Two,
  pick: number,
): string {
  const ways = solveTwo(table, target, {
    extra: 0,
    limit: 64,
    endU: true,
    startU: true,
  });
  const way = ways[Math.floor(pick * ways.length)] ?? ways[0];
  if (way === undefined) throw new RangeError("No way to solve this state");
  return way
    .split(" ")
    .reverse()
    .map((m) => (m.endsWith("'") ? m[0] : m.endsWith("2") ? m : `${m}'`))
    .join(" ");
}
