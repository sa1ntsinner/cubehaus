/**
 * Which touch gesture to hint, and what this device has learned. A hint is shown where
 * its gesture works, a few times at most, and never again once the gesture has been used.
 * Stored per device (localStorage): losing it only brings a hint back.
 */

export const GESTURES = [
  "time-left",
  "time-right",
  "time-down",
  "scramble",
  "row-left",
  "session",
  "drill",
  "learn",
] as const;
export type GestureId = (typeof GESTURES)[number];

export type HintMemory = Partial<
  Record<GestureId, { shown: number; used: boolean }>
>;

/** A hint is shown at most this many times. */
export const MAX_SHOWN = 3;
/** Solves between two hints on the timer: the first comes after the second solve. */
export const HINT_GAP = 2;

const KEY = "cubehaus.gestures";

interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function nextHint(
  memory: HintMemory,
  available: readonly GestureId[],
  solvesSinceHint: number,
): GestureId | null {
  if (solvesSinceHint < HINT_GAP) return null;
  return (
    available.find((id) => {
      const entry = memory[id];
      return !entry || (!entry.used && entry.shown < MAX_SHOWN);
    }) ?? null
  );
}

export function shownHint(memory: HintMemory, id: GestureId): HintMemory {
  const entry = memory[id] ?? { shown: 0, used: false };
  return { ...memory, [id]: { ...entry, shown: entry.shown + 1 } };
}

export function usedGesture(memory: HintMemory, id: GestureId): HintMemory {
  const entry = memory[id] ?? { shown: 0, used: false };
  return entry.used ? memory : { ...memory, [id]: { ...entry, used: true } };
}

export function readHints(storage: Storage | null): HintMemory {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(KEY) ?? null;
  } catch {
    return {};
  }
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const memory: HintMemory = {};
  for (const id of GESTURES) {
    const entry = (parsed as Record<string, unknown>)[id];
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { shown?: unknown }).shown === "number" &&
      typeof (entry as { used?: unknown }).used === "boolean"
    ) {
      const { shown, used } = entry as { shown: number; used: boolean };
      memory[id] = { shown, used };
    }
  }
  return memory;
}

export function writeHints(storage: Storage | null, memory: HintMemory): void {
  try {
    storage?.setItem(KEY, JSON.stringify(memory));
  } catch {
    // A private window or a full storage: the hint may come back, nothing else.
  }
}
