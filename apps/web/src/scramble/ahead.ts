import type { EventId } from "@cubehaus/core";

/**
 * Scrambles are made ahead of time, one queue per key: the puzzle, or for Multi-Blind
 * of more than two cubes the puzzle and the count, since each count is its own scramble.
 */
export function aheadKey(event: EventId, cubes: number | null): string {
  return cubes === null || cubes === 2 ? event : `${event}:${cubes}`;
}

export function readAheadKey(key: string): {
  event: EventId;
  cubes: number | null;
} {
  const [event, cubes] = key.split(":");
  return {
    event: event as EventId,
    cubes: cubes === undefined ? null : Number(cubes),
  };
}

/**
 * The puzzles whose first scramble is made once the page is idle, so opening one of
 * the person's sessions finds it ready: every puzzle with a session in use, except the
 * one on screen, which has its own. Nothing else is made, so no battery goes on
 * puzzles the person does not time.
 */
export function warmEvents(
  sessions: readonly { event: EventId; archived?: boolean }[],
  open: EventId,
): EventId[] {
  const events = new Set<EventId>();
  for (const { event, archived } of sessions)
    if (!archived && event !== open) events.add(event);
  return [...events];
}

type KeptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const keptKey = "cubehaus.scrambles-ahead";

/**
 * Keeps the scrambles made ahead and not shown, so the page opened again (a reload, the
 * app started tomorrow) shows its puzzle's next scramble at once instead of building a
 * 4×4 or Square-1 search first. Each is shown once at most: coming back takes them all.
 */
export function keepAhead(
  storage: KeptStorage,
  ahead: Partial<Record<string, string[]>>,
): void {
  const kept = Object.fromEntries(
    Object.entries(ahead).filter(([, list]) => list && list.length > 0),
  );
  try {
    if (Object.keys(kept).length === 0) storage.removeItem(keptKey);
    else storage.setItem(keptKey, JSON.stringify(kept));
  } catch {
    // Storage full or refused: the next page makes its own.
  }
}

/** The kept scrambles, taken out of storage at once: `next(key)` hands each out once. */
export function takeKept(storage: KeptStorage): {
  next(key: string): string | null;
} {
  let kept: Record<string, string[]> = {};
  try {
    const text = storage.getItem(keptKey);
    storage.removeItem(keptKey);
    const value: unknown = text === null ? null : JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value))
      for (const [key, list] of Object.entries(value))
        if (
          Array.isArray(list) &&
          list.every((item) => typeof item === "string" && item.length > 0)
        )
          kept[key] = [...list];
  } catch {
    kept = {};
  }
  return {
    next(key) {
      return kept[key]?.shift() ?? null;
    },
  };
}
