import type { TimerInput, TimerPhase } from "@cubehaus/timer";
import { expect, test } from "vitest";
import { bindTouch } from "./touch";

function setup() {
  const target = new EventTarget();
  const inputs: TimerInput[] = [];
  let phase: TimerPhase = "idle";
  const unbind = bindTouch(
    target,
    (input) => inputs.push(input),
    () => phase,
  );
  function emit(
    type: string,
    pointerId: number,
    at: number,
    fields: Record<string, unknown> = {},
  ) {
    const event = new Event(type, { cancelable: true });
    const all: Record<string, unknown> = {
      pointerId,
      timeStamp: at,
      pointerType: "touch",
      button: 0,
      isPrimary: true,
      ...fields,
    };
    for (const [key, value] of Object.entries(all))
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

test("matching pointerdown and pointerup dispatch press and release", () => {
  const { inputs, emit } = setup();
  expect(emit("pointerdown", 1, 10).defaultPrevented).toBe(true);
  emit("pointerup", 1, 20);
  expect(inputs).toEqual([
    { type: "press", at: 10 },
    { type: "release", at: 20 },
  ]);
});
test("ignores a second finger and its release during a hold", () => {
  const { inputs, emit, setPhase } = setup();
  emit("pointerdown", 1, 10);
  setPhase("holding");
  emit("pointerdown", 2, 20, { isPrimary: false });
  emit("pointerup", 2, 30);
  emit("pointerup", 1, 40);
  expect(inputs).toEqual([
    { type: "press", at: 10 },
    { type: "release", at: 40 },
  ]);
});
test("a second finger stops a running timer and its release resets it", () => {
  const { inputs, emit, setPhase } = setup();
  emit("pointerdown", 1, 10);
  setPhase("running");
  emit("pointerdown", 2, 20, { isPrimary: false });
  emit("pointerup", 1, 30);
  emit("pointerup", 2, 40);
  expect(inputs).toEqual([
    { type: "press", at: 10 },
    { type: "press", at: 20 },
    { type: "release", at: 40 },
  ]);
});
test("pointercancel dispatches cancel", () => {
  const { inputs, emit } = setup();
  emit("pointerdown", 1, 10);
  emit("pointercancel", 1, 20);
  expect(inputs).toEqual([
    { type: "press", at: 10 },
    { type: "cancel", at: 20 },
  ]);
});
test("an unrelated pointercancel cannot cancel a hold", () => {
  const { inputs, emit } = setup();
  emit("pointerdown", 1, 10);
  emit("pointercancel", 2, 20);
  expect(inputs).toEqual([{ type: "press", at: 10 }]);
});
test("interactive controls remain usable while idle", () => {
  const { inputs, emit } = setup();
  expect(
    emit("pointerdown", 1, 10, { target: { tagName: "BUTTON" } })
      .defaultPrevented,
  ).toBe(false);
  expect(inputs).toEqual([]);
});
test("unbind removes pointer listeners", () => {
  const { inputs, emit, unbind } = setup();
  unbind();
  emit("pointerdown", 1, 10);
  emit("pointerup", 1, 20);
  emit("pointercancel", 1, 30);
  expect(inputs).toEqual([]);
});
test("a mouse pointer is not a timer input", () => {
  const { inputs, emit } = setup();
  const down = emit("pointerdown", 1, 10, { pointerType: "mouse" });
  emit("pointerup", 1, 20, { pointerType: "mouse" });
  expect(down.defaultPrevented).toBe(false);
  expect(inputs).toEqual([]);
});
test("a pen is a timer input", () => {
  const { inputs, emit } = setup();
  emit("pointerdown", 1, 10, { pointerType: "pen" });
  emit("pointerup", 1, 20, { pointerType: "pen" });
  expect(inputs).toEqual([
    { type: "press", at: 10 },
    { type: "release", at: 20 },
  ]);
});
test("a button other than the primary one is not a timer input", () => {
  const { inputs, emit } = setup();
  emit("pointerdown", 1, 10, { button: 2 });
  emit("pointerup", 1, 20, { button: 2 });
  expect(inputs).toEqual([]);
});
test("a new primary pointer replaces a pointer whose release was lost", () => {
  const { inputs, emit } = setup();
  emit("pointerdown", 5, 10);
  emit("pointerdown", 6, 20);
  emit("pointerup", 6, 30);
  expect(inputs).toEqual([
    { type: "press", at: 10 },
    { type: "press", at: 20 },
    { type: "release", at: 30 },
  ]);
});
test("contextmenu is prevented and cancels the hold", () => {
  const { inputs, emit } = setup();
  emit("pointerdown", 1, 10);
  expect(emit("contextmenu", 1, 20).defaultPrevented).toBe(true);
  emit("pointerup", 1, 30);
  expect(inputs).toEqual([
    { type: "press", at: 10 },
    { type: "cancel", at: 20 },
  ]);
});
test("unbind removes the contextmenu listener", () => {
  const { emit, unbind } = setup();
  unbind();
  expect(emit("contextmenu", 1, 20).defaultPrevented).toBe(false);
});
test("contextmenu with no touch pointer down is not prevented", () => {
  const { inputs, emit } = setup();
  expect(
    emit("contextmenu", 1, 10, { pointerType: "mouse" }).defaultPrevented,
  ).toBe(false);
  emit("pointerdown", 1, 20);
  emit("pointerup", 1, 30);
  expect(
    emit("contextmenu", 1, 40, { pointerType: "mouse" }).defaultPrevented,
  ).toBe(false);
  expect(inputs).toEqual([
    { type: "press", at: 20 },
    { type: "release", at: 30 },
  ]);
});
test("contextmenu is prevented while a touch pointer that does not time is down", () => {
  const { inputs, emit } = setup();
  emit("pointerdown", 1, 10, { target: { tagName: "BUTTON" } });
  expect(emit("contextmenu", 1, 20).defaultPrevented).toBe(true);
  emit("pointercancel", 1, 30);
  expect(emit("contextmenu", 1, 40).defaultPrevented).toBe(false);
  expect(inputs).toEqual([]);
});
test("a pointerdown inside [data-no-timer] dispatches nothing", () => {
  const { inputs, emit } = setup();
  const region = {
    tagName: "SECTION",
    hasAttribute: (name: string) => name === "data-no-timer",
    parentElement: null,
  };
  const inner = {
    tagName: "P",
    hasAttribute: () => false,
    parentElement: region,
  };
  const down = emit("pointerdown", 1, 10, { target: inner });
  emit("pointerup", 1, 20);
  expect(down.defaultPrevented).toBe(false);
  expect(inputs).toEqual([]);
});

test.each(["holding", "ready", "running"] as const)(
  "a primary pen never replaces the active finger in %s",
  (phase) => {
    for (const target of [
      null,
      { hasAttribute: (name: string) => name === "data-no-timer" },
    ]) {
      const { inputs, emit, setPhase } = setup();
      emit("pointerdown", 1, 0);
      setPhase(phase);
      emit("pointerdown", 2, 100, { pointerType: "pen", target });
      emit("pointercancel", 2, 200, { pointerType: "pen" });
      emit("pointerup", 1, 400);
      expect(inputs).toEqual([
        { type: "press", at: 0 },
        { type: "release", at: 400 },
      ]);
    }
  },
);

test("a contact begun inside [data-no-timer] keeps its context menu", () => {
  const { inputs, emit } = setup();
  const region = { hasAttribute: (name: string) => name === "data-no-timer" };
  emit("pointerdown", 1, 0, { target: { parentElement: region } });
  expect(emit("contextmenu", 1, 100).defaultPrevented).toBe(false);
  emit("pointerup", 1, 400);
  expect(inputs).toEqual([]);
});

test("a touch in a no-timer region stops a running solve", () => {
  const { inputs, emit, setPhase } = setup();
  setPhase("running");
  const target = { hasAttribute: (name: string) => name === "data-no-timer" };
  emit("pointerdown", 1, 10, { target });
  emit("pointerup", 1, 20, { target });
  expect(inputs).toEqual([
    { type: "press", at: 10 },
    { type: "release", at: 20 },
  ]);
});

test("a mouse context menu remains available while a finger is held", () => {
  const { inputs, emit } = setup();
  emit("pointerdown", 1, 10);
  expect(
    emit("contextmenu", 9, 20, { pointerType: "mouse" }).defaultPrevented,
  ).toBe(false);
  expect(inputs).toEqual([{ type: "press", at: 10 }]);
});
