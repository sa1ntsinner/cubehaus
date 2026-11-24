import { isTyping } from "./target";
import {
  deviceStorage,
  isTouchPhone,
  isTouchScreen,
  watchTouchPhone,
} from "./touch-screen";

/**
 * Whether keys are worth showing: shortcuts, the key list, key names in rows. A pointer's
 * screen always; a phone never; another touch screen once a hardware keyboard has been
 * used on it, until three launches pass without one.
 */

const KEY = "cubehaus.hardwareKeys";
/** Launches without a hardware key after which the device forgets it had one. */
export const QUIET_LAUNCHES = 3;

/** Launches since a hardware key was last pressed; null when none is remembered. */
export type KeyMemory = { quiet: number } | null;

/** A new launch: one more without a key, or the memory goes. */
export function launched(memory: KeyMemory): KeyMemory {
  if (!memory) return null;
  const quiet = memory.quiet + 1;
  return quiet > QUIET_LAUNCHES ? null : { quiet };
}

/**
 * A key that only a hardware keyboard sends. A screen keyboard types only into a field
 * (and composes there), so a key pressed outside a field is a physical one: Space, Escape,
 * the arrows and the modifiers included.
 */
export function isHardwareKey(event: {
  key: string;
  isComposing?: boolean;
  isTrusted?: boolean;
  target: EventTarget | null;
}): boolean {
  if (event.isTrusted === false || event.isComposing) return false;
  if (event.key === "Unidentified" || event.key === "Process") return false;
  return !isTyping(event.target);
}

export function showsKeys(
  memory: KeyMemory,
  touch: boolean,
  phone: boolean,
): boolean {
  if (!touch) return true;
  return !phone && memory !== null;
}

function read(): KeyMemory {
  try {
    const stored = JSON.parse(deviceStorage()?.getItem(KEY) ?? "null");
    return typeof stored?.quiet === "number" ? { quiet: stored.quiet } : null;
  } catch {
    return null;
  }
}
function write(memory: KeyMemory) {
  try {
    const storage = deviceStorage();
    if (memory) storage?.setItem(KEY, JSON.stringify(memory));
    else storage?.removeItem(KEY);
  } catch {
    // A full or closed store: the memory lasts this launch.
  }
}

let memory: KeyMemory = null;
let started = false;
const listeners = new Set<() => void>();

function current(): boolean {
  return showsKeys(memory, isTouchScreen(), isTouchPhone());
}
function mark() {
  if (typeof document === "undefined") return;
  // CSS hides key names (the palette's) where there are no keys.
  if (current()) document.documentElement.dataset.keys = "";
  else delete document.documentElement.dataset.keys;
}
function changed() {
  mark();
  for (const listener of listeners) listener();
}

/** Counts this launch and starts listening for a hardware key; once per page. */
export function startHardwareKeys() {
  if (started || typeof window === "undefined") return;
  started = true;
  memory = launched(read());
  write(memory);
  mark();
  if (!isTouchScreen()) return;
  window.addEventListener(
    "keydown",
    (event) => {
      if (!isHardwareKey(event)) return;
      const was = memory;
      memory = { quiet: 0 };
      if (was?.quiet !== 0) write(memory);
      if (!was) changed();
    },
    true,
  );
  if (typeof matchMedia === "function") watchTouchPhone(changed);
}

export function watchKeys(change: () => void): () => void {
  startHardwareKeys();
  listeners.add(change);
  return () => listeners.delete(change);
}

/** Whether to show keys right now (see the top of this file). */
export function keysShown(): boolean {
  startHardwareKeys();
  return current();
}
