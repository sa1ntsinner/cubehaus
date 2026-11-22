/**
 * The scrambles of the ordinary timer, kept so ← and → can go back to one and forward
 * again without making new ones. Each context (a puzzle, a Multi-Blind cube count, later
 * a training profile) keeps its own last 32 and its own place among them, so switching
 * puzzles and back finds the scramble that was waiting. Separate from going through
 * past solves, which have their own scrambles.
 */
export interface ScrambleHistory {
  /** Makes `key` the context the steps act on; its history and place are kept. */
  reset(key: string): void;
  /** The scramble on show in the context, or null before its first. */
  current(): string | null;
  /** Whether a step back has a scramble to go to. */
  canStepBack(): boolean;
  /** Whether a step forward finds a scramble already made. */
  hasNext(): boolean;
  /**
   * Back one (null when there is none), or forward one: a scramble already made, else a
   * new one from the source. Resolves to null when the context changed while it waited:
   * the new scramble is then kept in its own context. A failed source rejects and leaves
   * the place as it was.
   */
  step(direction: -1 | 1): Promise<string | null>;
}

const size = 32;

interface Context {
  entries: string[];
  cursor: number;
  revision: number;
  /** The request for the next new scramble, shared by steps made while it waits. */
  pending: Promise<string> | null;
}

export function createScrambleHistory(
  source: (key: string) => Promise<string>,
): ScrambleHistory {
  const contexts = new Map<string, Context>();
  let key = "";
  // Bumped on every switch, so a step that waited across one shows nothing.
  let generation = 0;

  function context(): Context {
    let found = contexts.get(key);
    if (!found) {
      found = { entries: [], cursor: -1, revision: 0, pending: null };
      contexts.set(key, found);
    }
    return found;
  }

  function fresh(own: Context, ownKey: string): Promise<string> {
    const revision = own.revision;
    own.pending ??= source(ownKey).then(
      (value) => {
        own.pending = null;
        own.entries.push(value);
        if (own.entries.length > size) {
          own.entries.shift();
          own.cursor = Math.max(0, own.cursor - 1);
        }
        if (own.revision === revision) own.cursor = own.entries.length - 1;
        return value;
      },
      (error: unknown) => {
        own.pending = null;
        throw error;
      },
    );
    return own.pending;
  }

  return {
    reset(next) {
      if (next === key && contexts.has(next)) return;
      key = next;
      generation++;
    },
    current() {
      const own = context();
      return own.entries[own.cursor] ?? null;
    },
    canStepBack() {
      return context().cursor > 0;
    },
    hasNext() {
      const own = context();
      return own.cursor + 1 < own.entries.length;
    },
    async step(direction) {
      const own = context();
      if (direction === -1) {
        if (own.cursor <= 0) return null;
        own.revision++;
        own.cursor--;
        return own.entries[own.cursor] ?? null;
      }
      if (own.cursor + 1 < own.entries.length) {
        own.revision++;
        own.cursor++;
        return own.entries[own.cursor] ?? null;
      }
      const asked = generation;
      const revision = own.revision;
      const value = await fresh(own, key);
      return asked === generation && revision === own.revision ? value : null;
    },
  };
}
