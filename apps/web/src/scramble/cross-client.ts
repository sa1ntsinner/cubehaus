import type { CrossColour } from "@cubehaus/core";
import type { CrossReply } from "./cross-work";
import type { WorkerLike } from "./training-client";

export type CrossLengths = Partial<Record<CrossColour, number>>;

export type CrossClient = {
  /** Each colour's shortest cross after the scramble; null when it cannot be read. */
  lengths(
    scramble: string,
    colours: readonly CrossColour[],
  ): Promise<CrossLengths | null>;
  close(): void;
};

/**
 * The shortest cross of each colour in play, from a worker started on first use, so a
 * result is never held up by the table (about a fifth of a second to build). Answers are
 * kept per scramble and colours.
 */
export function createCrossClient(spawn: () => WorkerLike): CrossClient {
  let worker: WorkerLike | null = null;
  let next = 0;
  const waiting = new Map<number, (reply: CrossReply) => void>();
  const known = new Map<string, Promise<CrossLengths | null>>();
  const start = () => {
    const created = spawn();
    created.onmessage = ({ data }) => {
      const reply = data as CrossReply;
      waiting.get(reply.id)?.(reply);
      waiting.delete(reply.id);
    };
    return created;
  };
  return {
    lengths(scramble, colours) {
      const key = `${colours.join(",")}\n${scramble}`;
      const kept = known.get(key);
      if (kept) return kept;
      worker ??= start();
      const id = ++next;
      const sent = worker;
      const answer = new Promise<CrossLengths | null>((resolve) => {
        waiting.set(id, (reply) => resolve(reply.lengths));
        sent.postMessage({ id, scramble, colours });
      });
      known.set(key, answer);
      if (known.size > 200) known.delete(known.keys().next().value as string);
      return answer;
    },
    close() {
      worker?.terminate();
      worker = null;
      waiting.clear();
    },
  };
}
