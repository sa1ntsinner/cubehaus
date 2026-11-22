// One table of actions, one key engine. Bindings name physical keys
// (KeyboardEvent.code), so they work the same on a Russian layout. "Mod" is
// Cmd on macOS and Ctrl elsewhere.

export type KeyState =
  | "idle"
  | "inspecting"
  | "running"
  | "stopped"
  | "modal"
  | "typing"
  | "sheet"
  | "sheet-menu"
  | "sheet-rename"
  | "zoom"
  | "entry"
  | "progress"
  | "progress-chart"
  | "palette-view"
  | "settings"
  | "stat-picker"
  | "average-detail";

export interface Action {
  id: string;
  title: { en: string; ru: string };
  keys: readonly string[];
  when: readonly KeyState[];
  acceptsKey?(): boolean;
  run(): void | Promise<void>;
}

export interface KeyEngineDeps {
  state(): KeyState;
  actions(): readonly Action[];
  isMac?: boolean;
  // True for a moment after a stop, so a hand hitting the keyboard does not
  // set a penalty or delete the solve.
  blocked?(): boolean;
}

export interface KeyEvent {
  code: string;
  repeat: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

interface Chord {
  code: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  mod: boolean;
}

export function parseBinding(binding: string, isMac: boolean): Chord {
  const parts = binding.split("+");
  const code = parts.pop() as string;
  const has = (name: string) => parts.includes(name);
  const mod = has("Mod");
  return {
    code,
    meta: has("Meta") || (mod && isMac),
    ctrl: has("Ctrl") || (mod && !isMac),
    alt: has("Alt"),
    shift: has("Shift"),
    mod,
  };
}

function matches(chord: Chord, event: KeyEvent): boolean {
  return (
    chord.code === event.code &&
    chord.meta === event.metaKey &&
    chord.ctrl === event.ctrlKey &&
    chord.alt === event.altKey &&
    chord.shift === event.shiftKey
  );
}

export function matchesBinding(
  binding: string,
  event: KeyEvent,
  isMac: boolean,
) {
  return matches(parseBinding(binding, isMac), event);
}

export function createKeyEngine(deps: KeyEngineDeps) {
  const isMac =
    deps.isMac ?? /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "");

  // While typing only Escape and Mod chords act; while running nothing here
  // does (any key stops the solve, and the timer's own input handles that).
  function allowed(chord: Chord, state: KeyState): boolean {
    if (state === "running") return false;
    if (state === "typing") {
      const nativeEdit = /^Key[ACVXYZ]$/.test(chord.code);
      return chord.code === "Escape" || (chord.mod && !nativeEdit);
    }
    return true;
  }

  function bindingsFor(state: KeyState, actions = deps.actions()) {
    return actions
      .filter((action) => action.when.includes(state))
      .map((action) => ({
        action,
        keys: action.keys.filter((key) =>
          allowed(parseBinding(key, isMac), state),
        ),
      }))
      .filter((binding) => binding.keys.length > 0);
  }

  return {
    handle(event: KeyEvent): boolean {
      const state = deps.state();
      if (state === "running") return false;
      for (const { action, keys } of bindingsFor(state)) {
        if (!keys.some((key) => matchesBinding(key, event, isMac))) continue;
        if (action.acceptsKey?.() === false) continue;
        // A held key repeats: the action ran on the first press only, but the
        // repeat is still ours, so the browser does nothing with it either.
        if (event.repeat || deps.blocked?.()) return true;
        void action.run();
        return true;
      }
      return false;
    },
    bindingsFor,
    conflicts() {
      const seen = new Map<string, string[]>();
      for (const action of deps.actions())
        for (const state of action.when)
          for (const key of action.keys) {
            const chord = parseBinding(key, isMac);
            const name = `${state} ${chord.meta ? "Meta+" : ""}${chord.ctrl ? "Ctrl+" : ""}${chord.alt ? "Alt+" : ""}${chord.shift ? "Shift+" : ""}${chord.code}`;
            seen.set(name, [...(seen.get(name) ?? []), action.id]);
          }
      return [...seen]
        .filter(([, ids]) => new Set(ids).size > 1)
        .map(([name, ids]) => {
          const [state, key] = name.split(" ") as [KeyState, string];
          return { key, state, ids: [...new Set(ids)] };
        });
    },
  };
}
