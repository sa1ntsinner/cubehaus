import {
  CROSS_MOVES,
  CROSS_STATES,
  crossDistance,
  decodeCross,
  type Face,
  solveXCross,
  unframedMove,
} from "@cubehaus/cube";
import { KPattern } from "cubing/kpuzzle";
import { kpuzzle333, solve333 } from "./cubing";
import {
  f2lKey,
  f2lOf,
  f2lReady,
  f2lState,
  f2lTurned,
  PAIR_CORNER,
  PAIR_EDGE,
} from "./f2l";
import { classifyLL, memberOf } from "./last-layer-cases";
import {
  type CubeLayout,
  type Fixed,
  homes,
  isSolved,
  randomLayout,
} from "./training-state";

/**
 * Practice scrambles for 3×3 that are not WCA scrambles: a cross a given number of turns
 * away, an xcross likewise, the cross already solved, only edges or only corners mixed,
 * and R/U turns only. Each is a state drawn under its constraint, solved by cubing's 3×3
 * solver and inverted, so the scramble reaches exactly that state; the result is played
 * back and compared before it is returned. Cross and xcross lengths are certified by our
 * own solvers.
 */
export type TrainingBase =
  | { kind: "easy-cross" | "easy-xcross"; face: Face; length: number }
  | { kind: "cross-solved"; face: Face }
  | { kind: "edges-only" | "corners-only" | "two-gen" };
/** Last-layer cases by ID (last-layer-cases.ts); one is drawn for each scramble. */
export type TrainingLL = {
  kind: "oll" | "pll" | "coll" | "ll" | "f2l";
  caseIds: readonly string[];
};
export type TrainingResult = { scramble: string; caseId: string };

/** Lengths that every face reaches: the cross is at most 8 turns, xcross tested to 6. */
export const TRAINING_RANGE = {
  "easy-cross": [0, 8],
  "easy-xcross": [0, 6],
} as const;
const ATTEMPTS = 64;
const FACES: readonly Face[] = ["U", "L", "F", "R", "B", "D"];
const TURN = /^([ULFRBD])(2|')?$/;

const shells = new Map<number, Int32Array>();
/** Every cross state exactly `length` turns from solved. */
function shell(length: number): Int32Array {
  let found = shells.get(length);
  if (found) return found;
  const states: number[] = [];
  for (let state = 0; state < CROSS_STATES; state++)
    if (crossDistance(state) === length) states.push(state);
  found = Int32Array.from(states);
  shells.set(length, found);
  return found;
}

function patternOf(
  layout: CubeLayout,
  kpuzzle: Awaited<ReturnType<typeof kpuzzle333>>,
) {
  const solved = kpuzzle.defaultPattern().patternData;
  return new KPattern(kpuzzle, {
    ...solved,
    EDGES: layout.edges,
    CORNERS: layout.corners,
  });
}

/** Outer turns only, a half turn written `2`, and nothing that cancels to nothing. */
function plainTurns(alg: string): string[] {
  return alg
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const turn = token.replace("2'", "2");
      if (!TURN.test(turn)) throw new Error(`Unexpected turn ${token}`);
      return turn;
    });
}

/** A scramble that reaches the layout exactly, checked by playing it back. */
async function scrambleFor(layout: CubeLayout): Promise<string> {
  const kpuzzle = await kpuzzle333();
  const target = patternOf(layout, kpuzzle);
  const solution = await solve333(target);
  const scramble = plainTurns(solution.invert().toString()).join(" ");
  const reached = kpuzzle.defaultPattern().applyAlg(scramble);
  if (!reached.isIdentical(target))
    throw new Error("The scramble does not reach the drawn state");
  return scramble;
}

/** A scramble found with the cross face at the bottom, named in the face's own frame. */
const onFace = (turns: readonly string[], face: Face) =>
  turns.map((turn) => unframedMove(CROSS_MOVES.indexOf(turn), face)).join(" ");

/** k random turns, never one face twice running and opposite faces in one order. */
function randomTurns(length: number, rng: () => number): string[] {
  const turns: string[] = [];
  let last = -1;
  while (turns.length < length) {
    const move = Math.floor(rng() * 18);
    const face = Math.floor(move / 3);
    if (face === last) continue;
    // U L F R B D: the opposite pairs are 0–5, 1–3 and 2–4.
    const opposite = [5, 3, 4, 1, 2, 0][face];
    if (opposite === last && face < last) continue;
    turns.push(CROSS_MOVES[move] as string);
    last = face;
  }
  return turns;
}

function inverse(turns: readonly string[]): string {
  return [...turns]
    .reverse()
    .map((turn) =>
      turn.endsWith("'")
        ? turn.slice(0, -1)
        : turn.endsWith("2")
          ? turn
          : `${turn}'`,
    )
    .join(" ");
}

function checkLength(kind: keyof typeof TRAINING_RANGE, length: number) {
  const [low, high] = TRAINING_RANGE[kind];
  if (!Number.isInteger(length) || length < low || length > high)
    throw new RangeError(
      `${kind} takes ${low} to ${high} turns, not ${length}`,
    );
}

function checkFace(face: Face) {
  if (!FACES.includes(face)) throw new RangeError(`No face ${face}`);
}

// cubing's places for the D cross (DF DR DB DL) and the front right slot (FR, DRF).
const CROSS_PLACES = [4, 5, 6, 7];
const SLOT_EDGE = 8;
const SLOT_CORNER = 4;

export async function generateTraining(
  request: TrainingBase | TrainingLL,
  rng: () => number,
  signal?: AbortSignal,
): Promise<TrainingResult> {
  if ("caseIds" in request) {
    if (request.caseIds.length === 0)
      throw new RangeError("Choose at least one case");
    for (const id of request.caseIds)
      if (!id.startsWith(`${request.kind}-`))
        throw new RangeError(`${id} is not a ${request.kind} case`);
  }
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    signal?.throwIfAborted();
    const found = await attemptOnce(request, rng);
    if (found) return found;
  }
  throw new Error(`No ${request.kind} scramble after ${ATTEMPTS} tries`);
}

async function attemptOnce(
  request: TrainingBase | TrainingLL,
  rng: () => number,
): Promise<TrainingResult | null> {
  if ("caseIds" in request && request.kind === "f2l") {
    // The pair as the case, turned by a random U; the cross and the other three slots
    // home; the last layer drawn at random, so it is scrambled too.
    const id = request.caseIds[
      Math.floor(rng() * request.caseIds.length)
    ] as string;
    const key = id.slice(4);
    const pair = f2lTurned(f2lState(key), Math.floor(rng() * 4));
    const home = (place: number) =>
      [place, { piece: place, orientation: 0 }] as [
        number,
        { piece: number; orientation: number },
      ];
    const layout = randomLayout(
      new Map([
        ...[4, 5, 6, 7, 9, 10, 11].map(home),
        [pair.edge, { piece: PAIR_EDGE, orientation: pair.flip }],
      ]),
      new Map([
        ...[5, 6, 7].map(home),
        [pair.corner, { piece: PAIR_CORNER, orientation: pair.twist }],
      ]),
      rng,
    );
    const scramble = await scrambleFor(layout);
    const kpuzzle = await kpuzzle333();
    const reached = kpuzzle.defaultPattern().applyAlg(scramble);
    return f2lReady(reached) && f2lKey(f2lOf(reached)) === key
      ? { scramble, caseId: id }
      : null;
  }
  if ("caseIds" in request) {
    // The case first, then a member of it with random U turns before and after.
    const id = request.caseIds[
      Math.floor(rng() * request.caseIds.length)
    ] as string;
    const top = memberOf(id, rng);
    const layout: CubeLayout = {
      edges: {
        pieces: [...top.ep, 4, 5, 6, 7, 8, 9, 10, 11],
        orientation: [...top.eo, 0, 0, 0, 0, 0, 0, 0, 0],
      },
      corners: {
        pieces: [...top.cp, 4, 5, 6, 7],
        orientation: [...top.co, 0, 0, 0, 0],
      },
    };
    const scramble = await scrambleFor(layout);
    // Read back from the scramble alone: the class must be the one asked for.
    const kpuzzle = await kpuzzle333();
    const found = classifyLL(kpuzzle.defaultPattern().applyAlg(scramble));
    const got =
      request.kind === "oll"
        ? found.oll
        : request.kind === "pll"
          ? found.pll
          : request.kind === "coll"
            ? found.coll
            : found.ll;
    return got === id ? { scramble, caseId: id } : null;
  }
  switch (request.kind) {
    case "easy-cross": {
      checkLength(request.kind, request.length);
      checkFace(request.face);
      const states = shell(request.length);
      const { places, flips } = decodeCross(
        states[Math.floor(rng() * states.length)] as number,
      );
      // Our edge places are cubing's order and flips, so the coordinate carries over.
      const fixed: Fixed = new Map(
        places.map((place, k) => [
          place,
          { piece: CROSS_PLACES[k] as number, orientation: flips[k] as number },
        ]),
      );
      const scramble = await scrambleFor(randomLayout(fixed, new Map(), rng));
      return {
        scramble: onFace(plainTurns(scramble), request.face),
        caseId: `easy-cross:${request.face}:${request.length}`,
      };
    }
    case "easy-xcross": {
      checkLength(request.kind, request.length);
      checkFace(request.face);
      // A state with the cross and the front right slot whole, the rest at random, then
      // k turns away from it; kept only if no slot is nearer.
      const goal = randomLayout(
        new Map(
          [...CROSS_PLACES, SLOT_EDGE].map((place) => [
            place,
            { piece: place, orientation: 0 },
          ]),
        ),
        new Map([[SLOT_CORNER, { piece: SLOT_CORNER, orientation: 0 }]]),
        rng,
      );
      const kpuzzle = await kpuzzle333();
      const witness = randomTurns(request.length, rng);
      const data = patternOf(goal, kpuzzle).applyAlg(
        inverse(witness),
      ).patternData;
      const layout = {
        edges: data.EDGES as unknown as CubeLayout["edges"],
        corners: data.CORNERS as unknown as CubeLayout["corners"],
      };
      const scramble = plainTurns(await scrambleFor(copy(layout)));
      const shortest = solveXCross(scramble.join(" "), "D", {
        maxDepth: request.length,
      });
      if (shortest?.length !== request.length) return null;
      return {
        scramble: onFace(scramble, request.face),
        caseId: `easy-xcross:${request.face}:${request.length}`,
      };
    }
    case "cross-solved": {
      checkFace(request.face);
      const layout = randomLayout(
        new Map(
          CROSS_PLACES.map((place) => [
            place,
            { piece: place, orientation: 0 },
          ]),
        ),
        new Map(),
        rng,
      );
      if (isSolved(layout.edges) && isSolved(layout.corners)) return null;
      const scramble = await scrambleFor(layout);
      return {
        scramble: onFace(plainTurns(scramble), request.face),
        caseId: `cross-solved:${request.face}`,
      };
    }
    case "edges-only":
    case "corners-only": {
      const edges = request.kind === "edges-only";
      const layout = randomLayout(
        edges ? new Map() : homes(12),
        edges ? homes(8) : new Map(),
        rng,
      );
      if (isSolved(edges ? layout.edges : layout.corners)) return null;
      return { scramble: await scrambleFor(layout), caseId: request.kind };
    }
    case "two-gen": {
      // A practice scramble from the R/U subgroup: alternating turns of R and U.
      const turns: string[] = [];
      let face = rng() < 0.5 ? "R" : "U";
      for (let i = 0; i < 20; i++) {
        turns.push(face + (["", "2", "'"][Math.floor(rng() * 3)] as string));
        face = face === "R" ? "U" : "R";
      }
      const scramble = turns.join(" ");
      const kpuzzle = await kpuzzle333();
      const reached = kpuzzle.defaultPattern().applyAlg(scramble);
      if (reached.isIdentical(kpuzzle.defaultPattern())) return null;
      return { scramble, caseId: "two-gen" };
    }
  }
}

const copy = (layout: CubeLayout): CubeLayout => ({
  edges: {
    pieces: [...layout.edges.pieces],
    orientation: [...layout.edges.orientation],
  },
  corners: {
    pieces: [...layout.corners.pieces],
    orientation: [...layout.corners.orientation],
  },
});
