import { type RefObject, useEffect, useRef } from "react";
import {
  type Direction,
  reduceSwipe,
  type SwipeConfig,
  type SwipeOutput,
  type SwipeState,
  startSwipe,
} from "./swipe";

/**
 * A touch swipe on one element (input/swipe.ts decides). While the finger is on it the
 * element follows through `translate` (`--swipe-x`, `--swipe-y`, design/gestures.css),
 * the action's word stands in the space it leaves, and `data-armed` says that letting go
 * would act. Let go short, it springs back.
 *
 * Touches that begin at the screen's side edges, its top or the home indicator's band
 * are left to the system (back swipe, notification pull, home).
 */
export interface SwipeBinding {
  config: SwipeConfig;
  /**
   * What moves, for a touch that begins on this target: the bound element itself when
   * left out. Binding on a stable parent lets the moving part come and go (a list's rows).
   */
  subject?(target: Element, at: { x: number; y: number }): HTMLElement | null;
  /** Read as each touch begins: whether the element swipes now. */
  enabled(subject: HTMLElement): boolean;
  /** The word for a direction (`Delete`), shown beside the element. */
  word(direction: Direction, subject: HTMLElement): string;
  /** The word's colour of meaning when armed: `warn` (+2), `error` (DNF, delete). */
  tone?(direction: Direction): "warn" | "error" | undefined;
  onCommit(direction: Direction, subject: HTMLElement): void;
  /** How far the part travels per pixel of finger (a tile in a tight grid: less). */
  travel?: number;
  /** Where the word stands: in the room the part leaves (default), or just above it. */
  wordAt?: "beside" | "above";
}

/** System edges: the back swipe's band at either side, the top, the home indicator. */
export const EDGE_PX = 20;
const TOP_PX = 24;
const BOTTOM_PX = 24;
/** How long the click after a swipe is swallowed. */
const CLICK_AFTER_MS = 600;

export const DEFAULT_SWIPE: Omit<SwipeConfig, "directions"> = {
  startPx: 12,
  commitPx: 72,
  flingPxPerMs: 0.5,
  holdMs: 250,
};

export function nearSystemEdge(x: number, y: number): boolean {
  return (
    x < EDGE_PX ||
    x > window.innerWidth - EDGE_PX ||
    y < TOP_PX ||
    y > window.innerHeight - BOTTOM_PX
  );
}

const reduced = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useSwipe(
  ref: RefObject<HTMLElement | null>,
  binding: SwipeBinding,
  /** Changes when the bound element may have been replaced or appeared. */
  mounted: unknown = true,
): void {
  const latest = useRef(binding);
  latest.current = binding;
  // biome-ignore lint/correctness/useExhaustiveDependencies: bind again when the element is replaced.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let state: SwipeState = startSwipe();
    let word: HTMLSpanElement | null = null;
    let swallowUntil = Number.NEGATIVE_INFINITY;
    let still = false;
    // What moves for the touch under way.
    let subject: HTMLElement = element;

    const place = (direction: Direction | null, armed: boolean) => {
      if (!direction) {
        word?.remove();
        word = null;
        return;
      }
      if (!word) {
        word = document.createElement("span");
        word.dataset.part = "swipe-word";
        word.setAttribute("aria-hidden", "true");
        document.body.append(word);
      }
      const text = latest.current.word(direction, subject);
      if (word.textContent !== text) word.textContent = text;
      word.dataset.direction = direction;
      word.toggleAttribute("data-armed", armed);
      const tone = armed ? latest.current.tone?.(direction) : undefined;
      if (tone) word.dataset.tone = tone;
      else delete word.dataset.tone;
      const box = subject.getBoundingClientRect();
      const own = word.getBoundingClientRect();
      const gap = 12;
      let left: number;
      let top: number;
      if (latest.current.wordAt === "above") {
        left = box.left + box.width / 2 - own.width / 2;
        top = box.top - 4 - own.height;
      } else if (direction === "left" || direction === "right") {
        // In the space the element leaves behind it.
        left =
          direction === "left" ? box.right + gap : box.left - gap - own.width;
        top = box.top + box.height / 2 - own.height / 2;
      } else {
        left = box.left + box.width / 2 - own.width / 2;
        top =
          direction === "down" ? box.top - gap - own.height : box.bottom + gap;
      }
      left = Math.min(Math.max(left, 8), window.innerWidth - own.width - 8);
      top = Math.min(Math.max(top, 8), window.innerHeight - own.height - 8);
      word.style.left = `${left}px`;
      word.style.top = `${top}px`;
    };

    const show = (output: SwipeOutput) => {
      if (output.type === "claim" || output.type === "move") {
        const { offset } = output;
        subject.setAttribute("data-swiping", "");
        subject.removeAttribute("data-swipe-settling");
        if (!still) {
          const travel = latest.current.travel ?? 1;
          subject.style.setProperty("--swipe-x", `${offset.x * travel}px`);
          subject.style.setProperty("--swipe-y", `${offset.y * travel}px`);
        }
        const direction = output.direction;
        if (direction) subject.dataset.swipeDirection = direction;
        const armed = output.type === "move" && output.armed;
        subject.toggleAttribute("data-armed", armed);
        place(
          output.type === "claim" ? output.direction : output.direction,
          armed,
        );
        return;
      }
      if (output.type === "commit" || output.type === "release") {
        subject.removeAttribute("data-swiping");
        subject.removeAttribute("data-armed");
        subject.removeAttribute("data-swipe-direction");
        if (!still) subject.setAttribute("data-swipe-settling", "");
        subject.style.removeProperty("--swipe-x");
        subject.style.removeProperty("--swipe-y");
        word?.remove();
        word = null;
      }
    };

    const feed = (
      event: PointerEvent,
      type: "down" | "move" | "up" | "cancel",
    ) => {
      const result = reduceSwipe(
        state,
        {
          type,
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          at: event.timeStamp,
        },
        latest.current.config,
      );
      state = result.state;
      const output = result.output;
      if (output.type === "none") return;
      if (output.type === "claim") {
        still = reduced();
        // The touch is the swipe's now: a timer hold it began ends (input/touch.ts).
        subject.dispatchEvent(
          new CustomEvent("swipeclaim", {
            bubbles: true,
            detail: { pointerId: event.pointerId, at: event.timeStamp },
          }),
        );
      }
      if (output.type === "commit" || output.type === "release")
        swallowUntil = event.timeStamp + CLICK_AFTER_MS;
      show(output);
      if (output.type === "commit")
        latest.current.onCommit(output.direction, subject);
    };

    const down = (event: PointerEvent) => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      // A finger already on it counts, so a second one ends a swipe under way.
      if (state.phase === "idle") {
        const target = event.target instanceof Element ? event.target : null;
        const picked = target
          ? (latest.current.subject?.(target, {
              x: event.clientX,
              y: event.clientY,
            }) ?? (latest.current.subject ? null : element))
          : null;
        if (!picked || !latest.current.enabled(picked)) return;
        if (nearSystemEdge(event.clientX, event.clientY)) return;
        subject = picked;
      }
      feed(event, "down");
    };
    const move = (event: PointerEvent) => {
      if (state.phase === "idle") return;
      feed(event, "move");
      if (state.phase === "tracking") event.preventDefault();
    };
    const up = (event: PointerEvent) => {
      if (state.phase !== "idle") feed(event, "up");
    };
    const cancel = (event: PointerEvent) => {
      if (state.phase !== "idle") feed(event, "cancel");
    };
    // Only the click the swipe's own touch may still send, on what it moved.
    const click = (event: MouseEvent) => {
      if (
        event.timeStamp > swallowUntil ||
        !(event.target instanceof Node && subject.contains(event.target))
      )
        return;
      swallowUntil = Number.NEGATIVE_INFINITY;
      event.preventDefault();
      event.stopPropagation();
    };
    const settled = (event: TransitionEvent) => {
      if (event.target instanceof Element && event.propertyName === "translate")
        event.target.removeAttribute("data-swipe-settling");
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", cancel);
    element.addEventListener("click", click, { capture: true });
    element.addEventListener("transitionend", settled);
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", cancel);
      element.removeEventListener("click", click, { capture: true });
      element.removeEventListener("transitionend", settled);
      word?.remove();
    };
  }, [ref, mounted]);
}
