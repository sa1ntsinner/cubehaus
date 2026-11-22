import type { KPattern, KPuzzle } from "cubing/kpuzzle";
import { puzzles } from "cubing/puzzles";
import { randomScrambleForEvent } from "cubing/scramble";
import { beforeAll, describe, expect, test } from "vitest";
import { cubingGenerate } from "./cubing";
import { createShortSolver, SHORT_EVENTS, type ShortSolver } from "./short";

type Event = keyof typeof SHORT_EVENTS;

const faces = ["U", "D", "L", "R", "F", "B"];
const corners = ["U", "UL", "UR", "L", "R", "D", "F", "B"];
const turns: Record<Event, string[]> = {
  "222": faces.flatMap((face) => [face, `${face}'`, `${face}2`]),
  skewb: corners.flatMap((corner) => [corner, `${corner}'`]),
};
const rotationNames: Record<Event, string[]> = {
  "222": ["x", "y", "z"],
  skewb: ["Dv", "Lv", "Rv", "Bv"],
};

const kpuzzles = {} as Record<Event, KPuzzle>;
const solvers = {} as Record<Event, ShortSolver>;
// Every orientation of the solved puzzle, by the visible pieces only.
const solvedKeys = {} as Record<Event, Set<string>>;

function visibleKey(event: Event, pattern: KPattern): string {
  const data = pattern.patternData;
  const corner = data.CORNERS;
  const parts = [`${corner?.pieces}/${corner?.orientation}`];
  // Skewb centres turn with no visible change.
  if (event === "skewb") parts.push(`${data.CENTERS?.pieces}`);
  return parts.join("|");
}

beforeAll(async () => {
  for (const event of Object.keys(SHORT_EVENTS) as Event[]) {
    const options = SHORT_EVENTS[event];
    const kpuzzle = await (
      puzzles[options.puzzle] as NonNullable<(typeof puzzles)["skewb"]>
    ).kpuzzle();
    kpuzzles[event] = kpuzzle;
    solvers[event] = createShortSolver({ kpuzzle, ...options });
    // Independent of the solver: every product of up to six rotations.
    const keys = new Set<string>();
    let layer = [kpuzzle.defaultPattern()];
    for (let i = 0; i <= 6; i++) {
      for (const pattern of layer) keys.add(visibleKey(event, pattern));
      layer = layer.flatMap((pattern) =>
        rotationNames[event]
          .filter((name) => {
            try {
              kpuzzle.moveToTransformation(name);
              return true;
            } catch {
              return false;
            }
          })
          .map((name) => pattern.applyMove(name)),
      );
      if (layer.length > 20_000) break;
    }
    solvedKeys[event] = keys;
  }
}, 60_000);

function random<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

// A turn sequence with no side turned twice in a row, after and before a
// random rotation, so the state is any orientation of a short scramble.
function shortScramble(event: Event, length: number): string {
  const moves: string[] = [];
  while (moves.length < length) {
    const move = random(turns[event]);
    if (move.replace(/['2]/, "") === moves.at(-1)?.replace(/['2]/, ""))
      continue;
    moves.push(move);
  }
  const rotation = () =>
    Array.from({ length: Math.floor(Math.random() * 3) }, () =>
      random(rotationNames[event]),
    );
  return [...rotation(), ...moves, ...rotation()].join(" ");
}

function check(event: Event, scramble: string, maxMoves: number) {
  const solution = solvers[event].solution(scramble, maxMoves);
  expect(solution, scramble).not.toBeNull();
  const tokens = (solution as string).split(" ").filter(Boolean);
  const moves = tokens.filter(
    (token) => !rotationNames[event].includes(token.replace(/['2]$/, "")),
  );
  expect(moves.length, scramble).toBeLessThanOrEqual(maxMoves);
  const end = kpuzzles[event]
    .defaultPattern()
    .applyAlg(scramble)
    .applyAlg(solution as string);
  expect(solvedKeys[event].has(visibleKey(event, end)), scramble).toBe(true);
}

describe("the minimum number of moves a scramble must need", () => {
  test("the model has the known number of states at each distance", () => {
    const deep = (event: Event, ballDepth: number) =>
      createShortSolver({
        kpuzzle: kpuzzles[event],
        ...SHORT_EVENTS[event],
        ballDepth,
      }).ballSizes();
    expect(deep("222", 5)).toEqual([1, 9, 54, 321, 1847, 9992]);
    expect(deep("skewb", 5)).toEqual([1, 8, 48, 288, 1728, 10248]);
  }, 60_000);

  test("4b3b: every 2x2x2 sequence of up to 3 turns, in any orientation, is found within 3", () => {
    let count = 0;
    const walk = (moves: string[]) => {
      check("222", [random(["", "x", "y z", "x2 y'"]), ...moves].join(" "), 3);
      count += 1;
      if (moves.length === 3) return;
      for (const move of turns["222"]) {
        if (move[0] === moves.at(-1)?.[0]) continue;
        walk([...moves, move]);
      }
    };
    walk([]);
    expect(count).toBe(1 + 18 + 18 * 15 + 18 * 15 * 15);
  }, 60_000);

  test("4b3c: Skewb sequences of up to 6 turns, in any orientation, are found within 6", () => {
    for (let length = 0; length <= 6; length++)
      for (let i = 0; i < 300; i++)
        check("skewb", shortScramble("skewb", length), 6);
  }, 60_000);

  test("what is found matches a plain lookup up to 6 Skewb moves", async () => {
    const lookup = createShortSolver({
      kpuzzle: kpuzzles.skewb,
      ...SHORT_EVENTS.skewb,
      ballDepth: 6,
    });
    expect(lookup.ballSizes()).toEqual([1, 8, 48, 288, 1728, 10248, 59304]);
    const scrambles = [
      ...Array.from({ length: 300 }, (_, i) =>
        shortScramble("skewb", 5 + (i % 4)),
      ),
      ...(await Promise.all(
        Array.from({ length: 20 }, async () =>
          (await randomScrambleForEvent("skewb")).toString(),
        ),
      )),
    ];
    let short = 0;
    for (const scramble of scrambles) {
      const found = solvers.skewb.solution(scramble, 6) !== null;
      expect(found, scramble).toBe(lookup.solution(scramble, 6) !== null);
      if (found) short += 1;
    }
    // Sequences of 7 and 8 turns are sometimes shorter, mostly not.
    expect(short).toBeGreaterThan(150);
    expect(short).toBeLessThan(scrambles.length);
  }, 60_000);

  test("4b3b, 4b3c: generated scrambles need at least the minimum", async () => {
    for (const event of Object.keys(SHORT_EVENTS) as Event[]) {
      const { minimum } = SHORT_EVENTS[event];
      const started = performance.now();
      for (let i = 0; i < 40; i++) {
        const scramble = await cubingGenerate(event);
        expect(
          solvers[event].solution(scramble, minimum - 1),
          `${event}: ${scramble}`,
        ).toBeNull();
      }
      console.info(
        `${event}: 40 scrambles in ${(performance.now() - started).toFixed(0)} ms`,
      );
    }
  }, 60_000);
});
