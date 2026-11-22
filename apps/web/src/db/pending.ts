import { isEventId, type Solve } from "@cubehaus/core";

/** Where unsaved solves live: "stored" survives a crash, "memory" does not. */
export type JournalDurability = "stored" | "memory";

export interface PendingJournal {
  add(solve: Solve): void;
  confirm(id: string): void;
  /** Pending solves, oldest first (by start time, then ID). */
  all(): Solve[];
  durability(): JournalDurability;
}

export type JournalStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;

/** A Storage-shaped map for tests and test-hook builds. */
export function memoryStorage(entries?: Iterable<[string, string]>) {
  const map = new Map(entries);
  return {
    map,
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  } satisfies JournalStorage & { map: Map<string, string> };
}

function isSolve(value: unknown): value is Solve {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.sessionId === "string" &&
    typeof s.event === "string" &&
    isEventId(s.event) &&
    typeof s.timeMs === "number" &&
    Number.isSafeInteger(s.timeMs) &&
    s.timeMs >= 0 &&
    typeof s.plus2 === "number" &&
    Number.isSafeInteger(s.plus2) &&
    s.plus2 >= 0 &&
    typeof s.dnf === "boolean" &&
    typeof s.scramble === "string" &&
    typeof s.startedAt === "number" &&
    Number.isSafeInteger(s.startedAt) &&
    (s.inspectionMs === null ||
      (typeof s.inspectionMs === "number" &&
        Number.isFinite(s.inspectionMs))) &&
    (s.comment === null || typeof s.comment === "string") &&
    ["keyboard", "touch", "manual", "imported"].includes(String(s.input))
  );
}

function parse(raw: string | null): Solve | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isSolve(value) ? value : null;
  } catch {
    return null;
  }
}

const byStart = (a: Solve, b: Solve) =>
  a.startedAt - b.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * One storage entry per pending solve (`<prefix><id>`). A tab only ever writes or
 * removes its own solve's entry, so two tabs cannot overwrite each other's pending
 * solves the way a shared array read-modify-write could. The array kept under
 * `legacyKey` by earlier versions is copied into per-solve entries and removed only
 * once every entry is stored; text that does not parse is left untouched.
 */
export function createPendingJournal(
  storage: JournalStorage,
  { prefix = "cubehaus.pending.", legacyKey = "cubehaus.pending" } = {},
): PendingJournal {
  // Writes storage refused: a solve to keep (or null: a confirmation to apply).
  const unsaved = new Map<string, Solve | null>();

  function tryStore(solve: Solve): boolean {
    try {
      storage.setItem(prefix + solve.id, JSON.stringify(solve));
      return true;
    } catch {
      return false;
    }
  }

  function importLegacy() {
    let raw: string | null;
    try {
      raw = storage.getItem(legacyKey);
    } catch {
      return;
    }
    if (raw === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // Keep unreadable bytes for recovery; never erase them.
    }
    if (!Array.isArray(parsed)) return;
    let complete = true;
    for (const item of parsed) {
      if (!isSolve(item)) continue;
      let present: string | null = null;
      try {
        present = storage.getItem(prefix + item.id);
      } catch {
        complete = false;
        continue;
      }
      if (present === null && !tryStore(item)) {
        complete = false;
        unsaved.set(item.id, item);
      }
    }
    if (complete) {
      try {
        storage.removeItem(legacyKey);
      } catch {
        /* Importing again later is idempotent. */
      }
    }
  }

  function retryUnsaved() {
    for (const [id, solve] of unsaved) {
      if (solve) {
        if (tryStore(solve)) unsaved.delete(id);
      } else {
        try {
          storage.removeItem(prefix + id);
          unsaved.delete(id);
        } catch {
          /* Still refused: keep the confirmation pending. */
        }
      }
    }
  }

  function stored(): Map<string, Solve> {
    const found = new Map<string, Solve>();
    let length = 0;
    try {
      length = storage.length;
    } catch {
      return found;
    }
    const keys: string[] = [];
    for (let i = 0; i < length; i++) {
      try {
        const key = storage.key(i);
        if (key?.startsWith(prefix)) keys.push(key);
      } catch {
        /* Skip an unreadable slot. */
      }
    }
    for (const key of keys) {
      let raw: string | null = null;
      try {
        raw = storage.getItem(key);
      } catch {
        continue;
      }
      const solve = parse(raw);
      if (solve && key === prefix + solve.id) found.set(solve.id, solve);
    }
    return found;
  }

  importLegacy();

  return {
    add(solve) {
      const copy = { ...solve };
      unsaved.delete(copy.id);
      if (!tryStore(copy)) unsaved.set(copy.id, copy);
    },
    confirm(id) {
      unsaved.delete(id);
      try {
        storage.removeItem(prefix + id);
      } catch {
        unsaved.set(id, null);
      }
    },
    all() {
      importLegacy();
      retryUnsaved();
      const merged = stored();
      for (const [id, solve] of unsaved) {
        if (solve) merged.set(id, solve);
        else merged.delete(id);
      }
      return [...merged.values()].sort(byStart).map((solve) => ({ ...solve }));
    },
    durability() {
      for (const solve of unsaved.values()) if (solve) return "memory";
      return "stored";
    },
  };
}
