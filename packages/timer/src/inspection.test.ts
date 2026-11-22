import { describe, expect, test } from "vitest";
import {
  createTimerState,
  OFFICIAL_TIMER_CONFIG,
  reduceTimer,
  type TimerConfig,
  type TimerEffect,
  type TimerInput,
  type TimerState,
} from "./index";

type Step = [TimerInput["type"], number];

function run(steps: Step[], config: TimerConfig = OFFICIAL_TIMER_CONFIG) {
  let state: TimerState = createTimerState();
  const effects: TimerEffect[] = [];
  for (const [type, at] of steps) {
    const result = reduceTimer(state, { type, at }, config);
    state = result.state;
    effects.push(...result.effects);
  }
  return { state, effects };
}

// Press and release at 0 starts inspection; the solve's hold starts at
// `start - 400` and is released at `start`; the stop comes 10 s later.
function solveStartingAt(start: number): Step[] {
  return [
    ["press", -100],
    ["release", 0],
    ["press", start - 400],
    ["release", start],
    ["press", start + 10_000],
  ];
}

function solveOf(steps: Step[]) {
  return run(steps).effects.find((effect) => effect.type === "solve");
}

describe("inspection (A3, A4)", () => {
  test("OFFICIAL_TIMER_CONFIG: 15 s of inspection, 300 ms hold, stops under 60 ms are not solves", () => {
    expect(OFFICIAL_TIMER_CONFIG).toEqual({
      holdMs: 300,
      inspectionMs: 15000,
      minSolveMs: 60,
    });
  });

  test("A3a1: a press and release starts inspection at the release", () => {
    const { state, effects } = run([
      ["press", 1000],
      ["release", 1050],
    ]);
    expect(state).toMatchObject({
      phase: "inspecting",
      inspectionStartedAt: 1050,
    });
    expect(effects).toEqual([{ type: "inspectionStarted", at: 1050 }]);
  });

  test("A3a1: a long press before inspection is not a hold", () => {
    expect(
      run([
        ["press", 0],
        ["tick", 2000],
      ]).state.phase,
    ).toBe("idle");
  });

  test("A3a1: 14,999 ms of inspection is clean", () => {
    expect(solveOf(solveStartingAt(14_999))).toMatchObject({
      inspectionMs: 14_999,
      plus2: 0,
      dnf: false,
    });
  });

  test("A3a1: 14.99 s of inspection is clean", () => {
    expect(solveOf(solveStartingAt(14_990))).toMatchObject({
      inspectionMs: 14_990,
      plus2: 0,
      dnf: false,
    });
  });

  test("A4d1+: 15,000 ms of inspection is +2", () => {
    expect(solveOf(solveStartingAt(15_000))).toMatchObject({
      plus2: 1,
      dnf: false,
    });
  });

  test("A4d1+: 16,999 ms of inspection is +2", () => {
    expect(solveOf(solveStartingAt(16_999))).toMatchObject({
      plus2: 1,
      dnf: false,
    });
  });

  test("A4d1+: 15.01 s of inspection is +2", () => {
    expect(solveOf(solveStartingAt(15_010))).toMatchObject({
      plus2: 1,
      dnf: false,
    });
  });

  test("A4d1+: 16.99 s of inspection is +2", () => {
    expect(solveOf(solveStartingAt(16_990))).toMatchObject({
      plus2: 1,
      dnf: false,
    });
  });

  test("A4d2+: 17,000 ms of inspection is DNF", () => {
    expect(solveOf(solveStartingAt(17_000))).toMatchObject({ dnf: true });
  });

  test("A4d2+: 17.01 s of inspection is DNF", () => {
    expect(solveOf(solveStartingAt(17_010))).toMatchObject({
      inspectionMs: 17_010,
      dnf: true,
    });
  });

  test("A4d1+: inspection is read in hundredths: 15,009 ms is 15.00 and +2, 14,999.9 is 14.99 and clean", () => {
    expect(solveOf(solveStartingAt(15_009))).toMatchObject({ plus2: 1 });
    expect(solveOf(solveStartingAt(14_999.9))).toMatchObject({ plus2: 0 });
  });

  test("A4d2+: inspection never ends by itself; a solve started after 17 s is a DNF", () => {
    const steps = solveStartingAt(40_000);
    expect(run(steps.slice(0, 2).concat([["tick", 39_000]])).state.phase).toBe(
      "inspecting",
    );
    expect(solveOf(steps)).toMatchObject({ dnf: true, timeMs: 10_000 });
  });

  test("the solve starts at the release that started it, not at inspection", () => {
    expect(solveOf(solveStartingAt(9_000))).toMatchObject({
      startedAt: 9_000,
      timeMs: 10_000,
    });
  });

  test("A3b3 A3b4: calls at 8 and 12 s, once each", () => {
    const { effects } = run([
      ["press", 0],
      ["release", 0],
      ["tick", 7_999],
      ["tick", 8_000],
      ["tick", 8_500],
      ["tick", 11_999],
      ["tick", 12_000],
      ["tick", 13_000],
    ]);
    expect(effects.filter((effect) => effect.type === "call")).toEqual([
      { type: "call", seconds: 8 },
      { type: "call", seconds: 12 },
    ]);
  });

  test("A3b3: a late tick gives both calls, 8 first", () => {
    const { effects } = run([
      ["press", 0],
      ["release", 0],
      ["tick", 12_500],
    ]);
    expect(effects.filter((effect) => effect.type === "call")).toEqual([
      { type: "call", seconds: 8 },
      { type: "call", seconds: 12 },
    ]);
  });

  test("calls keep coming while the solver holds during inspection", () => {
    const { effects } = run([
      ["press", 0],
      ["release", 0],
      ["press", 7_000],
      ["tick", 8_000],
    ]);
    expect(effects.at(-1)).toEqual({ type: "call", seconds: 8 });
  });

  test("no calls without inspection", () => {
    const { effects } = run(
      [
        ["press", 0],
        ["tick", 9_000],
        ["tick", 13_000],
      ],
      { ...OFFICIAL_TIMER_CONFIG, inspectionMs: null },
    );
    expect(effects).toEqual([]);
  });

  test("a release before the hold is ready goes back to inspecting with the same start", () => {
    const { state } = run([
      ["press", 0],
      ["release", 500],
      ["press", 3_000],
      ["release", 3_100],
    ]);
    expect(state).toMatchObject({
      phase: "inspecting",
      inspectionStartedAt: 500,
    });
  });

  for (const [name, steps] of [
    [
      "inspecting",
      [
        ["press", 0],
        ["release", 0],
      ],
    ],
    [
      "holding",
      [
        ["press", 0],
        ["release", 0],
        ["press", 1000],
      ],
    ],
    [
      "ready",
      [
        ["press", 0],
        ["release", 0],
        ["press", 1000],
        ["tick", 1400],
      ],
    ],
  ] as [string, Step[]][]) {
    for (const input of ["cancel", "blur"] as const) {
      test(`${input} while ${name} in inspection cancels it without a solve`, () => {
        const { state, effects } = run([...steps, [input, 2_000]]);
        expect(state.phase).toBe("idle");
        expect(state.inspectionStartedAt).toBeNull();
        expect(effects.at(-1)).toEqual({ type: "inspectionCancelled" });
        expect(effects.some((effect) => effect.type === "solve")).toBe(false);
      });
    }
  }

  test("A6b1: a stop at 59 ms is not a solve", () => {
    const { state, effects } = run(
      [
        ["press", 0],
        ["release", 300],
        ["press", 359],
        ["release", 400],
      ],
      { ...OFFICIAL_TIMER_CONFIG, inspectionMs: null },
    );
    expect(effects).toEqual([{ type: "tooShort", timeMs: 59 }]);
    expect(state.phase).toBe("idle");
  });

  test("A6b1: a stop at 60 ms is a solve", () => {
    const { effects } = run(
      [
        ["press", 0],
        ["release", 300],
        ["press", 360],
      ],
      { ...OFFICIAL_TIMER_CONFIG, inspectionMs: null },
    );
    expect(effects).toEqual([
      {
        type: "solve",
        timeMs: 60,
        startedAt: 300,
        inspectionMs: null,
        plus2: 0,
        dnf: false,
      },
    ]);
  });

  test("the release of a too-short stop does not start inspection", () => {
    const { state } = run([
      ["press", 0],
      ["release", 0],
      ["press", 1_000],
      ["release", 1_400],
      ["press", 1_420],
      ["release", 1_500],
    ]);
    expect(state.phase).toBe("idle");
  });
});
