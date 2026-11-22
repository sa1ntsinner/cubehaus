import { EVENTS, multiLimitMs, resultValue } from "@cubehaus/core";
import {
  createTimerState,
  OFFICIAL_TIMER_CONFIG,
  reduceTimer,
} from "@cubehaus/timer";
import { afterEach, expect, test, vi } from "vitest";
import * as seedLoader from "./load";
import { loadSeed } from "./load";

import { parseSeed, seededSolves } from "./seed";

afterEach(() => vi.unstubAllEnvs());

test("a normal build ignores a valid state even when fixture axes are present", async () => {
  vi.stubEnv("VITE_TEST_HOOKS", undefined);
  expect(await loadSeed("?state=running&theme=dark&lang=ru")).toBeUndefined();
  vi.stubEnv("VITE_TEST_HOOKS", "0");
  expect(await loadSeed("?state=running")).toBeUndefined();
  vi.stubEnv("VITE_TEST_HOOKS", "1");
  expect(await loadSeed("?state=running")).toMatchObject({ state: "running" });
});

test("validates the state and optional axes, including every registered event", () => {
  expect(parseSeed("")).toBeUndefined();
  expect(parseSeed("?state=unknown")).toBeUndefined();
  expect(parseSeed("?state=event-unknown")).toBeUndefined();
  expect(parseSeed("?state=empty&theme=invalid&lang=de")).toMatchObject({
    settings: { theme: "system", language: "en" },
  });
  expect(parseSeed("?state=inspect-15&theme=light&lang=ru")).toMatchObject({
    phase: "inspecting",
    settings: { theme: "light", language: "ru" },
    timer: { elapsedMs: 15_000 },
  });
  for (const { id } of EVENTS)
    expect(parseSeed(`?state=event-${id}`)).toMatchObject({ event: id });
});

test("the seeded session has 60 repeatable solves with the specified penalties and newest PB", () => {
  const seed = parseSeed("?state=session");
  if (!seed) throw new Error("Missing session fixture");
  const solves = seededSolves(seed, "session");
  expect(seededSolves(seed, "session")).toEqual(solves);
  expect(solves).toHaveLength(60);
  expect(solves.filter((solve) => solve.plus2 === 1)).toHaveLength(1);
  expect(solves.filter((solve) => solve.plus2 === 2)).toHaveLength(1);
  expect(solves.filter((solve) => solve.dnf)).toHaveLength(1);
  const newest = solves.at(-1);
  if (!newest) throw new Error("Missing newest solve");
  expect(resultValue(newest)).toBeLessThan(
    Math.min(...solves.slice(0, -1).map(resultValue)),
  );
});

test("a sizes parameter sets each part in order and ignores a value off the scale", () => {
  expect(
    parseSeed("?state=sizes-large&sizes=70,150,150,70,150")?.settings.sizes,
  ).toEqual({
    scramble: 70,
    picture: 150,
    time: 150,
    averages: 70,
    times: 150,
  });
  expect(
    parseSeed("?state=session&sizes=150,135,x")?.settings.sizes,
  ).toMatchObject({ scramble: 150, picture: 100, time: 100 });
  expect(parseSeed("?state=sizes-small")?.settings.sizes.time).toBe(70);
});

test("the three-cube Multi-Blind and long fixtures stay within their specified limits", () => {
  const multi = parseSeed("?state=mbld");
  const long = parseSeed("?state=long");
  if (!multi || !long) throw new Error("Missing fixtures");
  const [result] = seededSolves(multi, "multi");
  expect(result).toMatchObject({ cubesAttempted: 3, cubesSolved: 3 });
  expect(result?.timeMs).toBeLessThanOrEqual(multiLimitMs(3));
  expect(long).toMatchObject({ event: "777" });
  expect(long.name).toHaveLength(60);
  expect(seededSolves(long, "long")[0]?.timeMs).toBe(3_723_000);
});

test.each([
  ["holding", "holding"],
  ["ready", "ready"],
  ["inspect-8", "inspecting"],
  ["running", "running"],
  ["stopped", "stopped"],
  ["stopped-plus2", "stopped"],
  ["stopped-dnf", "stopped"],
  ["too-short", "idle"],
] as const)("replays %s into the actual %s timer phase", (name, expected) => {
  const seed = parseSeed(`?state=${name}`);
  if (!seed?.timer) throw new Error("Missing timer fixture");
  const config = {
    ...OFFICIAL_TIMER_CONFIG,
    inspectionMs: seed.settings.inspection === "off" ? null : 15_000,
  };
  const result = seed.timer.steps.reduce(
    (previous, step) => reduceTimer(previous.state, step, config),
    { state: createTimerState(), effects: [] } as ReturnType<
      typeof reduceTimer
    >,
  );
  expect(result.state.phase).toBe(expected);
  if (name === "stopped-plus2")
    expect(result.effects).toContainEqual(
      expect.objectContaining({ type: "solve", plus2: 1, dnf: false }),
    );
  if (name === "stopped-dnf")
    expect(result.effects).toContainEqual(
      expect.objectContaining({ type: "solve", plus2: 0, dnf: true }),
    );
  if (name === "too-short")
    expect(result.effects).toContainEqual({ type: "tooShort", timeMs: 42 });
});

test("validates the performance fixture count and ignores it outside test builds", async () => {
  expect(seedLoader.performanceCount("?seed=100000")).toBe(100_000);
  expect(seedLoader.performanceCount("?seed=0")).toBeUndefined();
  expect(seedLoader.performanceCount("?seed=1e5")).toBeUndefined();
  expect(seedLoader.performanceCount("?seed=100001")).toBeUndefined();
  vi.stubEnv("VITE_TEST_HOOKS", "0");
  expect(loadSeed("?seed=100000")).toBeUndefined();
});
