import { isTyping } from "./target";

/**
 * Android's Back button or gesture closes what is open on the timer instead of leaving
 * the app, which is a single page: a field being written in (the comment line) and a
 * panel that is not a modal dialog (the statistic choices, the zoomed picture). While
 * one of them has the focus, one entry of the same address stands on the history. Back
 * takes it: a field loses the focus, which keeps what was written and closes it, as a
 * touch outside does; a panel gets Escape. One closed any other way takes its entry back
 * off. A sheet (a modal <dialog>) closes on Back by itself.
 */
const KEY = "cubehausBack";

function field(target: EventTarget | null): target is HTMLElement {
  return (
    isTyping(target) &&
    !(target as Element).closest("dialog") &&
    !(target as HTMLInputElement).readOnly
  );
}

function panel(target: EventTarget | null): HTMLElement | null {
  const element = target as Element | null;
  return typeof element?.closest === "function"
    ? element.closest<HTMLElement>('[role="dialog"]:not(dialog)')
    : null;
}

export function closeOnBack(win: Window): () => void {
  const { document, history } = win;
  let guarded = false;
  let ignorePop = false;
  const ours = () =>
    (history.state as Record<string, unknown> | null)?.[KEY] === true;
  const open = (target: EventTarget | null) =>
    field(target) || panel(target) !== null;

  const focusIn = (event: FocusEvent) => {
    if (guarded || !open(event.target)) return;
    history.pushState({ ...(history.state ?? {}), [KEY]: true }, "");
    guarded = true;
  };
  const focusOut = (event: FocusEvent) => {
    if (!guarded || open(event.relatedTarget)) return;
    // The page itself lost the focus (another app, the keys put away): still open.
    if (event.relatedTarget === null && !document.hasFocus()) return;
    // Focus may come back inside on its own (a panel moving it between its buttons).
    queueMicrotask(() => {
      if (!guarded || open(document.activeElement)) return;
      guarded = false;
      // The address moved on meanwhile (a link): the entry stays behind, harmless.
      if (!ours()) return;
      ignorePop = true;
      history.back();
    });
  };
  const pop = () => {
    if (ignorePop) {
      ignorePop = false;
      return;
    }
    if (!guarded || ours()) return;
    guarded = false;
    const active = document.activeElement;
    if (field(active)) {
      active.blur();
      return;
    }
    const target = panel(active) ? active : null;
    target?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  };

  document.addEventListener("focusin", focusIn);
  document.addEventListener("focusout", focusOut);
  win.addEventListener("popstate", pop);
  return () => {
    document.removeEventListener("focusin", focusIn);
    document.removeEventListener("focusout", focusOut);
    win.removeEventListener("popstate", pop);
  };
}
