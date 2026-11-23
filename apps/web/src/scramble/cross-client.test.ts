import { expect, it } from "vitest";
import { createCrossClient } from "./cross-client";
import { handleCross } from "./cross-work";
import type { WorkerLike } from "./training-client";

/** A worker stand-in that answers with the real handler, counting what it is asked. */
function localWorker() {
  const asked: unknown[] = [];
  const spawn = (): WorkerLike => {
    let listener: ((event: { data: unknown }) => void) | null = null;
    return {
      postMessage(message: unknown) {
        asked.push(message);
        queueMicrotask(() =>
          listener?.({ data: handleCross(message as never) }),
        );
      },
      set onmessage(handler: ((event: { data: unknown }) => void) | null) {
        listener = handler;
      },
      terminate() {},
    };
  };
  return { spawn, asked };
}

it("answers each colour's shortest cross, once per scramble", async () => {
  const { spawn, asked } = localWorker();
  const client = createCrossClient(spawn);
  expect(await client.lengths("R U", ["white", "yellow"])).toEqual({
    white: 2,
    yellow: 1,
  });
  expect(await client.lengths("R U", ["white", "yellow"])).toEqual({
    white: 2,
    yellow: 1,
  });
  expect(asked).toHaveLength(1);
  // Another colour of the same scramble is asked for on its own.
  expect(await client.lengths("R U", ["green"])).toEqual({ green: 2 });
  expect(asked).toHaveLength(2);
});

it("gives null for a scramble the solver cannot read", async () => {
  const { spawn } = localWorker();
  const client = createCrossClient(spawn);
  expect(await client.lengths("Rw U", ["white"])).toBeNull();
});
