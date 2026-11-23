/// <reference lib="webworker" />
import { type CrossMessage, handleCross } from "./cross-work";

/** Shortest crosses per colour; the table is built on the first message and kept. */
self.onmessage = ({ data }: MessageEvent<CrossMessage>) => {
  self.postMessage(handleCross(data));
};
