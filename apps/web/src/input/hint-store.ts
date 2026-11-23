import {
  type GestureId,
  type HintMemory,
  nextHint,
  readHints,
  shownHint,
  usedGesture,
  writeHints,
} from "../gesture-hints";
import { deviceStorage } from "./touch-screen";

/** This device's gesture memory, read once per page and written on each change. */
let memory: HintMemory | null = null;

function current(): HintMemory {
  memory ??= readHints(deviceStorage());
  return memory;
}

function keep(next: HintMemory) {
  if (next === memory) return;
  memory = next;
  writeHints(deviceStorage(), next);
}

/** A gesture was used: its hint is not shown again. */
export function learnGesture(id: GestureId): void {
  keep(usedGesture(current(), id));
}

/** The hint to show now, if any, counted as shown. */
export function takeHint(
  available: readonly GestureId[],
  solvesSinceHint: number,
): GestureId | null {
  const id = nextHint(current(), available, solvesSinceHint);
  if (id) keep(shownHint(current(), id));
  return id;
}

/** A gesture's place shows the way once: a few pixels and back (design/gestures.css). */
export function nudge(part: Element | null | undefined, direction: string) {
  if (
    !part ||
    (typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches)
  )
    return () => {};
  part.setAttribute("data-nudge", direction);
  const done = () => part.removeAttribute("data-nudge");
  part.addEventListener("animationend", done, { once: true });
  const timeout = setTimeout(done, 1200);
  return () => {
    clearTimeout(timeout);
    done();
  };
}
