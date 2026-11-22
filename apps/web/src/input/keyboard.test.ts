import {
  createTimerState,
  DEFAULT_TIMER_CONFIG,
  reduceTimer,
  type TimerEffect,
  type TimerInput,
  type TimerPhase,
} from "@cubehaus/timer";
import { expect, test, vi } from "vitest";
import { bindKeyboard } from "./keyboard";

function setup(
  phase: TimerPhase = "idle",
  options?: Parameters<typeof bindKeyboard>[3],
) {
  const target = new EventTarget();
  const inputs: TimerInput[] = [];
  const unbind = bindKeyboard(
    target,
    (input) => inputs.push(input),
    () => phase,
    options,
  );
  function emit(type: string, fields: Record<string, unknown> = {}) {
    const event = new Event(type, { cancelable: true });
    for (const [key, value] of Object.entries(fields))
      Object.defineProperty(event, key, { value });
    target.dispatchEvent(event);
    return event;
  }
  return {
    inputs,
    emit,
    unbind,
    setPhase: (value: TimerPhase) => {
      phase = value;
    },
  };
}

test("Space dispatches press and release using event timestamps", () => {
  const { inputs, emit } = setup();
  expect(
    emit("keydown", { code: "Space", timeStamp: 10 }).defaultPrevented,
  ).toBe(true);
  emit("keyup", { code: "Space", timeStamp: 20 });
  expect(inputs).toEqual([
    { type: "press", at: 10 },
    { type: "release", at: 20 },
  ]);
});
test("ignores repeated keydowns", () => {
  const { inputs, emit } = setup();
  emit("keydown", { code: "Space", repeat: true });
  expect(inputs).toEqual([]);
});
test.each(["metaKey", "ctrlKey", "altKey"])(
  "ignores %s + Space and its release",
  (modifier) => {
    const { inputs, emit } = setup();
    emit("keydown", { code: "Space", [modifier]: true });
    emit("keyup", { code: "Space" });
    expect(inputs).toEqual([]);
  },
);
test.each([
  { tagName: "INPUT" },
  { tagName: "TEXTAREA" },
  { isContentEditable: true },
  { tagName: "BUTTON" },
])("ignores editable or interactive targets %j", (target) => {
  const { inputs, emit } = setup();
  emit("keydown", { code: "Space", target });
  emit("keyup", { code: "Space", target });
  expect(inputs).toEqual([]);
});
test("any ordinary key stops a running timer and releases it", () => {
  const { inputs, emit } = setup("running");
  emit("keydown", { code: "KeyA", timeStamp: 10 });
  emit("keyup", { code: "KeyA", timeStamp: 20 });
  expect(inputs).toEqual([
    { type: "press", at: 10 },
    { type: "release", at: 20 },
  ]);
});
test.each<TimerPhase>(["idle", "holding", "ready", "stopped"])(
  "ignores KeyA in %s",
  (phase) => {
    const { inputs, emit } = setup(phase);
    emit("keydown", { code: "KeyA" });
    expect(inputs).toEqual([]);
  },
);
test("Escape dispatches cancel", () => {
  const { inputs, emit } = setup();
  emit("keydown", { code: "Escape", timeStamp: 30 });
  expect(inputs).toEqual([{ type: "cancel", at: 30 }]);
});
test("blur dispatches blur and forgets the held key", () => {
  const { inputs, emit } = setup();
  emit("keydown", { code: "Space", timeStamp: 1 });
  emit("blur", { timeStamp: 2 });
  emit("keyup", { code: "Space", timeStamp: 3 });
  expect(inputs).toEqual([
    { type: "press", at: 1 },
    { type: "blur", at: 2 },
  ]);
});
test("unbind removes all listeners", () => {
  const { inputs, emit, unbind } = setup();
  unbind();
  emit("keydown", { code: "Space" });
  emit("keyup", { code: "Space" });
  emit("blur");
  expect(inputs).toEqual([]);
});
test.each([
  { code: "MetaLeft", metaKey: true },
  { code: "ControlRight", ctrlKey: true },
  { code: "AltLeft", altKey: true },
])("a modifier key alone stops a running timer: %j", (fields) => {
  const { inputs, emit } = setup("running");
  expect(emit("keydown", { ...fields, timeStamp: 10 }).defaultPrevented).toBe(
    true,
  );
  emit("keyup", { code: fields.code, timeStamp: 20 });
  expect(inputs).toEqual([
    { type: "press", at: 10 },
    { type: "release", at: 20 },
  ]);
});
test("Space with a modifier held stops a running timer", () => {
  const { inputs, emit } = setup("running");
  emit("keydown", { code: "Space", metaKey: true, timeStamp: 10 });
  expect(inputs).toEqual([{ type: "press", at: 10 }]);
});
test("a focused button cannot keep a running timer from stopping", () => {
  const { inputs, emit } = setup("running");
  const event = emit("keydown", {
    code: "Space",
    target: { tagName: "BUTTON" },
    timeStamp: 10,
  });
  expect(event.defaultPrevented).toBe(true);
  expect(inputs).toEqual([{ type: "press", at: 10 }]);
});
test.each<TimerPhase>(["holding", "ready"])(
  "a modifier key ends a hold in %s",
  (phase) => {
    for (const fields of [
      { code: "MetaLeft", metaKey: true },
      { code: "ControlLeft", ctrlKey: true },
      { code: "AltRight", altKey: true },
    ]) {
      const { inputs, emit } = setup(phase);
      emit("keydown", { code: "Space", timeStamp: 1 });
      emit("keydown", { ...fields, timeStamp: 2 });
      emit("keyup", { code: "Space", timeStamp: 3 });
      expect(inputs).toEqual([
        { type: "press", at: 1 },
        { type: "cancel", at: 2 },
      ]);
    }
  },
);
test("a modifier key in idle dispatches nothing", () => {
  const { inputs, emit } = setup("idle");
  emit("keydown", { code: "MetaLeft", metaKey: true });
  expect(inputs).toEqual([]);
});
test("a repeated Space is default-prevented so it cannot scroll", () => {
  const { inputs, emit } = setup("holding");
  expect(
    emit("keydown", { code: "Space", repeat: true }).defaultPrevented,
  ).toBe(true);
  expect(inputs).toEqual([]);
});
test("a repeated Space in a text field keeps its default", () => {
  const { emit } = setup();
  expect(
    emit("keydown", {
      code: "Space",
      repeat: true,
      target: { tagName: "INPUT" },
    }).defaultPrevented,
  ).toBe(false);
});

test("a fresh key stops a running solve while Space is still held", () => {
  const { inputs, emit, setPhase } = setup("holding");
  emit("keydown", { code: "Space", timeStamp: 100 });
  setPhase("running"); // The finger releases at 400 while Space stays down.
  emit("keydown", { code: "KeyA", timeStamp: 1400 });
  setPhase("stopped");
  emit("keyup", { code: "Space", timeStamp: 1500 });
  emit("keyup", { code: "KeyA", timeStamp: 1600 });
  expect(inputs).toEqual([
    { type: "press", at: 100 },
    { type: "press", at: 1400 },
    { type: "release", at: 1600 },
  ]);
});

test("routes shortcuts through the key state before filtering interactive targets", () => {
  const handle = vi.fn(() => true);
  const { emit, inputs } = setup("idle", { handle });
  const event = emit("keydown", {
    code: "KeyK",
    ctrlKey: true,
    target: { tagName: "INPUT" },
  });
  expect(handle).toHaveBeenCalledWith(event, "typing");
  expect(event.defaultPrevented).toBe(true);
  expect(inputs).toEqual([]);
});

test("a modal permits its shortcuts and blocks timer input from the background", () => {
  const handle = vi.fn(() => false);
  const { emit, inputs } = setup("idle", { handle, modal: () => true });
  const event = emit("keydown", { code: "Space" });
  emit("keyup", { code: "Space" });
  expect(handle).toHaveBeenCalledWith(event, "modal");
  expect(inputs).toEqual([]);
});

function twoHandTimer(inspectionMs: number | null = null) {
  let state = createTimerState();
  const effects: TimerEffect[] = [];
  const config = { ...DEFAULT_TIMER_CONFIG, holdMs: 300, inspectionMs };
  const target = new EventTarget();
  bindKeyboard(
    target,
    (input) => {
      const result = reduceTimer(state, input, config);
      state = result.state;
      effects.push(...result.effects);
    },
    () => state.phase,
    {
      handCodes: ["ControlLeft", "ControlRight"],
      startMode: "two-hand",
      holdMs: 300,
      handle: () => false,
    },
  );
  function key(
    type: "keydown" | "keyup",
    code: string,
    at: number,
    repeat = false,
  ) {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, {
      code: { value: code },
      timeStamp: { value: at },
      repeat: { value: repeat },
      ctrlKey: { value: code.startsWith("Control") },
    });
    target.dispatchEvent(event);
  }
  return {
    effects,
    phase: () => state.phase,
    down: (code: string, at: number, repeat?: boolean) =>
      key("keydown", code, at, repeat),
    up: (code: string, at: number) => key("keyup", code, at),
    blur: () => target.dispatchEvent(new Event("blur")),
  };
}

test("two-hand release starts once from the last release timestamp", () => {
  const timer = twoHandTimer();
  timer.down("ControlLeft", 1000);
  expect(timer.phase()).toBe("idle");
  timer.down("ControlRight", 1100);
  expect(timer.phase()).toBe("holding");
  timer.down("ControlRight", 1350, true);
  timer.up("ControlLeft", 1400);
  expect(timer.phase()).not.toBe("running");
  timer.up("ControlRight", 1420);
  expect(timer.phase()).toBe("running");
  timer.up("ControlLeft", 1500);
  timer.down("KeyA", 2654);
  timer.up("KeyA", 2655);
  expect(timer.effects).toEqual([
    expect.objectContaining({ type: "solve", startedAt: 1420, timeMs: 1234 }),
  ]);
});

test("releasing the first hand at 1399 or losing focus prevents a later start", () => {
  for (const blur of [false, true]) {
    const timer = twoHandTimer();
    timer.down("ControlLeft", 1000);
    timer.down("ControlRight", 1100);
    if (blur) timer.blur();
    else timer.up("ControlLeft", 1399);
    timer.up("ControlRight", 1420);
    timer.up("ControlLeft", 1421);
    expect(timer.phase()).toBe("idle");
    expect(timer.effects).toEqual([]);
  }
});

test("the first pair starts inspection and the next valid pair starts timing", () => {
  const timer = twoHandTimer(15_000);
  timer.down("ControlLeft", 1000);
  timer.down("ControlRight", 1100);
  timer.up("ControlRight", 1110);
  expect(timer.phase()).toBe("idle");
  timer.up("ControlLeft", 1120);
  expect(timer.phase()).toBe("inspecting");
  timer.down("ControlRight", 2000);
  timer.down("ControlLeft", 2100);
  timer.up("ControlRight", 2399);
  timer.up("ControlLeft", 2420);
  expect(timer.phase()).toBe("inspecting");
  timer.down("ControlRight", 3000);
  timer.down("ControlLeft", 3100);
  timer.up("ControlRight", 3400);
  timer.up("ControlLeft", 3420);
  expect(timer.phase()).toBe("running");
  timer.down("KeyA", 4654);
  expect(timer.effects).toEqual([
    { type: "inspectionStarted", at: 1120 },
    expect.objectContaining({
      type: "solve",
      startedAt: 3420,
      timeMs: 1234,
      inspectionMs: 2300,
    }),
  ]);
});

test("a shortcut clears a partial hand pair", () => {
  const timer = twoHandTimer();
  timer.down("ControlLeft", 1000);
  timer.down("KeyK", 1100);
  timer.down("ControlRight", 1200);
  timer.up("ControlRight", 1600);
  timer.up("ControlLeft", 1700);
  expect(timer.phase()).toBe("idle");
  expect(timer.effects).toEqual([]);
});
