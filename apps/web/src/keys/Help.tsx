import type { Action } from "./engine";
import { isMacPlatform, keyLabel } from "./label";

// The keys that work right now, in the current state.
export function Help({
  bindings,
  language,
  title,
  closeLabel,
  commandsLabel,
  onCommands,
  onClose,
}: {
  bindings: readonly { action: Action; keys: readonly string[] }[];
  language: "en" | "ru";
  title: string;
  closeLabel: string;
  /** Where the key list has a command palette beside it. */
  commandsLabel?: string;
  onCommands?(): void;
  onClose(): void;
}) {
  const mac = isMacPlatform();
  return (
    <dialog data-part="keys-help" data-no-timer open aria-label={title}>
      <button type="button" data-action="dialog-close" onClick={onClose}>
        {closeLabel}
      </button>
      {commandsLabel && onCommands && (
        <button type="button" data-action="commands-open" onClick={onCommands}>
          {commandsLabel}
        </button>
      )}
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
    </dialog>
  );
}
