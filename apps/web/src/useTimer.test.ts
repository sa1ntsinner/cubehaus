import type { EventId, Solve } from "@cubehaus/core";
import type { TimerEffect, TimerInput } from "@cubehaus/timer";
import { expect, test } from "vitest";
import { createCaller } from "./calls";
import type { Settings } from "./settings";
import { textFor } from "./text";
import {
  createTimerController,
  sessionTimerConfig,
  solveFromEffect,
} from "./useTimer";

test("dates the solve from the wall clock at the effect, without changing elapsed time", () => {
  const solve = solveFromEffect(
    {
      type: "solve",
      timeMs: 12345,
      startedAt: 400.4,
      inspectionMs: null,
      plus2: 0,
      dnf: false,
    },
    {
      sessionId: "current-session",
      event: "222",
      wallNow: 1_700_000_100_000,
      perfNow: 12_745.9,
      scramble: "R U",
      input: "touch",
    },
  );
  expect(solve).toMatchObject({
    event: "222",
    sessionId: "current-session",
    timeMs: 12345,
    plus2: 0,
    dnf: false,
    scramble: "R U",
    // 1_700_000_100_000 − (12_745.9 − 400.4) = 1_700_000_087_654.5
    startedAt: 1_700_000_087_655,
    inspectionMs: null,
    comment: null,
    input: "touch",
  });
  expect(solve.id).toMatch(/^[0-9a-f-]{36}$/);
});

function controller() {
  const solves: Solve[] = [];
  const starts: number[] = [];
  const timer = createTimerController({
    clock: () => ({ wall: 1_700_000_000_000, perf: 1_000_000 }),
    scramble: () => "R U",
    session: () => ({ id: "current-session", event: "333" }),
    onChange: (state) => {
      if (state.phase === "running" && state.startedAt !== null)
        starts.push(state.startedAt);
    },
    onSolve: (solve) => solves.push(solve),
  });
  const send = (
    source: "keyboard" | "touch",
    type: TimerInput["type"],
    at: number,
  ) => timer.dispatch({ type, at }, source);
  return { timer, solves, starts, send };
}

test("only the binding that started a hold can release it", () => {
  const { timer, starts, send } = controller();
  send("touch", "press", 0);
  send("keyboard", "press", 100);
  send("keyboard", "release", 150);
  send("touch", "release", 400);
  expect(starts).toEqual([400]);
  expect(timer.state).toMatchObject({ phase: "running", startedAt: 400 });
});

test("a solve records the binding that started it", () => {
  const { solves, send } = controller();
  send("touch", "press", 0);
  send("touch", "release", 400);
  send("keyboard", "press", 1400);
  expect(solves).toHaveLength(1);
  expect(solves[0]).toMatchObject({
    timeMs: 1000,
    input: "touch",
    scramble: "R U",
  });
});

test("the other binding can still cancel a hold", () => {
  const { timer, send } = controller();
  send("touch", "press", 0);
  send("keyboard", "cancel", 100);
  expect(timer.state.phase).toBe("idle");
});

test("ownership ends with the hold", () => {
  const { starts, send } = controller();
  send("touch", "press", 0);
  send("touch", "release", 100);
  send("keyboard", "press", 200);
  send("keyboard", "release", 600);
  expect(starts).toEqual([600]);
});

function officialAttempt({
  event = "333",
  inspection = "official",
  mode = "tick",
}: {
  event?: EventId;
  inspection?: Settings["inspection"];
  mode?: Settings["calls"];
} = {}) {
  let scramble = "R U";
  const solves: Solve[] = [];
  const effects: string[] = [];
  const noise: number[] = [];
  const caller = createCaller(
    () => ({ mode, language: "en", words: textFor("en").calls }),
    { noise: (count) => noise.push(count) },
  );
  const timer = createTimerController({
    clock: () => ({ wall: 1_700_000_000_000, perf: 20_000 }),
    scramble: () => scramble,
    session: () => ({ id: "session", event }),
    config: () => sessionTimerConfig(event, { inspection, holdMs: 300 }),
    onChange: () => {},
    onSolve: (solve) => solves.push(solve),
    onEffect: (effect: TimerEffect) => {
      effects.push(effect.type);
      if (effect.type === "call") caller.call(effect.seconds);
    },
  });
  return {
    timer,
    solves,
    effects,
    noise,
    send: (type: TimerInput["type"], at: number) =>
      timer.dispatch({ type, at }, "keyboard"),
    replace: () => {
      scramble = "F D";
    },
  };
}

test("A3b2, A4d1+: inspection locks the shown scramble and saves the penalty", () => {
  const { send, replace, solves } = officialAttempt();
  send("press", 0);
  send("release", 10);
  replace();
  send("press", 14_710);
  send("release", 15_010);
  send("press", 25_010);
  expect(solves).toMatchObject([
    { scramble: "R U", inspectionMs: 15_000, plus2: 1, dnf: false },
  ]);
  send("release", 25_011);
  send("press", 26_000);
  send("release", 26_010);
  send("press", 26_700);
  send("release", 27_010);
  send("press", 37_010);
  expect(solves[1]?.scramble).toBe("F D");
});

test.each(["cancel", "blur"] as const)(
  "%s during inspection emits cancellation, keeps the scramble and stores nothing",
  (end) => {
    const { send, timer, solves, effects } = officialAttempt();
    send("press", 0);
    send("release", 10);
    send(end, 2000);
    expect(timer.state.phase).toBe("idle");
    expect(solves).toEqual([]);
    expect(effects).toEqual(["inspectionStarted", "inspectionCancelled"]);
    send("press", 2100);
    send("release", 2110);
    send("press", 2300);
    send("release", 2600);
    send("press", 12_600);
    expect(solves[0]?.scramble).toBe("R U");
  },
);

test.each([
  { event: "333", inspection: "off" },
  { event: "444bf", inspection: "official" },
] as const)(
  "B1a: $event with inspection $inspection starts directly and locks on hold",
  (settings) => {
    const { send, replace, timer, solves } = officialAttempt(settings);
    send("press", 0);
    replace();
    send("release", 300);
    expect(timer.state.phase).toBe("running");
    send("press", 10_300);
    expect(solves).toMatchObject([{ inspectionMs: null, scramble: "R U" }]);
  },
);

test("A6b1: a 0.05 s stop stores nothing and offers a redo", () => {
  const { send, solves, effects } = officialAttempt({ inspection: "off" });
  send("press", 0);
  send("release", 300);
  send("press", 350);
  expect(solves).toEqual([]);
  expect(effects).toEqual(["tooShort"]);
});

test.each(["tick", "off"] as const)(
  "A3b3, A3b4: inspection calls once each at 8 s and 12 s with calls %s",
  (mode) => {
    const { send, noise } = officialAttempt({ mode });
    send("press", 0);
    send("release", 10);
    send("tick", 7910);
    expect(noise).toEqual([]);
    send("tick", 8010);
    send("tick", 8010);
    expect(noise).toEqual(mode === "tick" ? [1] : []);
    send("tick", 12_010);
    send("tick", 12_010);
    expect(noise).toEqual(mode === "tick" ? [1, 2] : []);
  },
);
