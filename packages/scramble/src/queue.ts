import type { EventId } from "@cubehaus/core";

export class ScrambleTimeoutError extends Error {
  constructor() {
    super("Scramble generation timed out");
    this.name = "ScrambleTimeoutError";
  }
}

export type Generate = (event: EventId) => Promise<string>;

export interface ScrambleSource {
  next(event: EventId): Promise<string>;
  prefetch(event: EventId): void;
}

export function defaultDepth(event: EventId): number {
  return event === "444" ||
    event === "444bf" ||
    event === "333fm" ||
    event === "sq1"
    ? 2
    : 1;
}

export function createScrambleSource(
  generate: Generate,
  options?: {
    depth?: (event: EventId) => number;
    timeoutMs?: number;
    /** Runs when a generate call times out, before anything else retries. */
    onTimeout?: () => void;
  },
): ScrambleSource {
  const depth = options?.depth ?? defaultDepth;
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const queues = new Map<EventId, Promise<string>[]>();

  function queueFor(event: EventId): Promise<string>[] {
    let queue = queues.get(event);
    if (!queue) {
      queue = [];
      queues.set(event, queue);
    }
    return queue;
  }

  function prepare(event: EventId): Promise<string> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    return new Promise<string>((resolve, reject) => {
      timeout = setTimeout(() => {
        options?.onTimeout?.();
        reject(new ScrambleTimeoutError());
      }, timeoutMs);
      generate(event).then(resolve, reject);
    }).finally(() => clearTimeout(timeout));
  }

  function prefetch(event: EventId): void {
    const queue = queueFor(event);
    const target = depth(event);
    while (queue.length < target) {
      const pending = prepare(event);
      queue.push(pending);
      // Observe background failures and remove failed entries without retrying in a loop.
      // A consumer that already took this promise still receives the original error.
      void pending.catch(() => {
        const index = queue.indexOf(pending);
        if (index !== -1) queue.splice(index, 1);
      });
    }
  }

  async function next(event: EventId): Promise<string> {
    prefetch(event);
    const scramble = await (queueFor(event).shift() ?? prepare(event));
    prefetch(event);
    return scramble;
  }

  return { next, prefetch };
}
