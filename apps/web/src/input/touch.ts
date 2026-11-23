import type { TimerInput, TimerPhase } from "@cubehaus/timer";
import { isInteractive, isNoTimer } from "./target";

/** How long after a timing touch ends its click may still come (iOS sends it at once). */
const CLICK_AFTER_TOUCH_MS = 600;
/**
 * After a stop, how long a new touch is taken for the other hand coming down to stop as
 * well: both hands leave the cube for the screen, rarely together. Nobody starts the next
 * attempt this soon; the result has not been read yet.
 */
const SECOND_HAND_MS = 400;

export function bindTouch(
  target: EventTarget,
  dispatch: (input: TimerInput) => void,
  getPhase: () => TimerPhase,
): () => void {
  let pointerId: number | null = null;
  let pointerType: string | null = null;
  // Remember where each contact began, even when it does not time.
  const touching = new Map<number, { type: string; preventMenu: boolean }>();
  // A tap is followed by a click on whatever lies under the finger, the faded controls
  // included: the release that starts a solve could open a stat slot, the touch that stops
  // it could press DNF or Delete. The one click after a timing touch goes nowhere.
  let swallowUntil = Number.NEGATIVE_INFINITY;
  // Contacts that came down just after a stop: neither timed nor clicked.
  let quietUntil = Number.NEGATIVE_INFINITY;
  const quiet = new Set<number>();
  // Contacts a swipe took (input/swipe.ts): the hold they began has ended.
  const claimed = new Set<number>();
  const down = (event: Event) => {
    const pointer = event as PointerEvent;
    if (pointer.pointerType !== "touch" && pointer.pointerType !== "pen")
      return;
    // isPrimary is per pointer type; only that type can have stale contacts.
    if (pointer.isPrimary) {
      for (const [id, contact] of touching) {
        if (contact.type === pointer.pointerType) touching.delete(id);
      }
    }
    touching.set(pointer.pointerId, {
      type: pointer.pointerType,
      preventMenu: !isNoTimer(pointer.target),
    });
    // A control is pressed on purpose (DNF, Delete): only a touch that would time goes quiet.
    if (
      pointer.timeStamp < quietUntil &&
      getPhase() !== "running" &&
      !isInteractive(pointer.target)
    ) {
      quiet.add(pointer.pointerId);
      pointer.preventDefault();
      return;
    }
    if (pointerId !== null && pointer.pointerType !== pointerType) return;
    // The mouse is not a timer input: a drag to select text or a right click
    // must never start a solve. Only a finger or a pen with its main button.
    if (pointer.button !== 0) return;
    // A new primary pointer of the same type recovers a lost release.
    if (pointer.isPrimary) pointerId = null;
    if (
      getPhase() !== "running" &&
      (pointerId !== null || isInteractive(pointer.target))
    )
      return;
    pointerId = pointer.pointerId;
    pointerType = pointer.pointerType;
    pointer.preventDefault();
    if (getPhase() === "running")
      quietUntil = pointer.timeStamp + SECOND_HAND_MS;
    dispatch({ type: "press", at: pointer.timeStamp });
  };
  const finish = (event: Event) => {
    const pointer = event as PointerEvent;
    touching.delete(pointer.pointerId);
    if (quiet.delete(pointer.pointerId) || claimed.delete(pointer.pointerId)) {
      pointer.preventDefault();
      swallowUntil = pointer.timeStamp + CLICK_AFTER_TOUCH_MS;
      return;
    }
    if (
      pointerId === null ||
      pointer.pointerId !== pointerId ||
      pointer.pointerType !== pointerType
    )
      return;
    pointerId = null;
    pointer.preventDefault();
    swallowUntil = pointer.timeStamp + CLICK_AFTER_TOUCH_MS;
    dispatch({
      type: pointer.type === "pointerup" ? "release" : "cancel",
      at: pointer.timeStamp,
    });
  };
  const click = (event: Event) => {
    if (event.timeStamp > swallowUntil) return;
    swallowUntil = Number.NEGATIVE_INFINITY;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  // A long press can open the context menu and swallow the release.
  const menu = (event: Event) => {
    const pointer = event as PointerEvent;
    if (pointer.pointerType === "mouse") return;
    const contact = touching.get(pointer.pointerId);
    if (
      contact
        ? !contact.preventMenu
        : ![...touching.values()].some((value) => value.preventMenu)
    )
      return;
    event.preventDefault();
    if (pointerId === null || (contact && contact.type !== pointerType)) return;
    pointerId = null;
    dispatch({ type: "cancel", at: event.timeStamp });
  };
  // A swipe on an element (the time) moved far enough, early in a hold, to be a swipe: the
  // hold ends there, and the release and click of that touch go nowhere.
  const claim = (event: Event) => {
    const { pointerId: id, at } = (
      event as CustomEvent<{ pointerId: number; at: number }>
    ).detail;
    if (pointerId === null || id !== pointerId) return;
    pointerId = null;
    claimed.add(id);
    dispatch({ type: "cancel", at });
  };
  const blur = () => {
    pointerId = null;
    touching.clear();
    quiet.clear();
    claimed.clear();
  };
  target.addEventListener("pointerdown", down);
  target.addEventListener("pointerup", finish);
  target.addEventListener("pointercancel", finish);
  target.addEventListener("contextmenu", menu);
  target.addEventListener("blur", blur);
  target.addEventListener("swipeclaim", claim);
  target.addEventListener("click", click, { capture: true });
  return () => {
    target.removeEventListener("swipeclaim", claim);
    target.removeEventListener("pointerdown", down);
    target.removeEventListener("pointerup", finish);
    target.removeEventListener("pointercancel", finish);
    target.removeEventListener("contextmenu", menu);
    target.removeEventListener("blur", blur);
    target.removeEventListener("click", click, { capture: true });
  };
}
