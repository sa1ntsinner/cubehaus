import { type RefObject, useEffect, useRef } from "react";
import {
  type Direction,
  reduceSwipe,
  type SwipeConfig,
  type SwipeOffset,
  type SwipeOutput,
  type SwipeState,
  startSwipe,
} from "./swipe";

/**
 * A touch swipe on one element (input/swipe.ts decides). While the finger is on it the
 * element follows through `translate3d` (`--swipe-x`, `--swipe-y`, design/gestures.css),
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
  onCommit(direction: Direction, subject: HTMLElement): void | Promise<void>;
  /** The timer's prior result slides out while the next result is applied. */
  slideOnCommit?: boolean;
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

    type Tracking = Extract<SwipeOutput, { type: "claim" | "move" }>;
    let pending: Tracking | null = null;
    let frame = 0;
    let box: DOMRect;
    let viewport = { width: 0, height: 0 };
    let painted: SwipeOffset = { x: 0, y: 0 };
    let wordKey = "";
    let wordSize = { width: 0, height: 0 };
    let clearSlide: (() => void) | null = null;

    const place = (direction: Direction | null, armed: boolean) => {
      if (!direction) {
        word?.remove();
        word = null;
        wordKey = "";
        return;
      }
      if (!word) {
        word = document.createElement("span");
        word.dataset.part = "swipe-word";
        word.setAttribute("aria-hidden", "true");
        document.body.append(word);
      }
      const key = `${direction}:${armed}`;
      if (wordKey !== key) {
        wordKey = key;
        word.textContent = latest.current.word(direction, subject);
        word.dataset.direction = direction;
        word.toggleAttribute("data-armed", armed);
        const tone = armed ? latest.current.tone?.(direction) : undefined;
        if (tone) word.dataset.tone = tone;
        else delete word.dataset.tone;
        // A label is measured on the render frame only when its text or weight changes.
        wordSize = word.getBoundingClientRect();
      }
      const { width, height } = wordSize;
      const { x, y } = painted;
      const gap = 12;
      let left: number;
      let top: number;
      if (latest.current.wordAt === "above") {
        left = box.left + x + (box.width - width) / 2;
        top = box.top + y - 4 - height;
      } else if (direction === "left" || direction === "right") {
        left =
          direction === "left"
            ? box.right + x + gap
            : box.left + x - gap - width;
        top = box.top + y + (box.height - height) / 2;
      } else {
        left = box.left + x + (box.width - width) / 2;
        top =
          direction === "down"
            ? box.top + y - gap - height
            : box.bottom + y + gap;
      }
      left = Math.min(Math.max(left, 8), viewport.width - width - 8);
      top = Math.min(Math.max(top, 8), viewport.height - height - 8);
      word.style.transform = translate(left, top);
    };

    const paint = () => {
      frame = 0;
      const output = pending;
      pending = null;
      if (!output) return;
      const travel = still ? 0 : (latest.current.travel ?? 1);
      painted = { x: output.offset.x * travel, y: output.offset.y * travel };
      place(output.direction, output.armed);
      subject.setAttribute("data-swiping", "");
      subject.removeAttribute("data-swipe-settling");
      subject.removeAttribute("data-nudge");
      subject.style.setProperty("--swipe-x", `${painted.x}px`);
      subject.style.setProperty("--swipe-y", `${painted.y}px`);
      if (output.direction) subject.dataset.swipeDirection = output.direction;
      else subject.removeAttribute("data-swipe-direction");
      subject.toggleAttribute("data-armed", output.armed);
    };

    const reset = (settle: boolean) => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      pending = null;
      if (settle && !still && (painted.x !== 0 || painted.y !== 0))
        subject.setAttribute("data-swipe-settling", "");
      else subject.removeAttribute("data-swipe-settling");
      subject.removeAttribute("data-swiping");
      subject.removeAttribute("data-armed");
      subject.removeAttribute("data-swipe-direction");
      subject.style.removeProperty("--swipe-x");
      subject.style.removeProperty("--swipe-y");
      place(null, false);
    };

    const slide = (direction: Direction) => {
      const original = subject;
      const copy = resultCopy(original, box);
      const vertical = direction === "up" || direction === "down";
      const sign = direction === "left" || direction === "up" ? -1 : 1;
      const edge = vertical
        ? sign < 0
          ? box.bottom
          : viewport.height - box.top
        : sign < 0
          ? box.right
          : viewport.width - box.left;
      const departure = sign * (edge + 8);
      const from = translate(painted.x, painted.y);
      const out = copy.animate(
        [
          { transform: from },
          {
            transform: vertical
              ? translate(0, departure)
              : translate(departure, 0),
          },
        ],
        {
          duration: 100,
          easing: "cubic-bezier(0.55, 0, 1, 1)",
          fill: "forwards",
        },
      );
      let arrival: Animation | undefined;
      original.setAttribute("data-swipe-committing", "");
      clearSlide = () => {
        copy.remove();
        out.cancel();
        arrival?.cancel();
        original.removeAttribute("data-swipe-committing");
        original.removeAttribute("data-swipe-direction");
        clearSlide = null;
      };
      reset(false);
      original.dataset.swipeDirection = direction;
      // Invoke in pointerup so iOS lets the comment action focus its text field.
      const action = latest.current.onCommit(direction, original);
      const cleanup = clearSlide;
      void Promise.all([out.finished, action])
        .then(
          () =>
            new Promise<void>((ready) => requestAnimationFrame(() => ready())),
        )
        .then(() => {
          if (clearSlide !== cleanup) return;
          copy.remove();
          original.removeAttribute("data-swipe-committing");
          original.removeAttribute("data-swipe-direction");
          if (!original.isConnected) {
            cleanup();
            return;
          }
          // Ease the new result onto its axis from the opposite side. Keep the
          // keyboard's independent vertical lift in the final transform.
          const lift =
            Number.parseFloat(
              getComputedStyle(original).getPropertyValue("--phone-time-lift"),
            ) || 0;
          // The comment editor leaves a 16 px gap below the lifted time.
          const entry = -sign * (direction === "up" ? 12 : 32);
          arrival = original.animate(
            [
              {
                transform: vertical
                  ? translate(0, lift + entry)
                  : translate(entry, lift),
                opacity: 0,
              },
              { transform: translate(0, lift), opacity: 1 },
            ],
            { duration: 120, easing: "cubic-bezier(0.25, 1.25, 0.4, 1)" },
          );
          return arrival.finished.then(() => {
            if (clearSlide === cleanup) cleanup();
          });
        })
        .catch(() => {
          if (clearSlide === cleanup) cleanup();
        });
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
        // Keep delivering moves if the figure leaves the finger or the finger leaves
        // its original hit target. Synthetic pointer events have no active capture.
        const hit = event.target;
        if (event.isTrusted && hit instanceof Element)
          hit.setPointerCapture(event.pointerId);
        // The touch is the swipe's now: a timer hold it began ends (input/touch.ts).
        subject.dispatchEvent(
          new CustomEvent("swipeclaim", {
            bubbles: true,
            detail: { pointerId: event.pointerId, at: event.timeStamp },
          }),
        );
      }
      if (output.type === "claim" || output.type === "move") {
        pending = output;
        if (!frame) frame = requestAnimationFrame(paint);
        return;
      }
      swallowUntil = event.timeStamp + CLICK_AFTER_MS;
      if (output.type === "commit" && latest.current.slideOnCommit && !still) {
        slide(output.direction);
        return;
      }
      reset(true);
      if (output.type === "commit")
        void latest.current.onCommit(output.direction, subject);
    };

    const down = (event: PointerEvent) => {
      // A new press owns its click, even within the previous swipe's grace period.
      swallowUntil = Number.NEGATIVE_INFINITY;
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
        clearSlide?.();
        subject = picked;
        box = subject.getBoundingClientRect();
        viewport = { width: window.innerWidth, height: window.innerHeight };
        painted = { x: 0, y: 0 };
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
      if (event.target instanceof Element && event.propertyName === "transform")
        event.target.removeAttribute("data-swipe-settling");
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", cancel);
    element.addEventListener("lostpointercapture", cancel);
    element.addEventListener("click", click, { capture: true });
    element.addEventListener("transitionend", settled);
    return () => {
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", cancel);
      element.removeEventListener("lostpointercapture", cancel);
      element.removeEventListener("click", click, { capture: true });
      element.removeEventListener("transitionend", settled);
      reset(false);
      clearSlide?.();
    };
  }, [ref, mounted]);
}

const translate = (x: number, y: number) => `translate3d(${x}px, ${y}px, 0)`;

/** Freeze the old figure's ink and metrics while React renders the new result. */
function resultCopy(subject: HTMLElement, box: DOMRect): HTMLElement {
  const copy = document.createElement("span");
  copy.dataset.part = "swipe-departure";
  copy.setAttribute("aria-hidden", "true");
  copy.textContent = subject.textContent;
  const style = getComputedStyle(subject);
  for (const property of [
    "font-family",
    "font-size",
    "font-weight",
    "font-variant-numeric",
    "line-height",
    "letter-spacing",
    "color",
    "-webkit-text-stroke",
    "background-image",
    "-webkit-background-clip",
    "padding-inline-end",
  ])
    copy.style.setProperty(property, style.getPropertyValue(property));
  copy.style.left = `${box.left}px`;
  copy.style.top = `${box.top}px`;
  document.body.append(copy);
  return copy;
}
