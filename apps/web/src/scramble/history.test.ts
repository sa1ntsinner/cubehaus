import type { Solve } from "@cubehaus/core";
import { expect, test } from "vitest";
import { createTimerController } from "../useTimer";
import { createScrambleHistory } from "./history";

/** A source that hands out the given scrambles in order, one per request, when told to. */
function scripted(values: string[]) {
  const asked: string[] = [];
  const waiting: Array<() => void> = [];
  let held = false;
  return {
    asked,
    hold() {
      held = true;
    },
    release() {
      held = false;
      for (const go of waiting.splice(0)) go();
    },
    source(key: string) {
      asked.push(key);
      const value = values.shift() ?? "?";
      return held
        ? new Promise<string>((resolve) => waiting.push(() => resolve(value)))
        : Promise.resolve(value);
    },
  };
}

test("back then forward reuses the same prepared scramble", async () => {
  const feed = scripted(["R", "U", "F", "L"]);
  const history = createScrambleHistory((key) => feed.source(key));
  history.reset("333");

  // The first previous has nothing to go back to.
  expect(await history.step(-1)).toBeNull();
  expect(await history.step(1)).toBe("R");
  expect(await history.step(1)).toBe("U");
  expect(await history.step(-1)).toBe("R");
  const solves: Solve[] = [];
  const timer = createTimerController({
    clock: () => ({ wall: 2000, perf: 1400 }),
    scramble: history.current,
    session: () => ({ id: "A", event: "333" }),
    onChange: () => {},
    onSolve: (solve) => solves.push(solve),
  });
  timer.dispatch({ type: "press", at: 0 });
  timer.dispatch({ type: "release", at: 400 });
  timer.dispatch({ type: "press", at: 1400 });
  expect(solves).toEqual([expect.objectContaining({ scramble: "R" })]);
  expect(await history.step(1)).toBe("U");
  expect(feed.asked).toEqual(["333", "333"]);
  expect(history.canStepBack()).toBe(true);

  // F is asked for 3×3, then the puzzle changes before it arrives: what 2×2 shows stays
  // 2×2's, and F waits in 3×3's history for when it comes back.
  feed.hold();
  const late = history.step(1);
  history.reset("222");
  expect(history.current()).toBeNull();
  expect(history.canStepBack()).toBe(false);
  const other = history.step(1);
  feed.release();
  expect(await other).toBe("L");
  expect(await late).toBeNull();
  expect(history.current()).toBe("L");
  history.reset("333");
  expect(history.current()).toBe("F");
  expect(await history.step(-1)).toBe("U");
});

test("each context keeps at most 32 scrambles and its own place", async () => {
  let n = 0;
  const history = createScrambleHistory(async (key) => `${key}-${++n}`);
  history.reset("a");
  for (let i = 0; i < 40; i++) await history.step(1);
  expect(history.current()).toBe("a-40");
  let back = 0;
  while ((await history.step(-1)) !== null) back++;
  expect(back).toBe(31);
  expect(history.current()).toBe("a-9");

  history.reset("b");
  expect(await history.step(1)).toBe("b-41");
  history.reset("a");
  expect(history.current()).toBe("a-9");
});

test("two quick steps forward wait for one request, and a failure leaves the place", async () => {
  let calls = 0;
  let fail = false;
  const history = createScrambleHistory(async () => {
    calls++;
    if (fail) throw new Error("no worker");
    return `s${calls}`;
  });
  history.reset("333");
  const [a, b] = await Promise.all([history.step(1), history.step(1)]);
  expect([a, b]).toEqual(["s1", "s1"]);
  expect(calls).toBe(1);
  fail = true;
  await expect(history.step(1)).rejects.toThrow("no worker");
  expect(history.current()).toBe("s1");
});

test("a late next scramble stays ahead after the user steps back", async () => {
  const feed = scripted(["R", "U", "F"]);
  const history = createScrambleHistory(feed.source);
  history.reset("333");
  await history.step(1);
  await history.step(1);
  feed.hold();
  const late = history.step(1);
  expect(await history.step(-1)).toBe("R");
  feed.release();
  expect(await late).toBeNull();
  expect(history.current()).toBe("R");
  expect(await history.step(1)).toBe("U");
  expect(await history.step(1)).toBe("F");
  expect(feed.asked).toHaveLength(3);
});
