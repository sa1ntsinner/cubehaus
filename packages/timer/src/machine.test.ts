import { expect, test } from "vitest";
import {
  createTimerState,
  DEFAULT_TIMER_CONFIG,
  reduceTimer,
  type TimerInput,
} from "./index";

type Step = [TimerInput["type"], number];
function run(steps: Step[], holdMs = 300) {
  let result = { state: createTimerState(), effects: [] } as ReturnType<
    typeof reduceTimer
  >;
  for (const [type, at] of steps)
    result = reduceTimer(
      result.state,
      { type, at },
      { ...DEFAULT_TIMER_CONFIG, holdMs },
    );
  return result;
}
const start: Step[] = [
  ["press", 0],
  ["release", 400],
];
const stop: Step[] = [...start, ["press", 12745]];

test("short hold returns to idle", () => {
  expect(
    run([
      ["press", 0],
      ["release", 100],
    ]),
  ).toEqual({ state: createTimerState(), effects: [] });
});
test("hold is not ready at 299 ms", () => {
  expect(
    run([
      ["press", 0],
      ["tick", 299],
    ]).state.phase,
  ).toBe("holding");
});
test("hold becomes ready at 300 ms", () => {
  expect(
    run([
      ["press", 0],
      ["tick", 300],
    ]).state.phase,
  ).toBe("ready");
});
test("release starts without a tick", () => {
  expect(
    run([
      ["press", 0],
      ["release", 300],
    ]).state,
  ).toMatchObject({ phase: "running", startedAt: 300 });
});
test("stop subtracts input timestamps and emits a solve", () => {
  expect(run(stop)).toEqual({
    state: {
      ...createTimerState(),
      phase: "stopped",
      startedAt: 400,
      resultMs: 12345,
    },
    effects: [
      {
        type: "solve",
        timeMs: 12345,
        startedAt: 400,
        inspectionMs: null,
        plus2: 0,
        dnf: false,
      },
    ],
  });
});
test("release after stop returns to idle and keeps the result", () => {
  expect(run([...stop, ["release", 12800]])).toEqual({
    state: { ...createTimerState(), resultMs: 12345 },
    effects: [],
  });
});
test("press after stop and release starts holding", () => {
  expect(
    run([...stop, ["release", 12800], ["press", 13000]]).state,
  ).toMatchObject({
    phase: "holding",
    holdStartedAt: 13000,
    resultMs: 12345,
  });
});
test("cancel discards a running solve", () => {
  expect(run([...start, ["cancel", 900]])).toEqual({
    state: createTimerState(),
    effects: [{ type: "discarded" }],
  });
});
test("cancel during a hold returns to idle without effects", () => {
  expect(
    run([
      ["press", 0],
      ["cancel", 100],
    ]),
  ).toEqual({ state: createTimerState(), effects: [] });
});
test("a release is judged by its own timestamp, not by a later tick", () => {
  expect(
    run([
      ["press", 0],
      ["tick", 400],
      ["release", 100],
    ]),
  ).toEqual({ state: createTimerState(), effects: [] });
});
test("a press during a hold starts a new hold", () => {
  expect(
    run([
      ["press", 0],
      ["tick", 400],
      ["press", 5000],
    ]).state,
  ).toMatchObject({ phase: "holding", holdStartedAt: 5000 });
});
test("a short tap after a lost release does not start a solve", () => {
  expect(
    run([
      ["press", 0],
      ["tick", 400],
      ["press", 5000],
      ["release", 5050],
    ]).state.phase,
  ).toBe("idle");
});
test("release from idle preserves the state object", () => {
  const state = createTimerState();
  expect(reduceTimer(state, { type: "release", at: 10 }).state).toBe(state);
});
test("press while stopped preserves the state object", () => {
  const { state } = run(stop);
  expect(reduceTimer(state, { type: "press", at: 12800 }).state).toBe(state);
});
test("blur during a hold returns to idle", () => {
  expect(
    run([
      ["press", 0],
      ["blur", 100],
    ]),
  ).toEqual({ state: createTimerState(), effects: [] });
});
test("blur during a solve leaves it running unchanged", () => {
  const { state } = run(start);
  const result = reduceTimer(state, { type: "blur", at: 900 });
  expect(result.state).toBe(state);
  expect(result.effects).toEqual([]);
});
test("blur after a stop returns to idle and keeps the result", () => {
  expect(run([...start, ["press", 700], ["blur", 750]])).toEqual({
    state: { ...createTimerState(), resultMs: 300 },
    effects: [],
  });
});
test("zero hold is immediately ready", () => {
  expect(run([["press", 0]], 0).state.phase).toBe("ready");
});
test("zero hold starts on release", () => {
  expect(
    run(
      [
        ["press", 0],
        ["release", 10],
      ],
      0,
    ).state,
  ).toMatchObject({ phase: "running", startedAt: 10 });
});
test("a stop timestamp before the start clamps the result to zero", () => {
  expect(run([...start, ["press", 399]]).state).toMatchObject({
    phase: "stopped",
    resultMs: 0,
  });
});
test("uses the fixed default config", () => {
  expect(DEFAULT_TIMER_CONFIG).toEqual({
    holdMs: 300,
    inspectionMs: null,
    minSolveMs: 0,
  });
});

test("floors fractional elapsed milliseconds in both state and effect", () => {
  const result = run([
    ["press", 0],
    ["release", 400.4],
    ["press", 12745.9],
  ]);
  expect(result.state.resultMs).toBe(12345);
  expect(result.effects).toEqual([
    {
      type: "solve",
      timeMs: 12345,
      startedAt: 400.4,
      inspectionMs: null,
      plus2: 0,
      dnf: false,
    },
  ]);
});

test("records parts from event timestamps, ignores bounce, and stops on the last part", () => {
  const config = {
    ...DEFAULT_TIMER_CONFIG,
    splitNames: ["Cross", "F2L", "LL"],
  };
  const press = (state: ReturnType<typeof createTimerState>, at: number) =>
    reduceTimer(state, { type: "press", at }, config);
  const running = run(start).state;
  const began = reduceTimer(
    press(createTimerState(), 0).state,
    { type: "release", at: 400.5 },
    config,
  ).state;
  expect(began.phase).toBe(running.phase);
  const first = press(began, 2225.25);
  expect(first.effects).toEqual([]);
  expect(first.state).toMatchObject({
    phase: "running",
    splits: [{ name: "Cross", durationMs: 1824 }],
  });
  expect(press(first.state, 2475).state).toBe(first.state);
  const second = press(first.state, 2475.25);
  expect(second.state.phase).toBe("running");
  const last = press(second.state, 5000);
  expect(last.state.phase).toBe("stopped");
  expect(last.effects).toMatchObject([
    {
      type: "solve",
      timeMs: 4599,
      splits: [
        { name: "Cross", durationMs: 1824 },
        { name: "F2L", durationMs: 250 },
        { name: "LL", durationMs: 2525 },
      ],
    },
  ]);
  const cancelled = reduceTimer(
    second.state,
    { type: "cancel", at: 3000 },
    config,
  );
  expect(cancelled.state).toEqual(createTimerState());
  expect(cancelled.effects).toEqual([{ type: "discarded" }]);
});
