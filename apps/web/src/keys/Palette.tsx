import { useMemo, useState } from "react";
import type { Action } from "./engine";
import { actionKey, type Keymap } from "./keymap";
import { isMacPlatform, keyLabel } from "./label";

// Find an action by its title in the current language and run it with Enter.
export function matchActions(
  actions: readonly Action[],
  query: string,
  language: "en" | "ru",
): Action[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return actions.filter((action) => {
    const title = action.title[language].toLowerCase();
    return words.every((word) => title.includes(word));
  });
}

export function Palette({
  actions,
  language,
  keymap,
  placeholder,
  closeLabel,
  onClose,
}: {
  actions: readonly Action[];
  language: "en" | "ru";
  keymap: Keymap;
  placeholder: string;
  closeLabel: string;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const found = useMemo(
    () => matchActions(actions, query, language),
    [actions, query, language],
  );
  const mac = isMacPlatform();
  const run = (action: Action | undefined) => {
    if (!action) return;
    onClose();
    void action.run();
  };
  return (
    <dialog
      data-part="palette"
      data-no-timer
      open
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.nativeEvent.isComposing) return;
        if (actionKey(keymap, "palette.run", event)) {
          if (
            event.code === "Enter" &&
            (event.target as Element).closest("button")
          )
            return;
          event.preventDefault();
          run(found[selected]);
        } else if (actionKey(keymap, "palette.next", event)) {
          event.preventDefault();
          setSelected((i) => Math.max(0, Math.min(i + 1, found.length - 1)));
        } else if (actionKey(keymap, "palette.previous", event)) {
          event.preventDefault();
          setSelected((i) => Math.max(i - 1, 0));
        } else if (actionKey(keymap, "palette.close", event)) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <button type="button" data-action="dialog-close" onClick={onClose}>
        {closeLabel}
      </button>
      <input
        type="search"
        data-part="palette-query"
        aria-label={placeholder}
        placeholder={placeholder}
        autoFocus
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setSelected(0);
        }}
      />
      <ul data-part="palette-results">
        {found.map((action, index) => (
          <li
            key={action.id}
            data-action-id={action.id}
            data-selected={index === selected || undefined}
          >
            <button type="button" onClick={() => run(action)}>
              {action.title[language]}
            </button>
            {action.keys[0] && (
              <kbd data-key={action.keys[0]}>
                {keyLabel(action.keys[0], mac, language)}
              </kbd>
            )}
          </li>
        ))}
      </ul>
    </dialog>
  );
}
