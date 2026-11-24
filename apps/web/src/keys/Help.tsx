import { useEffect, useRef } from "react";
import { keepFocusInside } from "../input/tab-loop";
import type { Action } from "./engine";
import { isMacPlatform, keyLabel } from "./label";
import "../design/sheet.css";
import "../design/keys-help.css";

// The keys that work right now, in the current state; on a touch screen, the gestures.
export function Help({
  bindings,
  language,
  title,
  closeLabel,
  commandsLabel,
  onCommands,
  onClose,
  gestures,
}: {
  bindings: readonly { action: Action; keys: readonly string[] }[];
  language: "en" | "ru";
  title: string;
  closeLabel: string;
  /** Where the key list has a command palette beside it. */
  commandsLabel?: string;
  onCommands?(): void;
  onClose(): void;
  /** A touch screen has no keys to list: what to do, and what it does. */
  gestures?: readonly (readonly [string, string])[] | undefined;
}) {
  const mac = isMacPlatform();
  // The list takes focus as it opens, so the keyboard is in it and Escape gives focus
  // back to what opened it; the list itself, not its first button, so Space closes nothing.
  const sheet = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    sheet.current?.focus({ preventScroll: true });
  }, []);
  return (
    <dialog
      ref={sheet}
      data-part="keys-help"
      data-no-timer
      open
      aria-label={title}
      tabIndex={-1}
      onBlur={keepFocusInside}
    >
      <button type="button" data-action="dialog-close" onClick={onClose}>
        {closeLabel}
      </button>
      {!gestures && commandsLabel && onCommands && (
        <button type="button" data-action="commands-open" onClick={onCommands}>
          {commandsLabel}
        </button>
      )}
      {gestures ? (
        <dl data-list="gestures">
          {gestures.map(([gesture, does]) => (
            <div key={gesture}>
              <dt>{gesture}</dt>
              <dd>{does}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <dl>
          {bindings.map(({ action, keys }) => (
            <div key={action.id} data-action-id={action.id}>
              <dt>
                {keys.map((key) => (
                  <kbd key={key} data-key={key}>
                    {keyLabel(key, mac, language)}
                  </kbd>
                ))}
              </dt>
              <dd>{action.title[language]}</dd>
            </div>
          ))}
        </dl>
      )}
    </dialog>
  );
}
