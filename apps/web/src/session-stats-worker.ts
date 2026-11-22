import { rolling, type Stat } from "@cubehaus/stats";

globalThis.addEventListener(
  "message",
  ({ data }: MessageEvent<{ values: Float64Array; stat: Stat }>) => {
    const result = rolling(data.values, data.stat);
    globalThis.postMessage(result);
  },
);
