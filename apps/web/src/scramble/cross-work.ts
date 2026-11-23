import { type CrossColour, faceOfCrossColour } from "@cubehaus/core";
import { crossLengths } from "@cubehaus/cube/cross";

export type CrossMessage = {
  id: number;
  scramble: string;
  colours: readonly CrossColour[];
};
export type CrossReply = {
  id: number;
  lengths: Partial<Record<CrossColour, number>> | null;
};

/** Each colour's shortest cross, in cross-worker.ts off the page's thread. */
export function handleCross({
  id,
  scramble,
  colours,
}: CrossMessage): CrossReply {
  const found = crossLengths(scramble, colours.map(faceOfCrossColour));
  return {
    id,
    lengths:
      found &&
      Object.fromEntries(
        colours.map((colour) => [
          colour,
          found[faceOfCrossColour(colour)] as number,
        ]),
      ),
  };
}
