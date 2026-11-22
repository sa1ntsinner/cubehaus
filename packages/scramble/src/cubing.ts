import type { EventId } from "@cubehaus/core";
import type { Alg } from "cubing/alg";
import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { puzzles } from "cubing/puzzles";
import { randomScrambleForEvent } from "cubing/scramble";
import {
  experimentalSolve3x3x3IgnoringCenters,
  setSearchDebug,
} from "cubing/search";
import { toOfficial } from "./official";
import {
  createPyraminxSolver,
  type PyraminxMoves,
  type PyraminxSolver,
  splitPyraminx,
} from "./pyraminx";
import { createShortSolver, SHORT_EVENTS, type ShortSolver } from "./short";

export { checkFewestMoves } from "./fewest";

// The library first tries import.meta.resolve("./search-worker-entry.js"),
// which bundlers leave unhashed: the request misses, a static host may answer
// with index.html, and WebKit reports that as a page error. Its dynamic-import
// strategy resolves to the bundled, hashed entry, so it goes first.
setSearchDebug({ prioritizeEsbuildWorkaroundForWorkerInstantiation: true });

let kpuzzle3: Promise<KPuzzle> | undefined;
/** cubing's 3×3 definition, loaded once. */
export function kpuzzle333(): Promise<KPuzzle> {
  kpuzzle3 ??= (
    puzzles["3x3x3"] as NonNullable<(typeof puzzles)["3x3x3"]>
  ).kpuzzle();
  return kpuzzle3;
}

/** A solution of a 3×3 state by cubing's own solver; centres are ignored. */
export function solve333(pattern: KPattern): Promise<Alg> {
  return experimentalSolve3x3x3IgnoringCenters(pattern);
}

async function raw(event: string): Promise<string> {
  return (await randomScrambleForEvent(event)).toString();
}

// Fewest Moves as the official program writes it: R' U' F, a random-state
// 3x3x3 scramble, R' U' F. The inner part must not start on the F or B face
// or end on the R or L face, so nothing merges with the padding. A fixed
// padding around a uniformly random state leaves the state uniform.
async function fewestMoves(): Promise<string> {
  for (;;) {
    const moves = (await raw("333")).split(/\s+/).filter(Boolean);
    const first = moves[0]?.[0];
    const last = moves.at(-1)?.[0];
    if (first === "F" || first === "B" || last === "R" || last === "L")
      continue;
    return ["R'", "U'", "F", ...moves, "R'", "U'", "F"].join(" ");
  }
}

// Pyraminx with exactly 11 main moves. The table is built from the
// library's own puzzle model on the first Pyraminx scramble (tens of ms).
let pyraminx: Promise<PyraminxSolver> | undefined;
function pyraminxSolver(): Promise<PyraminxSolver> {
  pyraminx ??= (async () => {
    const kpuzzle = await (
      puzzles.pyraminx as NonNullable<typeof puzzles.pyraminx>
    ).kpuzzle();
    const moves = Object.fromEntries(
      (["U", "L", "R", "B"] as const).map((face) => [
        face,
        kpuzzle.moveToTransformation(face).transformationData,
      ]),
    ) as unknown as PyraminxMoves;
    return createPyraminxSolver(moves);
  })();
  return pyraminx;
}

// Regulation 4b3f: the state must need at least 6 moves, a twisted tip
// being one move. The library's states sometimes need only 5 main moves, so
// those with too few twisted tips are drawn again.
async function elevenMovePyraminx(): Promise<string> {
  const solver = await pyraminxSolver();
  for (;;) {
    const { main, tips } = splitPyraminx(await raw("pyram"));
    const state = solver.stateOf(main);
    const tipMoves = tips.split(" ").filter(Boolean).length;
    if (solver.distance(state) + tipMoves < 6) continue;
    return [solver.elevenMoves(state), tips].filter(Boolean).join(" ");
  }
}

// Regulations 4b3b and 4b3c: a 2x2x2 state must need at least 4 moves and
// a Skewb state at least 7. A state that needs fewer is drawn again.
type ShortEvent = keyof typeof SHORT_EVENTS;
const shortSolvers: Partial<Record<ShortEvent, Promise<ShortSolver>>> = {};
async function longEnough(event: ShortEvent): Promise<string> {
  const options = SHORT_EVENTS[event];
  shortSolvers[event] ??= (async () => {
    const kpuzzle = await (
      puzzles[options.puzzle] as NonNullable<(typeof puzzles)["skewb"]>
    ).kpuzzle();
    return createShortSolver({ kpuzzle, ...options });
  })();
  const solver = await shortSolvers[event];
  for (;;) {
    const scramble = await raw(event);
    if (solver.solution(scramble, options.minimum - 1) === null)
      return scramble;
  }
}

// One scramble per cube, all different (Regulation 4g2), one per line.
async function multiBlind(cubes: number): Promise<string> {
  const count = Math.max(2, Math.floor(cubes));
  const lines = new Set<string>();
  while (lines.size < count)
    lines.add(toOfficial("333mbf", await raw("333bf")));
  return [...lines].join("\n");
}

export async function cubingGenerate(
  event: EventId,
  options?: { cubes?: number },
): Promise<string> {
  if (event === "333fm") return fewestMoves();
  if (event === "333mbf") return multiBlind(options?.cubes ?? 2);
  if (event === "pyram") return elevenMovePyraminx();
  if (event === "222" || event === "skewb")
    return toOfficial(event, await longEnough(event));
  return toOfficial(event, await raw(event));
}
