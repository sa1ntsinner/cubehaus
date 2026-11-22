import { ACTIONS, type ActionSpec } from "./actions";
import {
  createKeyEngine,
  type KeyEvent,
  type KeyState,
  matchesBinding,
} from "./engine";
import { isMacPlatform } from "./label";

export type Keymap = Record<string, readonly string[]>;
type Platform = "mac" | "other";

export interface BindingConflict {
  state: KeyState;
  key: string;
  ids: string[];
  reason?: "reserved" | "invalid";
}

export const keymapKey = "keymap.v1";
const physicalCode = /^[A-Za-z][A-Za-z0-9]*$/;
const modifier = /^(?:Alt|Control|Meta|Shift)(?:Left|Right)$/;
const chord = /^(?:(?:Mod|Meta|Ctrl|Alt|Shift)\+)*[A-Za-z][A-Za-z0-9]*$/;
const reservedMod =
  /^(?:Mod|Meta|Ctrl)\+(?:Shift\+)?(?:KeyL|KeyN|KeyQ|KeyR|KeyT|KeyW|Tab)$/;

export function resolveBindings(
  specs: readonly ActionSpec[],
  map: Keymap,
): ActionSpec[] {
  return specs.map((spec) => ({ ...spec, keys: map[spec.id] ?? spec.keys }));
}

function errorFor(spec: ActionSpec, key: string) {
  if (key.length > 60 || !chord.test(key)) return "invalid";
  const [state] = spec.when;
  if (
    (state === "palette-view" ||
      state === "sheet-rename" ||
      state === "entry") &&
    /^(?:(?:Alt|Shift)\+)*(?:Key[A-Z]|Digit\d|Space|Comma|Period|Minus|Equal|Slash)$/.test(
      key,
    )
  )
    return "invalid";
  if (
    (state === "palette-view" ||
      state === "sheet" ||
      state === "sheet-rename" ||
      state === "entry") &&
    /^(?:Mod|Ctrl|Meta)\+(?:Shift\+)?(?:KeyA|KeyC|KeyV|KeyX|KeyZ)$/.test(key)
  )
    return "reserved";
  if (spec.input && key.includes("+")) return "invalid";
  if (spec.input !== "hand" && modifier.test(key)) return "invalid";
  if (
    reservedMod.test(key) ||
    /^(?:(?:Alt|Meta|Ctrl|Shift|Mod)\+)*(?:Tab|F5|F11|F12)$/.test(key) ||
    key === "Alt+F4"
  )
    return "reserved";
  return undefined;
}

export function validateBindings(
  map: Keymap,
  platform: Platform,
): BindingConflict[] {
  const specs = resolveBindings(ACTIONS, map);
  const invalid = specs.flatMap((spec) =>
    (map[spec.id] ?? []).flatMap((key) => {
      if (byId.get(spec.id)?.keys.includes(key)) return [];
      const reason = errorFor(spec, key);
      const state = spec.when[0];
      return reason && state ? [{ state, key, ids: [spec.id], reason }] : [];
    }),
  );
  const engine = createKeyEngine({
    state: () => "idle",
    actions: () => specs.map((spec) => ({ ...spec, run: () => {} })),
    isMac: platform === "mac",
  });
  return [
    ...invalid,
    ...engine.conflicts().map(({ ids, ...rest }) => ({
      ...rest,
      ids: ids.sort(),
    })),
  ];
}

export function parseKeymap(raw: string | null): Keymap {
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const fields = parsed as Record<string, unknown>;
  const map: Keymap = {};
  for (const spec of ACTIONS) {
    const keys = fields[spec.id];
    if (Array.isArray(keys) && keys.every((key) => typeof key === "string"))
      map[spec.id] = [...new Set<string>(keys)].slice(0, spec.input ? 1 : 12);
  }
  const platform = isMacPlatform() ? "mac" : "other";
  for (;;) {
    const conflicts = validateBindings(map, platform);
    if (conflicts.length === 0) return map;
    const overridden = conflicts.flatMap(({ ids }) =>
      ids.filter((id) => Object.hasOwn(map, id)),
    );
    if (overridden.length === 0) return {};
    for (const id of overridden) delete map[id];
  }
}

const byId = new Map(ACTIONS.map((action) => [action.id, action]));

export function keysFor(map: Keymap, id: string): readonly string[] {
  return map[id] ?? byId.get(id)?.keys ?? [];
}

export function actionKey(map: Keymap, id: string, event: KeyEvent): boolean {
  return keysFor(map, id).some((key) =>
    matchesBinding(key, event, isMacPlatform()),
  );
}

export function captureKey(event: KeyEvent, physical: boolean): string | null {
  if (
    event.repeat ||
    event.code === "Unidentified" ||
    !physicalCode.test(event.code)
  )
    return null;
  if (physical) return event.code;
  if (modifier.test(event.code)) return null;
  const mac = isMacPlatform();
  return [
    event.metaKey ? (mac ? "Mod" : "Meta") : "",
    event.ctrlKey ? (mac ? "Ctrl" : "Mod") : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    event.code,
  ]
    .filter(Boolean)
    .join("+");
}
