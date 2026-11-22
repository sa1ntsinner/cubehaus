import type { KPattern, KPuzzle, KTransformation } from "cubing/kpuzzle";

// Finds a solution of at most `maxMoves` moves for a scrambled state, or
// says there is none. The WCA counts a state as solved in any orientation,
// and on these puzzles a turn of one side equals a turn of the opposite side
// plus a rotation, so the search runs in one frame:
//
// 1. Rotate the state so that the piece none of the generators move is home
//    (exactly one rotation does that).
// 2. Meet in the middle: the states up to `ballDepth` moves from solved are
//    kept by key; from the rotated state, every sequence of up to
//    `maxMoves - ballDepth` moves is tried against them.
//
// Used to enforce the minimum solution lengths of Regulation 4b3: a state
// for which this finds a solution under the minimum is drawn again.

// The two puzzles whose minimum the random state can miss often enough to
// matter: about 1 Skewb state in 44 is within 6 moves.
export const SHORT_EVENTS = {
  // Regulation 4b3b: at least 4 moves.
  "222": {
    puzzle: "2x2x2",
    generators: ["R", "U", "F"],
    rotations: ["x", "y"],
    ballDepth: 3,
    minimum: 4,
  },
  // Regulation 4b3c: at least 7 moves.
  skewb: {
    puzzle: "skewb",
    generators: ["R", "L", "U", "B"],
    rotations: ["Dv", "Lv", "Rv", "Bv"],
    ballDepth: 4,
    hiddenOrientation: ["CENTERS"],
    minimum: 7,
  },
} as const;

export interface ShortSolverOptions {
  kpuzzle: KPuzzle;
  // Turns that leave one piece in place, the notation's own (R U F on the
  // 2x2x2, R L U B on the Skewb).
  generators: readonly string[];
  // Whole-puzzle rotations that generate every orientation a turn sequence
  // can reach.
  rotations: readonly string[];
  ballDepth: number;
  // Orbits whose orientation cannot be seen (Skewb centres).
  hiddenOrientation?: readonly string[];
}

export interface ShortSolver {
  // Rotation and moves that solve `scramble`, with at most `maxMoves`
  // moves, or null when every solution is longer.
  solution(scramble: string, maxMoves: number): string | null;
  // States at each distance up to `ballDepth`, for checking the model.
  ballSizes(): number[];
}

interface Step {
  name: string;
  transformation: KTransformation;
  family: string;
}

export function createShortSolver(options: ShortSolverOptions): ShortSolver {
  const { kpuzzle, ballDepth } = options;
  const hidden = new Set(options.hiddenOrientation ?? []);
  const orbits = kpuzzle.definition.orbits.map((orbit) => orbit.orbitName);

  const key = (pattern: KPattern): string =>
    orbits
      .map((name) => {
        const orbit = pattern.patternData[name];
        if (!orbit) return "";
        const pieces = orbit.pieces.join(",");
        return hidden.has(name)
          ? pieces
          : `${pieces}/${orbit.orientation.join(",")}`;
      })
      .join("|");

  const steps: Step[] = options.generators.flatMap((family) =>
    [family, `${family}'`, `${family}2`]
      .filter((name) => {
        try {
          kpuzzle.moveToTransformation(name);
          return true;
        } catch {
          return false;
        }
      })
      .map((name) => ({
        name,
        transformation: kpuzzle.moveToTransformation(name),
        family,
      })),
  );
  // A double turn on a three-fold axis equals the inverse turn: keep one.
  const distinct = new Map<string, Step>();
  const solved = kpuzzle.defaultPattern();
  for (const step of steps) {
    const after = key(solved.applyTransformation(step.transformation));
    if (!distinct.has(after)) distinct.set(after, step);
  }
  const moves = [...distinct.values()];

  // The piece every generator leaves in place, with its orientation.
  const fixed = (() => {
    for (const orbit of kpuzzle.definition.orbits) {
      for (let slot = 0; slot < orbit.numPieces; slot++) {
        const still = options.generators.every((family) => {
          const t =
            kpuzzle.moveToTransformation(family).transformationData[
              orbit.orbitName
            ];
          return (
            t?.permutation[slot] === slot && t.orientationDelta[slot] === 0
          );
        });
        if (still && !hidden.has(orbit.orbitName))
          return { orbit: orbit.orbitName, slot };
      }
    }
    throw new Error("No piece is left in place by every generator");
  })();

  // Every orientation, as the shortest rotation sequence that reaches it.
  const orientations: { alg: string; pattern: KPattern }[] = [];
  {
    const seen = new Set([key(solved)]);
    orientations.push({ alg: "", pattern: solved });
    for (let i = 0; i < orientations.length; i++) {
      const from = orientations[i] as (typeof orientations)[number];
      for (const rotation of options.rotations) {
        const pattern = from.pattern.applyMove(rotation);
        const k = key(pattern);
        if (seen.has(k)) continue;
        seen.add(k);
        orientations.push({
          alg: [from.alg, rotation].filter(Boolean).join(" "),
          pattern,
        });
      }
    }
  }

  const isHome = (pattern: KPattern) => {
    const orbit = pattern.patternData[fixed.orbit];
    return (
      orbit?.pieces[fixed.slot] === fixed.slot &&
      orbit.orientation[fixed.slot] === 0
    );
  };

  // States within `ballDepth` moves, each with a sequence that reaches it.
  const ball = new Map<string, string[]>([[key(solved), []]]);
  const sizes = [1];
  {
    let frontier: { pattern: KPattern; path: string[]; last?: string }[] = [
      { pattern: solved, path: [] },
    ];
    for (let depth = 1; depth <= ballDepth; depth++) {
      const next: typeof frontier = [];
      for (const node of frontier) {
        for (const move of moves) {
          if (move.family === node.last) continue;
          const pattern = node.pattern.applyTransformation(move.transformation);
          const k = key(pattern);
          if (ball.has(k)) continue;
          const path = [...node.path, move.name];
          ball.set(k, path);
          next.push({ pattern, path, last: move.family });
        }
      }
      sizes.push(next.length);
      frontier = next;
    }
  }

  const invert = (path: string[]) =>
    path
      .toReversed()
      .map((name) =>
        name.endsWith("'")
          ? name.slice(0, -1)
          : name.endsWith("2")
            ? name
            : `${name}'`,
      );

  return {
    solution(scramble, maxMoves) {
      let start = kpuzzle.defaultPattern().applyAlg(scramble);
      const rotation = orientations.find(({ alg }) =>
        isHome(alg ? start.applyAlg(alg) : start),
      );
      if (!rotation) throw new Error("No rotation puts the fixed piece home");
      if (rotation.alg) start = start.applyAlg(rotation.alg);
      const searchDepth = Math.max(0, maxMoves - ballDepth);
      const ballLimit = Math.min(ballDepth, maxMoves);

      const search = (
        pattern: KPattern,
        depth: number,
        last?: string,
      ): string[] | null => {
        const meet = ball.get(key(pattern));
        if (meet && meet.length <= ballLimit) return invert(meet);
        if (depth === 0) return null;
        for (const move of moves) {
          if (move.family === last) continue;
          const found = search(
            pattern.applyTransformation(move.transformation),
            depth - 1,
            move.family,
          );
          if (found) return [move.name, ...found];
        }
        return null;
      };

      for (let depth = 0; depth <= searchDepth; depth++) {
        const found = search(start, depth);
        if (found) return [rotation.alg, ...found].filter(Boolean).join(" ");
      }
      return null;
    },
    ballSizes: () => sizes,
  };
}
