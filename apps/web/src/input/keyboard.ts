import type { TimerInput, TimerPhase } from "@cubehaus/timer";
import type { KeyState } from "../keys/engine";
import { isInteractive, isTyping } from "./target";

export const defaultHandCodes = ["ControlLeft", "ControlRight"] as const;

const MODIFIER = /^(Meta|OS|Control|Alt)(Left|Right)$/;

export function bindKeyboard(
  target: EventTarget,
  dispatch: (input: TimerInput) => void,
  getPhase: () => TimerPhase,
  options?: {
    handle(key: KeyboardEvent, state: KeyState): boolean;
    modal?(): boolean;
    enabled?(): boolean;
    inspecting?(): boolean;
    holding?(): boolean;
    startMode?: "space" | "two-hand";
    startCode?: string | null;
    handCodes?: readonly [string, string];
    holdMs?: number;
    onHands?(mask: number): void;
  },
): (() => void) & { reset(): void } {
  let heldCode: string | null = null;
  let hands = 0;
  let pair: { at: number; holdMs: number; released: boolean } | null = null;
  const handBit = (code: string) => {
    const [left, right] = options?.handCodes ?? defaultHandCodes;
    return left && code === left ? 1 : right && code === right ? 2 : 0;
  };
  const showHands = (mask: number) => {
    if (hands === mask) return;
    hands = mask;
    options?.onHands?.(mask);
  };
  const clearHands = () => {
    pair = null;
    showHands(0);
  };
  const down = (event: Event) => {
    const key = event as KeyboardEvent;
    const phase = getPhase();
    const running = phase === "running";
    if (key.defaultPrevented && !running) return;
    // A fresh key marks the timer; Escape discards the attempt.
    if (running) {
      key.preventDefault();
      if (!key.repeat) {
        clearHands();
        if (key.code === "Escape") {
          heldCode = null;
          dispatch({ type: "cancel", at: key.timeStamp });
        } else {
          heldCode = key.code;
          dispatch({ type: "press", at: key.timeStamp });
        }
      }
      return;
    }
    const modal = options?.modal?.();
    const interactive = isInteractive(key.target);
    const allowed = !modal && !interactive && options?.enabled?.() !== false;
    const twoHand = options?.startMode === "two-hand";
    const hand = twoHand ? handBit(key.code) : 0;
    if (hands !== 0 && (!hand || !allowed)) {
      if (pair) dispatch({ type: "cancel", at: key.timeStamp });
      clearHands();
    }
    const holding =
      phase === "holding" || phase === "ready" || options?.holding?.();
    const state: KeyState = modal
      ? "modal"
      : holding || phase === "inspecting" || options?.inspecting?.()
        ? "inspecting"
        : isTyping(key.target)
          ? "typing"
          : phase === "stopped"
            ? "stopped"
            : "idle";
    if (options?.handle(key, state)) {
      if (key.code === "Escape") heldCode = null;
      key.preventDefault();
      return;
    }
    if (!allowed) return;
    if (twoHand) {
      if (!hand || heldCode !== null || getPhase() === "stopped") return;
      key.preventDefault();
      if (!key.repeat && !(hands & hand) && !pair?.released) {
        showHands(hands | hand);
        if (hands === 3) {
          pair = {
            at: key.timeStamp,
            holdMs: options?.holdMs ?? 300,
            released: false,
          };
          dispatch({ type: "press", at: key.timeStamp });
        }
      }
      return;
    }
    const startCode =
      options?.startCode === undefined ? "Space" : options.startCode;
    if (key.repeat) {
      if (key.code === startCode) key.preventDefault();
      return;
    }
    if (!options && key.code === "Escape") {
      heldCode = null;
      key.preventDefault();
      dispatch({ type: "cancel", at: key.timeStamp });
      return;
    }
    if (MODIFIER.test(key.code)) {
      // On macOS the keyup of a key held together with Cmd may never arrive,
      // so a modifier ends the hold instead of leaving it waiting.
      if (holding) {
        heldCode = null;
        dispatch({ type: "cancel", at: key.timeStamp });
      }
      return;
    }
    if (key.metaKey || key.ctrlKey || key.altKey) return;
    if (heldCode !== null || key.code !== startCode) return;
    heldCode = key.code;
    key.preventDefault();
    dispatch({ type: "press", at: key.timeStamp });
  };
  const up = (event: Event) => {
    const key = event as KeyboardEvent;
    if (options?.startMode === "two-hand" && hands !== 0) {
      const hand = handBit(key.code);
      if (!(hands & hand)) return;
      key.preventDefault();
      showHands(hands & ~hand);
      if (!pair) return;
      if (options.modal?.() || options.enabled?.() === false) {
        clearHands();
        dispatch({ type: "cancel", at: key.timeStamp });
      } else if (hands === 0) {
        clearHands();
        dispatch({ type: "release", at: key.timeStamp });
      } else if (
        (getPhase() === "holding" || getPhase() === "ready") &&
        key.timeStamp - pair.at < pair.holdMs
      ) {
        clearHands();
        dispatch({ type: "release", at: key.timeStamp });
      } else pair.released = true;
      return;
    }
    if (heldCode === null || key.code !== heldCode) return;
    heldCode = null;
    key.preventDefault();
    dispatch({ type: "release", at: key.timeStamp });
  };
  const reset = () => {
    heldCode = null;
    clearHands();
  };
  const blur = (event: Event) => {
    reset();
    dispatch({ type: "blur", at: event.timeStamp });
  };
  target.addEventListener("keydown", down);
  target.addEventListener("keyup", up);
  target.addEventListener("blur", blur);
  const unbind = () => {
    reset();
    target.removeEventListener("keydown", down);
    target.removeEventListener("keyup", up);
    target.removeEventListener("blur", blur);
  };
  return Object.assign(unbind, { reset });
}
