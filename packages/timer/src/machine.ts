import { inspectionPenalty } from "@cubehaus/core";

export type TimerPhase =
  | "idle"
  | "inspecting"
  | "holding"
  | "ready"
  | "running"
  | "stopped";

export interface TimerState {
  phase: TimerPhase;
  // Set from the release that starts inspection until the solve starts or
  // inspection is cancelled, through holding and ready.
  inspectionStartedAt: number | null;
  // The last call already made: 0, then 8, then 12.
  called: 0 | 8 | 12;
  // In `idle` with inspection on, the press that will start inspection when
  // it is released.
  holdStartedAt: number | null;
  startedAt: number | null;
  // Inspection of the running solve, kept until it stops.
  inspectionMs: number | null;
  resultMs: number | null;
}

export type TimerInput =
  | { type: "press"; at: number }
  | { type: "release"; at: number }
  | { type: "tick"; at: number }
  | { type: "cancel"; at: number }
  | { type: "blur"; at: number };

export type TimerEffect =
  | { type: "inspectionStarted"; at: number }
  | { type: "call"; seconds: 8 | 12 }
  | { type: "inspectionCancelled" }
  | {
      type: "solve";
      timeMs: number;
      startedAt: number;
      inspectionMs: number | null;
      plus2: number;
      dnf: boolean;
    }
  | { type: "tooShort"; timeMs: number }
  | { type: "discarded" };

export interface TimerConfig {
  holdMs: number;
  // 15000 for the official 15 seconds, or null for no inspection.
  inspectionMs: number | null;
  // A stop strictly below this is not a solve (A6b1: 60 ms).
  minSolveMs: number;
}

// What the timer does when nothing else is said: no inspection, every stop
// is a solve. The app's official settings use OFFICIAL_TIMER_CONFIG.
export const DEFAULT_TIMER_CONFIG: TimerConfig = {
  holdMs: 300,
  inspectionMs: null,
  minSolveMs: 0,
};

export const OFFICIAL_TIMER_CONFIG: TimerConfig = {
  holdMs: 300,
  inspectionMs: 15000,
  minSolveMs: 60,
};

export function createTimerState(): TimerState {
  return {
    phase: "idle",
    inspectionStartedAt: null,
    called: 0,
    holdStartedAt: null,
    startedAt: null,
    inspectionMs: null,
    resultMs: null,
  };
}

type Result = { state: TimerState; effects: readonly TimerEffect[] };

function calls(state: TimerState, at: number): Result {
  if (state.inspectionStartedAt === null) return { state, effects: [] };
  const elapsed = at - state.inspectionStartedAt;
  const effects: TimerEffect[] = [];
  let called = state.called;
  if (called < 8 && elapsed >= 8000) {
    effects.push({ type: "call", seconds: 8 });
    called = 8;
  }
  if (called < 12 && elapsed >= 12000) {
    effects.push({ type: "call", seconds: 12 });
    called = 12;
  }
  return effects.length === 0
    ? { state, effects }
    : { state: { ...state, called }, effects };
}

export function reduceTimer(
  state: TimerState,
  input: TimerInput,
  config: TimerConfig = DEFAULT_TIMER_CONFIG,
): Result {
  const unchanged = { state, effects: [] };
  const idle = { ...createTimerState(), resultMs: state.resultMs };
  const inspecting = state.inspectionStartedAt !== null;

  if (input.type === "cancel" || input.type === "blur") {
    if (inspecting)
      return { state: idle, effects: [{ type: "inspectionCancelled" }] };
    if (state.phase === "idle")
      return state.holdStartedAt === null
        ? unchanged
        : { state: idle, effects: [] };
    if (state.phase === "running")
      return input.type === "cancel"
        ? { state: idle, effects: [{ type: "discarded" }] }
        : unchanged;
    return { state: idle, effects: [] };
  }

  const hold = {
    state: {
      ...state,
      phase: config.holdMs === 0 ? "ready" : "holding",
      holdStartedAt: input.at,
    } satisfies TimerState,
    effects: [],
  };

  switch (state.phase) {
    case "idle": {
      if (config.inspectionMs === null)
        return input.type === "press" ? hold : unchanged;
      // With inspection, one press and release starts it, however long the
      // press. Only a release that follows a press here counts.
      if (input.type === "press")
        return { state: { ...state, holdStartedAt: input.at }, effects: [] };
      if (input.type === "release" && state.holdStartedAt !== null)
        return {
          state: {
            ...idle,
            phase: "inspecting",
            inspectionStartedAt: input.at,
          },
          effects: [{ type: "inspectionStarted", at: input.at }],
        };
      return unchanged;
    }
    case "inspecting":
      if (input.type === "press") return hold;
      if (input.type === "tick") return calls(state, input.at);
      return unchanged;
    case "holding":
    case "ready": {
      // A press here means the previous release was lost: start the hold again.
      if (input.type === "press") return hold;
      // Each input is judged by its own timestamp. The `ready` phase is for
      // display only and never decides whether a release starts a solve.
      const ready =
        state.holdStartedAt !== null &&
        input.at - state.holdStartedAt >= config.holdMs;
      if (input.type === "tick") {
        const called = calls(state, input.at);
        return state.phase === "holding" && ready
          ? {
              state: { ...called.state, phase: "ready" },
              effects: called.effects,
            }
          : called;
      }
      if (input.type !== "release") return unchanged;
      if (!ready)
        return inspecting
          ? {
              state: { ...state, phase: "inspecting", holdStartedAt: null },
              effects: [],
            }
          : { state: idle, effects: [] };
      return {
        state: {
          ...idle,
          phase: "running",
          startedAt: input.at,
          resultMs: null,
          inspectionMs:
            state.inspectionStartedAt === null
              ? null
              : Math.floor(input.at - state.inspectionStartedAt),
        },
        effects: [],
      };
    }
    case "running": {
      if (input.type !== "press" || state.startedAt === null) return unchanged;
      const timeMs = Math.max(0, Math.floor(input.at - state.startedAt));
      if (timeMs < config.minSolveMs)
        return { state: idle, effects: [{ type: "tooShort", timeMs }] };
      // Inspection is read as a judge's stopwatch shows it, in hundredths.
      const penalty = inspectionPenalty(
        state.inspectionMs === null
          ? null
          : Math.floor(state.inspectionMs / 10) * 10,
      );
      return {
        state: { ...state, phase: "stopped", resultMs: timeMs },
        effects: [
          {
            type: "solve",
            timeMs,
            startedAt: state.startedAt,
            inspectionMs: state.inspectionMs,
            ...penalty,
          },
        ],
      };
    }
    case "stopped":
      return input.type === "release"
        ? { state: idle, effects: [] }
        : unchanged;
  }
}
