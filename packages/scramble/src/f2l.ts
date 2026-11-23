import { KPattern } from "cubing/kpuzzle";
import {
  type F2lSlot,
  type F2lState,
  f2lKey,
  PAIR_CORNER,
  PAIR_EDGE,
} from "./f2l-state";

/** The F2L pair on cubing's cube: read, checked and placed (f2l-state.ts has the cases). */
export * from "./f2l-state";

type Orbit = { pieces: number[]; orientation: number[] };
type Data = { CORNERS: Orbit; EDGES: Orbit };

const dataOf = (pattern: KPattern) => pattern.patternData as unknown as Data;

/* Places in the mirror through the M slice: corners UFR URB UBL ULF DRF DFL DLB DBR, edges
 * UF UR UB UL DF DR DB DL FR FL BR BL, centres U L F R B D. */
const CORNER_MIRROR = [3, 2, 1, 0, 5, 4, 7, 6];
const EDGE_MIRROR = [0, 3, 2, 1, 4, 7, 6, 5, 9, 8, 11, 10];
const CENTRE_MIRROR = [0, 3, 2, 1, 4, 5];

/**
 * The cube seen in the mirror through the M slice: each piece goes to its mirror place as
 * its mirror piece; a corner's twist turns the other way, an edge keeps its flip. For any
 * turns A, the mirror of a solved cube after A is a solved cube after mirrorAlg(A).
 */
export function mirrorPattern(pattern: KPattern): KPattern {
  const data = pattern.patternData as unknown as Data & { CENTERS: Orbit };
  const orbit = (
    from: Orbit & { orientationMod?: number[] },
    map: readonly number[],
    turn: (o: number) => number,
  ) => {
    const pieces = new Array<number>(map.length);
    const orientation = new Array<number>(map.length);
    from.pieces.forEach((piece, place) => {
      const to = map[place] as number;
      pieces[to] = map[piece] as number;
      orientation[to] = turn(from.orientation[place] as number);
    });
    return from.orientationMod
      ? { pieces, orientation, orientationMod: [...from.orientationMod] }
      : { pieces, orientation };
  };
  return new KPattern(pattern.kpuzzle, {
    ...pattern.patternData,
    CORNERS: orbit(data.CORNERS, CORNER_MIRROR, (o) => (3 - o) % 3),
    EDGES: orbit(data.EDGES, EDGE_MIRROR, (o) => o),
    CENTERS: orbit(data.CENTERS, CENTRE_MIRROR, () => 0),
  });
}

/** A cube turned whole by `turn` before and `back` after: P seen through a rotation. */
function conjugate(pattern: KPattern, turn: string, back: string): KPattern {
  const moved = pattern.experimentalToTransformation();
  if (!moved) throw new RangeError("Not a cube turns can reach");
  return pattern.kpuzzle
    .defaultPattern()
    .applyAlg(turn)
    .applyTransformation(moved)
    .applyAlg(back);
}

/**
 * A front right cube as the slot sees it: for any turns A, the cube after A becomes the
 * cube after slotAlg(A, slot). The back right slot is the cube turned by y (y A y'), the
 * left slots the right ones in the mirror.
 */
export function slotPattern(pattern: KPattern, slot: F2lSlot): KPattern {
  if (slot === "fr") return pattern;
  if (slot === "fl") return mirrorPattern(pattern);
  const back = conjugate(pattern, "y", "y'");
  return slot === "br" ? back : mirrorPattern(back);
}

/** A slot's cube seen as the front right one it stands for: slotPattern undone. */
export function unslotPattern(pattern: KPattern, slot: F2lSlot): KPattern {
  if (slot === "fr") return pattern;
  if (slot === "fl") return mirrorPattern(pattern);
  return conjugate(slot === "br" ? pattern : mirrorPattern(pattern), "y'", "y");
}

/** Where the pair stands on a cube. */
export function f2lOf(pattern: KPattern): F2lState {
  const { CORNERS, EDGES } = dataOf(pattern);
  const corner = CORNERS.pieces.indexOf(PAIR_CORNER);
  const edge = EDGES.pieces.indexOf(PAIR_EDGE);
  return {
    corner,
    twist: CORNERS.orientation[corner] as number,
    edge,
    flip: EDGES.orientation[edge] as number,
  };
}

const home = (orbit: Orbit, place: number) =>
  orbit.pieces[place] === place && orbit.orientation[place] === 0;

/** The cross and the three other slots whole (centres as cubing keeps them, home). */
export function f2lReady(pattern: KPattern): boolean {
  const { CORNERS, EDGES } = dataOf(pattern);
  return (
    [4, 5, 6, 7, 9, 10, 11].every((place) => home(EDGES, place)) &&
    [5, 6, 7].every((place) => home(CORNERS, place))
  );
}

/** The first two layers whole, the pair included. */
export const f2lSolved = (pattern: KPattern) =>
  f2lReady(pattern) && f2lKey(f2lOf(pattern)) === null;

/**
 * A cube with the pair put where a state says, from a pattern whose pair is home; the pieces
 * it displaces take the pair's places, and the last layer absorbs the twist, flip and swap
 * parity so the cube stays one that turns can reach.
 */
export function placePair(pattern: KPattern, state: F2lState): KPattern {
  const data = pattern.patternData as unknown as Data;
  const corners = {
    pieces: [...data.CORNERS.pieces],
    orientation: [...data.CORNERS.orientation],
  };
  const edges = {
    pieces: [...data.EDGES.pieces],
    orientation: [...data.EDGES.orientation],
  };
  const swap = (orbit: Orbit, a: number, b: number) => {
    if (a === b) return 0;
    [orbit.pieces[a], orbit.pieces[b]] = [
      orbit.pieces[b] as number,
      orbit.pieces[a] as number,
    ];
    [orbit.orientation[a], orbit.orientation[b]] = [
      orbit.orientation[b] as number,
      orbit.orientation[a] as number,
    ];
    return 1;
  };
  let swaps = swap(corners, PAIR_CORNER, state.corner);
  swaps += swap(edges, PAIR_EDGE, state.edge);
  // An odd number of swaps: two other top edges trade places.
  const free = [0, 1, 2, 3].filter((place) => place !== state.edge);
  if (swaps % 2 === 1) swap(edges, free[0] as number, free[1] as number);
  const twistBefore = corners.orientation[state.corner] as number;
  corners.orientation[state.corner] = state.twist;
  const flipBefore = edges.orientation[state.edge] as number;
  edges.orientation[state.edge] = state.flip;
  // The twist and flip added are taken back on a top place the pair does not use.
  const spareCorner = [0, 1, 2, 3].find(
    (place) => place !== state.corner,
  ) as number;
  corners.orientation[spareCorner] =
    ((corners.orientation[spareCorner] as number) +
      twistBefore -
      state.twist +
      6) %
    3;
  const spareEdge = free[2] as number;
  edges.orientation[spareEdge] =
    ((edges.orientation[spareEdge] as number) + flipBefore + state.flip) % 2;
  return new KPattern(pattern.kpuzzle, {
    ...pattern.patternData,
    CORNERS: corners,
    EDGES: edges,
  });
}
