import type { EventId } from "@cubehaus/core";

export class ScrambleTimeoutError extends Error {
  constructor() {
    super("Scramble generation timed out");
    this.name = "ScrambleTimeoutError";
  }
}

export type Generate<K extends string = EventId> = (key: K) => Promise<string>;

/**
 * Scrambles kept ready ahead of time, one queue per key: an event, or anything else
 * that makes its own scrambles (Multi-Blind with a cube count).
 */
export interface ScrambleSource<K extends string = EventId> {
  /** The oldest scramble made ahead for `key`, else a new one; then refills. */
  next(key: K): Promise<string>;
  /** Fills `key`'s queue to its depth, unless nothing may be made ahead now. */
  prefetch(key: K): void;
  /** The scrambles made ahead and not yet handed out, oldest first, by key. */
  ahead(): Partial<Record<K, string[]>>;
}

export function defaultDepth(event: EventId): number {
  return event === "444" ||
    event === "444bf" ||
    event === "333fm" ||
    event === "sq1"
    ? 2
    : 1;
}

export function createScrambleSource<K extends string = EventId>(
  generate: Generate<K>,
  options?: {
    depth?: (key: K) => number;
    /**
     * Whether scrambles may be made ahead now; a hidden page makes none, so it costs no
     * battery. A scramble asked for with `next` is made regardless.
     */
    active?: () => boolean;
    timeoutMs?: number;
    /** Runs when a generate call times out, before anything else retries. */
    onTimeout?: () => void;
  },
): ScrambleSource<K> {
  const depth =
    options?.depth ?? ((key: K) => defaultDepth(key as string as EventId));
  const active = options?.active ?? (() => true);
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const queues = new Map<K, Promise<string>[]>();
  // What each queued scramble came to, once made.
  const made = new WeakMap<Promise<string>, string>();

  function queueFor(event: K): Promise<string>[] {
    let queue = queues.get(event);
    if (!queue) {
      queue = [];
      queues.set(event, queue);
    }
    return queue;
  }

  function prepare(event: K): Promise<string> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    return new Promise<string>((resolve, reject) => {
      timeout = setTimeout(() => {
        options?.onTimeout?.();
        reject(new ScrambleTimeoutError());
      }, timeoutMs);
      generate(event).then(resolve, reject);
    }).finally(() => clearTimeout(timeout));
  }

  function prefetch(event: K): void {
    if (!active()) return;
    const queue = queueFor(event);
    const target = depth(event);
    while (queue.length < target) {
      const pending = prepare(event);
      queue.push(pending);
      void pending.then(
        (value) => made.set(pending, value),
        () => {},
      );
      // Observe background failures and remove failed entries without retrying in a loop.
      // A consumer that already took this promise still receives the original error.
      void pending.catch(() => {
        const index = queue.indexOf(pending);
        if (index !== -1) queue.splice(index, 1);
      });
    }
  }

  async function next(event: K): Promise<string> {
    prefetch(event);
    const scramble = await (queueFor(event).shift() ?? prepare(event));
    prefetch(event);
    return scramble;
  }

  function ahead(): Partial<Record<K, string[]>> {
    const out: Partial<Record<K, string[]>> = {};
    for (const [key, queue] of queues) {
      const ready = queue.flatMap((pending) => {
        const value = made.get(pending);
        return value === undefined ? [] : [value];
      });
      if (ready.length > 0) out[key] = ready;
    }
    return out;
  }

  return { next, prefetch, ahead };
}
