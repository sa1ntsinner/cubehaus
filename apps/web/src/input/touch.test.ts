import {
  createTimerState,
  reduceTimer,
  type TimerInput,
  type TimerPhase,
} from "@cubehaus/timer";
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
    const event = new Event(type, { cancelable: fields.cancelable !== false });
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
    target,
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
test("contextmenu is prevented and the hold goes on", () => {
  // Android Chrome sends contextmenu half a second into every hold; prevented, no menu
  // opens and the release still comes.
  const { inputs, emit } = setup();
  emit("pointerdown", 1, 10);
  expect(emit("contextmenu", 1, 20).defaultPrevented).toBe(true);
  emit("pointerup", 1, 30);
  expect(inputs).toEqual([
    { type: "press", at: 10 },
    { type: "release", at: 30 },
  ]);
});
test("a context menu that cannot be prevented cancels the hold", () => {
  const { inputs, emit } = setup();
  emit("pointerdown", 1, 10);
  emit("contextmenu", 1, 20, { cancelable: false });
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

// iOS Safari (and Chrome on a phone) follows a tap with a click on whatever lies under the
// finger. The controls faded while the timer runs are still there: the release that starts
// a solve could open a stat slot, and the touch that stops it could press DNF or Delete.
test("the click that follows a timing touch is swallowed", () => {
  const { emit, setPhase } = setup();
  emit("pointerdown", 1, 10);
  setPhase("ready");
  emit("pointerup", 1, 400);
  const click = emit("click", 1, 410);
  expect(click.defaultPrevented).toBe(true);
});
test("the click that follows the touch that stops a solve is swallowed", () => {
  const { emit, setPhase } = setup();
  setPhase("running");
  emit("pointerdown", 1, 1000);
  setPhase("stopped");
  emit("pointerup", 1, 1100);
  expect(emit("click", 1, 1110).defaultPrevented).toBe(true);
});
test("only one click is swallowed, and only soon after the touch", () => {
  const { emit } = setup();
  emit("pointerdown", 1, 10);
  emit("pointerup", 1, 20);
  expect(emit("click", 1, 30).defaultPrevented).toBe(true);
  expect(emit("click", 1, 40).defaultPrevented).toBe(false);
  emit("pointerdown", 1, 100);
  emit("pointerup", 1, 110);
  expect(emit("click", 1, 2000).defaultPrevented).toBe(false);
});
test("a swallowed click does not reach the listeners after it", () => {
  const { target, emit } = setup();
  const reached: number[] = [];
  target.addEventListener("click", (event) => reached.push(event.timeStamp));
  emit("pointerdown", 1, 10);
  emit("pointerup", 1, 20);
  emit("click", 1, 30);
  emit("click", 1, 40);
  expect(reached).toEqual([40]);
});
test("a tap on a control while idle keeps its click", () => {
  const { inputs, emit } = setup();
  const button = { tagName: "BUTTON" };
  emit("pointerdown", 1, 10, { target: button });
  emit("pointerup", 1, 20, { target: button });
  expect(emit("click", 1, 30, { target: button }).defaultPrevented).toBe(false);
  expect(inputs).toEqual([]);
});
test("a mouse click is never swallowed", () => {
  const { emit } = setup();
  emit("pointerdown", 1, 10, { pointerType: "mouse" });
  emit("pointerup", 1, 20, { pointerType: "mouse" });
  expect(emit("click", 1, 30).defaultPrevented).toBe(false);
});
test("unbind removes the click listener", () => {
  const { emit, unbind } = setup();
  emit("pointerdown", 1, 10);
  emit("pointerup", 1, 20);
  unbind();
  expect(emit("click", 1, 30).defaultPrevented).toBe(false);
});

// Several fingers, with the real timer behind the binding: what a phone sees when two hands
// come down on it, a palm rests on it, or the second hand lands a moment after the first.
function withTimer(inspectionMs: number | null = null) {
  const target = new EventTarget();
  let state = createTimerState();
  const solves: number[] = [];
  const config = { holdMs: 300, inspectionMs, minSolveMs: 60 };
  bindTouch(
    target,
    (input) => {
      const result = reduceTimer(state, input, config);
      state = result.state;
      for (const effect of result.effects)
        if (effect.type === "solve") solves.push(effect.timeMs);
    },
    () => state.phase,
  );
  let primaryDown = 0;
  const emit = (type: string, pointerId: number, at: number) => {
    const event = new Event(type, { cancelable: true });
    const isPrimary = type === "pointerdown" ? primaryDown === 0 : false;
    if (type === "pointerdown") primaryDown += 1;
    if (type === "pointerup" || type === "pointercancel")
      primaryDown = Math.max(0, primaryDown - 1);
    for (const [key, value] of Object.entries({
      pointerId,
      timeStamp: at,
      pointerType: "touch",
      button: 0,
      isPrimary,
    }))
      Object.defineProperty(event, key, { value });
    target.dispatchEvent(event);
    return event;
  };
  return {
    target,
    emit,
    solves,
    phase: () => state.phase,
    state: () => state,
  };
}

test("two hands coming down on a running timer stop it once, at the first touch", () => {
  const { emit, solves, phase } = withTimer();
  emit("pointerdown", 1, 0);
  emit("pointerup", 1, 400);
  expect(phase()).toBe("running");
  emit("pointerdown", 2, 10_400);
  emit("pointerdown", 3, 10_404);
  expect(solves).toEqual([10_000]);
  emit("pointerup", 3, 10_500);
  emit("pointerup", 2, 10_520);
  expect(phase()).toBe("idle");
  expect(solves).toEqual([10_000]);
});

test("the second hand landing just after the first has lifted starts nothing", () => {
  for (const inspection of [null, 15_000]) {
    const { emit, solves, phase, state } = withTimer(inspection);
    // With inspection a tap starts it; without, that tap is too short to arm.
    emit("pointerdown", 1, 0);
    emit("pointerup", 1, 100);
    emit("pointerdown", 1, 1_000);
    emit("pointerup", 1, 1_400);
    expect(phase()).toBe("running");
    // One hand stops and lifts at once; the other comes down 120 ms later, and stays
    // long enough to have armed a hold.
    emit("pointerdown", 2, 9_400);
    emit("pointerup", 2, 9_430);
    const late = emit("pointerdown", 3, 9_520);
    expect(late.defaultPrevented).toBe(true);
    emit("pointerup", 3, 9_900);
    expect(solves).toEqual([8_000]);
    expect(phase()).toBe("idle");
    expect(state().inspectionStartedAt).toBe(null);
    expect(state().holdStartedAt).toBe(null);
  }
});

test("a touch well after the stop starts the next attempt as usual", () => {
  const { emit, phase } = withTimer();
  emit("pointerdown", 1, 0);
  emit("pointerup", 1, 400);
  emit("pointerdown", 1, 5_400);
  emit("pointerup", 1, 5_450);
  emit("pointerdown", 2, 6_000);
  expect(phase()).toBe("holding");
  emit("pointerup", 2, 6_400);
  expect(phase()).toBe("running");
});

test("the click of a hand that landed just after the stop is swallowed", () => {
  const { emit } = withTimer();
  emit("pointerdown", 1, 0);
  emit("pointerup", 1, 400);
  emit("pointerdown", 2, 5_400);
  emit("pointerup", 2, 5_430);
  // The timing touch's own click.
  expect(emit("click", 2, 5_440).defaultPrevented).toBe(true);
  emit("pointerdown", 3, 5_600);
  emit("pointerup", 3, 5_650);
  expect(emit("click", 3, 5_660).defaultPrevented).toBe(true);
});

test("a palm resting on the screen does not stop or restart the solve", () => {
  const { emit, solves, phase } = withTimer();
  emit("pointerdown", 1, 0);
  // A palm comes down beside the finger while it holds, and stays.
  emit("pointerdown", 9, 100);
  emit("pointerup", 1, 400);
  expect(phase()).toBe("running");
  // The palm lifts during the solve: nothing.
  emit("pointerup", 9, 3_000);
  expect(phase()).toBe("running");
  emit("pointerdown", 2, 7_400);
  expect(solves).toEqual([7_000]);
  emit("pointerup", 2, 7_450);
  expect(phase()).toBe("idle");
});

test("a third finger during the stop changes nothing", () => {
  const { emit, solves, phase } = withTimer();
  emit("pointerdown", 1, 0);
  emit("pointerup", 1, 400);
  emit("pointerdown", 2, 2_400);
  emit("pointerdown", 3, 2_410);
  emit("pointerdown", 4, 2_420);
  emit("pointerup", 2, 2_500);
  emit("pointerup", 4, 2_510);
  emit("pointerup", 3, 2_520);
  expect(solves).toEqual([2_000]);
  expect(phase()).toBe("idle");
});

test("the stop is the touch's own timestamp, not when it was handled", () => {
  const { emit, solves } = withTimer();
  emit("pointerdown", 1, 1_000.25);
  emit("pointerup", 1, 1_400.5);
  emit("pointerdown", 1, 13_734.75);
  expect(solves).toEqual([12_334]);
});

// A swipe on the time (input/swipe.ts) takes its touch from the timer: the element
// sends `swipeclaim` once the finger has moved far enough, early in a hold.
function claim(target: EventTarget, pointerId: number, at: number) {
  target.dispatchEvent(
    new CustomEvent("swipeclaim", { detail: { pointerId, at } }),
  );
}

test("a swipe that claims the touch ends the hold: the release starts nothing", () => {
  const { target, emit, phase, state } = withTimer();
  emit("pointerdown", 1, 0);
  expect(phase()).toBe("holding");
  claim(target, 1, 80);
  expect(phase()).toBe("idle");
  expect(emit("pointerup", 1, 500).defaultPrevented).toBe(true);
  expect(phase()).toBe("idle");
  expect(state().startedAt).toBe(null);
});

test("with inspection on, a claimed touch does not start inspection", () => {
  const { target, emit, phase } = withTimer(15000);
  emit("pointerdown", 1, 0);
  claim(target, 1, 60);
  emit("pointerup", 1, 200);
  expect(phase()).toBe("idle");
});

test("after a solve, a claimed touch keeps the result and swallows its click", () => {
  const { target, emit, phase, solves, state } = withTimer();
  emit("pointerdown", 1, 0);
  emit("pointerup", 1, 400);
  emit("pointerdown", 1, 3000);
  emit("pointerup", 1, 3050);
  expect(solves).toEqual([2600]);
  emit("pointerdown", 2, 5000);
  claim(target, 2, 5060);
  emit("pointerup", 2, 5300);
  expect(phase()).toBe("idle");
  expect(state().resultMs).toBe(2600);
  const click = new Event("click", { cancelable: true });
  Object.defineProperty(click, "timeStamp", { value: 5320 });
  target.dispatchEvent(click);
  expect(click.defaultPrevented).toBe(true);
});

test("a claim for another touch than the timing one changes nothing", () => {
  const { target, emit, phase } = withTimer();
  emit("pointerdown", 1, 0);
  claim(target, 9, 60);
  expect(phase()).toBe("holding");
  emit("pointerup", 1, 400);
  expect(phase()).toBe("running");
});

test("a control tapped just after a stop is still pressed: only timing touches go quiet", () => {
  const { inputs, emit, setPhase } = setup();
  emit("pointerdown", 1, 0);
  setPhase("running");
  emit("pointerup", 1, 400);
  emit("pointerdown", 1, 3000);
  setPhase("stopped");
  emit("pointerup", 1, 3050);
  setPhase("idle");
  // The stop's own click goes nowhere.
  emit("click", 0, 3060);
  // DNF tapped 300 ms after the stop: its touch and its click are the button's.
  const down = emit("pointerdown", 2, 3300, { target: { tagName: "BUTTON" } });
  expect(down.defaultPrevented).toBe(false);
  emit("pointerup", 2, 3360, { target: { tagName: "BUTTON" } });
  const click = emit("click", 0, 3370);
  expect(click.defaultPrevented).toBe(false);
  expect(inputs.filter((input) => input.type === "press")).toHaveLength(2);
});
