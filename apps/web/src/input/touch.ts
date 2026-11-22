import type { TimerInput, TimerPhase } from "@cubehaus/timer";
import { isInteractive, isNoTimer } from "./target";

export function bindTouch(
  target: EventTarget,
  dispatch: (input: TimerInput) => void,
  getPhase: () => TimerPhase,
): () => void {
  let pointerId: number | null = null;
  let pointerType: string | null = null;
  // Remember where each contact began, even when it does not time.
  const touching = new Map<number, { type: string; preventMenu: boolean }>();
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
    dispatch({ type: "press", at: pointer.timeStamp });
  };
  const finish = (event: Event) => {
    const pointer = event as PointerEvent;
    touching.delete(pointer.pointerId);
    if (
      pointerId === null ||
      pointer.pointerId !== pointerId ||
      pointer.pointerType !== pointerType
    )
      return;
    pointerId = null;
    pointer.preventDefault();
    dispatch({
      type: pointer.type === "pointerup" ? "release" : "cancel",
      at: pointer.timeStamp,
    });
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
  const blur = () => {
    pointerId = null;
    touching.clear();
  };
  target.addEventListener("pointerdown", down);
  target.addEventListener("pointerup", finish);
  target.addEventListener("pointercancel", finish);
  target.addEventListener("contextmenu", menu);
  target.addEventListener("blur", blur);
  return () => {
    target.removeEventListener("pointerdown", down);
    target.removeEventListener("pointerup", finish);
    target.removeEventListener("pointercancel", finish);
    target.removeEventListener("contextmenu", menu);
    target.removeEventListener("blur", blur);
  };
}
