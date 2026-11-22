import {
  CROSS_MOVES,
  type Face,
  solveCross,
  solveXCross,
  unframedMove,
} from "@cubehaus/cube";
import { generateTraining } from "@cubehaus/scramble/training";
import type { TrainingProfile } from "./training-client";

/**
 * Drill scrambles and cross or xcross solutions, run in training-worker.ts off the page's
 * thread. The tables are built on the first request of each kind and kept while the
 * worker lives.
 */
export type Message =
  | { id: number; type: "training"; profile: TrainingProfile }
  | {
      id: number;
      type: "solution";
      scramble: string;
      face: Face;
      kind: "cross" | "xcross";
    };

const random = () => {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return (value[0] as number) / 2 ** 32;
};

export async function handle(data: Message): Promise<{
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}> {
  try {
    if (data.type === "training") {
      const request = data.profile.request;
      if (!request) throw new Error("No drill chosen");
      const value = await generateTraining(request, random);
      return { id: data.id, ok: true, value };
    }
    if (data.kind === "cross") {
      const value = solveCross(data.scramble, data.face);
      return { id: data.id, ok: true, value };
    }
    const found = solveXCross(data.scramble, data.face, { maxDepth: 14 });
    // The slot by the two side faces it sits between, in the scramble's frame.
    const side = (name: string) =>
      (found
        ? unframedMove(CROSS_MOVES.indexOf(name), data.face, found.slot)[0]
        : "U") as Face;
    const value = found && { ...found, pair: [side("F"), side("R")] };
    return { id: data.id, ok: true, value };
  } catch (error) {
    return {
      id: data.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
