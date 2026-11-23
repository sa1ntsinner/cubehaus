import { describe, expect, test } from "vitest";
import {
  type Direction,
  reduceSwipe,
  rubberBand,
  type SwipeConfig,
  type SwipeInput,
  type SwipeOutput,
  type SwipeState,
  startSwipe,
} from "./swipe";

const config: SwipeConfig = {
  directions: ["left", "right", "down"],
  startPx: 12,
  commitPx: 80,
  flingPxPerMs: 0.5,
  holdMs: 250,
};

/** Runs inputs through the recogniser and returns every output and the last state. */
function run(
  inputs: readonly SwipeInput[],
  options: SwipeConfig = config,
): { outputs: SwipeOutput[]; state: SwipeState } {
  let state = startSwipe();
  const outputs: SwipeOutput[] = [];
  for (const input of inputs) {
    const result = reduceSwipe(state, input, options);
    state = result.state;
    outputs.push(result.output);
  }
  return { outputs, state };
}

const down = (x: number, y: number, at: number, id = 1): SwipeInput => ({
  type: "down",
  id,
  x,
  y,
  at,
});
const move = (x: number, y: number, at: number, id = 1): SwipeInput => ({
  type: "move",
  id,
  x,
  y,
  at,
});
const up = (x: number, y: number, at: number, id = 1): SwipeInput => ({
  type: "up",
  id,
  x,
  y,
  at,
});

/** A steady drag from (x0, y0) by (dx, dy) over ms, sampled every 16 ms. */
function drag(
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  ms: number,
  from = 0,
): SwipeInput[] {
  const steps = Math.max(1, Math.round(ms / 16));
  const inputs: SwipeInput[] = [down(x0, y0, from)];
  for (let step = 1; step <= steps; step++)
    inputs.push(
      move(
        x0 + (dx * step) / steps,
        y0 + (dy * step) / steps,
        from + (ms * step) / steps,
      ),
    );
  return inputs;
}

const last = <T>(items: readonly T[]): T => {
  const item = items[items.length - 1];
  if (item === undefined) throw new Error("no items");
  return item;
};
const commits = (outputs: readonly SwipeOutput[]) =>
  outputs.flatMap((output) =>
    output.type === "commit" ? [output.direction] : [],
  );

describe("thresholds", () => {
  test("a touch that moves less than the start threshold is not a swipe", () => {
    const { outputs } = run([...drag(100, 100, -10, 4, 120), up(90, 104, 140)]);
    expect(outputs.every((output) => output.type === "none")).toBe(true);
  });

  test("past the start threshold the swipe claims the touch once, on its axis", () => {
    const { outputs } = run(drag(100, 100, -40, 6, 100));
    const claims = outputs.filter((output) => output.type === "claim");
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ direction: "left" });
  });

  test("the content follows the finger from the first pixel past the claim", () => {
    const { outputs } = run(drag(100, 100, -50, 0, 100));
    const moved = last(outputs);
    expect(moved).toMatchObject({ type: "move", offset: { x: -50, y: 0 } });
  });

  test("released past the commit distance it commits; short of it, it springs back", () => {
    const far = run([...drag(100, 100, -90, 0, 600), up(10, 100, 620)]);
    expect(commits(far.outputs)).toEqual(["left"]);
    const short = run([...drag(100, 100, -60, 0, 600), up(40, 100, 620)]);
    expect(commits(short.outputs)).toEqual([]);
    expect(last(short.outputs)).toEqual({ type: "release" });
  });

  test("armed shows once the finger is past the commit distance", () => {
    const { outputs } = run(drag(100, 100, -100, 0, 400));
    const moves = outputs.filter((output) => output.type === "move");
    expect(moves.some((output) => output.armed)).toBe(true);
    expect(
      moves
        .filter((output) => Math.abs(output.offset.x) < 80)
        .every((o) => !o.armed),
    ).toBe(true);
  });

  test("past the commit distance the content rubber-bands", () => {
    expect(rubberBand(40, 80)).toBe(40);
    expect(rubberBand(80, 80)).toBe(80);
    const past = rubberBand(160, 80);
    expect(past).toBeGreaterThan(80);
    expect(past).toBeLessThan(130);
    const { outputs } = run(drag(100, 100, 160, 0, 400));
    const moved = last(outputs);
    if (moved.type !== "move") throw new Error(moved.type);
    expect(moved.offset.x).toBeCloseTo(past);
  });
});

describe("velocity", () => {
  test("a quick flick commits short of the commit distance", () => {
    const { outputs } = run([...drag(100, 100, 50, 0, 60), up(150, 100, 64)]);
    expect(commits(outputs)).toEqual(["right"]);
  });

  test("a slow drag the same length does not", () => {
    const { outputs } = run([...drag(100, 100, 50, 0, 700), up(150, 100, 716)]);
    expect(commits(outputs)).toEqual([]);
  });

  test("a flick back toward the start cancels even past the commit distance", () => {
    // Out to 160 px, then back to 90 px in 30 ms: still past the commit distance.
    const inputs = [
      ...drag(100, 100, -160, 0, 400),
      move(-40, 100, 410),
      move(-20, 100, 420),
      move(10, 100, 430),
      up(10, 100, 432),
    ];
    const { outputs } = run(inputs);
    expect(commits(outputs)).toEqual([]);
  });
});

describe("reversing", () => {
  test("a swipe can turn back past its start into the other allowed direction", () => {
    const inputs = [
      ...drag(100, 100, -40, 0, 200),
      ...drag(60, 100, 140, 0, 400, 200).slice(1),
      up(200, 100, 900),
    ];
    const { outputs } = run(inputs);
    expect(commits(outputs)).toEqual(["right"]);
  });

  test("a direction that is not allowed resists and never commits", () => {
    const options = { ...config, directions: ["left"] as Direction[] };
    const { outputs } = run(
      [...drag(100, 100, 200, 0, 300), up(300, 100, 320)],
      options,
    );
    expect(commits(outputs)).toEqual([]);
    const moved = outputs.filter((output) => output.type === "move");
    const furthest = Math.max(...moved.map((output) => output.offset.x));
    expect(furthest).toBeLessThan(40);
    expect(moved.every((output) => output.direction === null)).toBe(true);
  });

  test("an axis with no allowed direction is left to the page: no claim", () => {
    const options = { ...config, directions: ["left", "right"] as Direction[] };
    const { outputs } = run(
      [...drag(100, 100, 4, 120, 200), up(104, 220, 210)],
      options,
    );
    expect(outputs.every((output) => output.type === "none")).toBe(true);
  });

  test("down commits on the vertical axis", () => {
    const { outputs } = run([
      ...drag(100, 100, 6, 100, 300),
      up(106, 200, 310),
    ]);
    expect(commits(outputs)).toEqual(["down"]);
  });
});

describe("hold versus swipe", () => {
  test("a touch held still past the hold time never becomes a swipe", () => {
    const inputs = [
      down(100, 100, 0),
      move(101, 100, 100),
      move(100, 101, 260),
      ...drag(100, 101, -150, 0, 200, 300).slice(1),
      up(-50, 101, 520),
    ];
    const { outputs } = run(inputs);
    expect(outputs.every((output) => output.type === "none")).toBe(true);
  });

  test("a swipe that starts inside the hold time goes on as long as it likes", () => {
    const inputs = [
      down(100, 100, 0),
      move(80, 100, 100),
      move(40, 100, 500),
      move(0, 100, 900),
      up(0, 100, 920),
    ];
    expect(commits(run(inputs).outputs)).toEqual(["left"]);
  });
});

describe("cancel and multi-touch", () => {
  test("a cancelled touch springs back and commits nothing", () => {
    const inputs: SwipeInput[] = [
      ...drag(100, 100, -100, 0, 200),
      { type: "cancel", id: 1, x: 0, y: 100, at: 210 },
    ];
    const { outputs, state } = run(inputs);
    expect(last(outputs)).toEqual({ type: "release" });
    expect(commits(outputs)).toEqual([]);
    expect(state.phase).toBe("idle");
  });

  test("a second finger stops a swipe under way, and nothing commits", () => {
    const inputs = [
      ...drag(100, 100, -100, 0, 200),
      down(300, 300, 210, 2),
      up(0, 100, 220),
      up(300, 300, 230, 2),
    ];
    const { outputs, state } = run(inputs);
    expect(outputs[outputs.length - 3]).toEqual({ type: "release" });
    expect(commits(outputs)).toEqual([]);
    expect(state.phase).toBe("idle");
  });

  test("two fingers down together (two hands to start) never swipe", () => {
    const inputs = [
      down(100, 100, 0, 1),
      down(300, 100, 20, 2),
      move(40, 100, 60, 1),
      move(0, 100, 100, 1),
      up(0, 100, 120, 1),
      up(300, 100, 130, 2),
    ];
    const { outputs } = run(inputs);
    expect(outputs.every((output) => output.type === "none")).toBe(true);
  });

  test("after every finger has lifted the next touch can swipe again", () => {
    const inputs = [
      down(100, 100, 0, 1),
      down(300, 100, 20, 2),
      up(100, 100, 40, 1),
      up(300, 100, 50, 2),
      ...drag(100, 100, -100, 0, 200, 100).map((input) => ({
        ...input,
        id: 3,
      })),
      up(0, 100, 320, 3),
    ];
    expect(commits(run(inputs).outputs)).toEqual(["left"]);
  });

  test("moves of another finger than the one that started are ignored", () => {
    const inputs = [down(100, 100, 0, 1), move(0, 100, 50, 7)];
    expect(run(inputs).outputs.every((output) => output.type === "none")).toBe(
      true,
    );
  });
});
