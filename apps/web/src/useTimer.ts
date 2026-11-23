import {
  type EventId,
  eventInfo,
  type InputKind,
  newId,
  type Session,
  type Solve,
} from "@cubehaus/core";
import {
  createTimerState,
  OFFICIAL_TIMER_CONFIG,
  reduceTimer,
  type TimerConfig,
  type TimerEffect,
  type TimerInput,
  type TimerState,
} from "@cubehaus/timer";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { browserCallOutputs, createCaller } from "./calls";
import { bindKeyboard } from "./input/keyboard";
import { bindTouch } from "./input/touch";
import { type Action, createKeyEngine, type KeyState } from "./keys/engine";
import { type Keymap, keysFor } from "./keys/keymap";
import type { Settings } from "./settings";
import type { TimerSeed } from "./testing/seed";
import { textFor } from "./text";

type SolveEffect = Extract<TimerEffect, { type: "solve" }>;
type Source = Exclude<InputKind, "manual">;
type Attempt = {
  sessionId: string;
  event: EventId;
  scramble: string;
  input: InputKind;
};

/**
 * Whether an input may wake the audio for the inspection calls. A press, and its release
 * too: iOS Safari lets audio start only from the end of a touch (touchend), so a context
 * resumed at the press alone stayed suspended and the 8 s tick was never heard.
 */
function unlocks(input: TimerInput): boolean {
  return input.type === "press" || input.type === "release";
}

export function sessionTimerConfig(
  event: EventId,
  settings: Pick<Settings, "inspection" | "holdMs">,
): TimerConfig {
  return {
    ...OFFICIAL_TIMER_CONFIG,
    inspectionMs:
      settings.inspection === "official" ? eventInfo(event).inspectionMs : null,
    holdMs: settings.holdMs,
  };
}

export function solveFromEffect(
  effect: SolveEffect,
  context: Attempt & { wallNow: number; perfNow: number },
): Solve {
  return {
    id: newId(context.wallNow),
    sessionId: context.sessionId,
    event: context.event,
    timeMs: effect.timeMs,
    plus2: effect.plus2,
    dnf: effect.dnf,
    scramble: context.scramble,
    // The wall clock dates the solve. Its duration is already final.
    startedAt: Math.round(
      context.wallNow - (context.perfNow - effect.startedAt),
    ),
    inspectionMs: effect.inspectionMs,
    comment: null,
    input: context.input,
  };
}

function isHeld(state: TimerState): boolean {
  return state.holdStartedAt !== null;
}

export interface TimerController {
  readonly state: TimerState;
  dispatch(input: TimerInput, source?: Source): void;
}

export function createTimerController(deps: {
  clock: () => { wall: number; perf: number };
  scramble: () => string | null;
  session: () => Pick<Session, "id" | "event"> | null;
  config?: () => TimerConfig;
  onChange: (state: TimerState) => void;
  onSolve: (solve: Solve) => void;
  onEffect?: (effect: Exclude<TimerEffect, SolveEffect>) => void;
}): TimerController {
  let state = createTimerState();
  let owner: Source | null = null;
  let active: Attempt | null = null;
  let config: TimerConfig | undefined;
  return {
    get state() {
      return state;
    },
    dispatch(input, source) {
      const previous = state;
      if (
        isHeld(previous) &&
        source !== undefined &&
        owner !== null &&
        source !== owner &&
        (input.type === "press" || input.type === "release")
      )
        return;
      if (previous.phase === "idle" && input.type === "press" && !active) {
        const scramble = deps.scramble();
        if (scramble === null) return;
        const session = deps.session();
        active = {
          scramble,
          sessionId: session?.id ?? "",
          event: session?.event ?? "333",
          input: source ?? "keyboard",
        };
        config = deps.config?.();
      }
      const result = reduceTimer(previous, input, config);
      state = result.state;
      if (!isHeld(state)) owner = null;
      else if (!isHeld(previous)) owner = source ?? null;
      if (active && previous.phase !== "running" && state.phase === "running")
        active.input = source ?? "keyboard";
      if (state !== previous) deps.onChange(state);
      for (const effect of result.effects) {
        if (effect.type !== "solve") {
          deps.onEffect?.(effect);
        } else if (active) {
          const now = deps.clock();
          deps.onSolve(
            solveFromEffect(effect, {
              ...active,
              wallNow: now.wall,
              perfNow: now.perf,
            }),
          );
        }
      }
      if (
        state.phase === "stopped" ||
        (state.phase === "idle" && !isHeld(state))
      ) {
        active = null;
        config = undefined;
      }
    },
  };
}

export function useTimer(options: {
  scramble: string | null;
  onSolve: (solve: Solve) => void;
  onEffect: (effect: Exclude<TimerEffect, SolveEffect>) => void;
  session: Pick<Session, "id" | "event"> | null;
  settings: Settings;
  keymap: Keymap;
  enabled: boolean;
  modal: boolean;
  actions: () => readonly Action[];
  seed?: TimerSeed | undefined;
}) {
  const [state, setState] = useState(createTimerState);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [hands, setHands] = useState(0);
  const seed =
    import.meta.env.VITE_TEST_HOOKS === "1" ? options.seed : undefined;
  const [frozen, setFrozen] = useState(seed !== undefined);
  const replayed = useRef(false);
  const replaying = useRef(false);
  const latest = useRef(options);
  const keyState = useRef<KeyState>("idle");
  const resetKeyboard = useRef<(() => void) | null>(null);
  const stoppedAt = useRef(-Infinity);
  const [outputs] = useState(browserCallOutputs);
  const [caller] = useState(() =>
    createCaller(() => {
      const { calls, language } = latest.current.settings;
      return { mode: calls, language, words: textFor(language).calls };
    }, outputs),
  );
  const [engine] = useState(() =>
    createKeyEngine({
      state: () => keyState.current,
      actions: () => latest.current.actions(),
      blocked: () =>
        keyState.current !== "typing" &&
        keyState.current !== "modal" &&
        performance.now() - stoppedAt.current < 200,
    }),
  );

  useLayoutEffect(() => {
    latest.current = options;
  });

  const [timer] = useState(() =>
    createTimerController({
      clock: () => ({ wall: Date.now(), perf: performance.now() }),
      scramble: () => latest.current.scramble,
      session: () => latest.current.session,
      config: () =>
        sessionTimerConfig(
          latest.current.session?.event ?? "333",
          latest.current.settings,
        ),
      onChange: (next) => {
        setState(next);
        if (next.phase === "running" || next.phase === "inspecting")
          setElapsedMs(0);
        if (next.phase === "stopped") stoppedAt.current = performance.now();
      },
      onSolve: (solve) => {
        // The fixture's stopped result is already in its seeded history.
        if (!replaying.current) latest.current.onSolve(solve);
      },
      onEffect: (effect) => {
        if (effect.type === "call") caller.call(effect.seconds);
        if (effect.type === "tooShort") stoppedAt.current = performance.now();
        latest.current.onEffect(effect);
      },
    }),
  );

  const { enabled, modal, session } = options;
  const { startMode } = options.settings;
  const [startCode = null] = keysFor(options.keymap, "timer.start");
  const [leftCode = ""] = keysFor(options.keymap, "timer.handLeft");
  const [rightCode = ""] = keysFor(options.keymap, "timer.handRight");
  const lastSession = useRef(session?.id);
  useLayoutEffect(() => {
    // Opening the first session resolves the pending attempt's destination.
    // Preserve its input latch so the release can still start or finish it.
    const changedSession =
      lastSession.current !== undefined && lastSession.current !== session?.id;
    if (modal || !enabled || changedSession) resetKeyboard.current?.();
    if (!enabled || (modal && isHeld(timer.state)) || changedSession)
      timer.dispatch({ type: "cancel", at: performance.now() });
    lastSession.current = session?.id;
  }, [enabled, modal, session?.id, timer]);

  const { scramble } = options;
  useLayoutEffect(() => {
    if (!seed || !session || scramble === null || replayed.current) return;
    replayed.current = true;
    replaying.current = true;
    const now = Math.floor(performance.now());
    for (const step of seed.steps)
      timer.dispatch({ ...step, at: now + step.at });
    replaying.current = false;
    setElapsedMs(seed.elapsedMs);
  }, [scramble, seed, session, timer]);

  useEffect(() => {
    const phase = () => timer.state.phase;
    const dispatch = (input: TimerInput, source: Source) => {
      if (replayed.current) setFrozen(false);
      if (unlocks(input) && latest.current.settings.calls !== "off")
        outputs.unlock();
      timer.dispatch(input, source);
    };
    const unbindKeyboard = bindKeyboard(
      window,
      (input) => dispatch(input, "keyboard"),
      phase,
      {
        startMode,
        startCode,
        handCodes: [leftCode, rightCode],
        get holdMs() {
          return latest.current.settings.holdMs;
        },
        onHands: setHands,
        enabled: () => latest.current.enabled,
        modal: () => latest.current.modal,
        inspecting: () => timer.state.inspectionStartedAt !== null,
        holding: () => isHeld(timer.state),
        handle: (key, current) => {
          keyState.current = current;
          return engine.handle(key);
        },
      },
    );
    resetKeyboard.current = unbindKeyboard.reset;
    const visibility = (event: Event) => {
      if (document.hidden) {
        unbindKeyboard.reset();
        timer.dispatch({ type: "blur", at: event.timeStamp });
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      resetKeyboard.current = null;
      unbindKeyboard();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [engine, outputs, timer, startMode, startCode, leftCode, rightCode]);

  useEffect(() => {
    if (!enabled || modal) return;
    return bindTouch(
      window,
      (input) => {
        if (replayed.current) setFrozen(false);
        if (unlocks(input) && latest.current.settings.calls !== "off")
          outputs.unlock();
        timer.dispatch(input, "touch");
      },
      () => timer.state.phase,
    );
  }, [enabled, modal, outputs, timer]);

  const running = state.phase === "running";
  const inspecting = state.inspectionStartedAt !== null;
  useEffect(() => {
    if (frozen || (!running && !inspecting && state.phase !== "holding"))
      return;
    let frame = 0;
    const update = (at: number) => {
      timer.dispatch({ type: "tick", at });
      const current = timer.state;
      const start = current.startedAt ?? current.inspectionStartedAt;
      if (start !== null) setElapsedMs(Math.max(0, at - start));
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [frozen, running, inspecting, state.phase, timer]);

  return {
    state,
    hands,
    keyState,
    bindingsFor: engine.bindingsFor,
    cancel: () => timer.dispatch({ type: "cancel", at: performance.now() }),
    displayMs: running || inspecting ? elapsedMs : (state.resultMs ?? 0),
  };
}
