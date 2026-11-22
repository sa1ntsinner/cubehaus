/// <reference lib="webworker" />
import type { Message } from "./training-work";

/**
 * The drill worker's entry. It holds no other code: cubing's own search worker, started
 * from inside this one, loads the chunks it shares with the drill code, and must never
 * load (and run) this handler. Messages that come while the code loads wait for it.
 */
const work = import("./training-work");

self.onmessage = async ({ data }: MessageEvent<Message>) => {
  const { handle } = await work;
  self.postMessage(await handle(data));
};
