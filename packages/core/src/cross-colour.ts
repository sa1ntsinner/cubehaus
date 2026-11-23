/**
 * The colour a 3×3 solve's cross was built on. Stored by name (`solve.cross_colour`); a
 * solve with none (null) is one whose cross colour is not known, as every solve made
 * before the colour was recorded.
 *
 * A colour is also a face: the face it has in the scrambling orientation (WCA: white on
 * top, green in front), so the cross solver and the scramble picture can use it as is.
 */
export const CROSS_COLOURS = [
  "white",
  "yellow",
  "green",
  "blue",
  "red",
  "orange",
] as const;

export type CrossColour = (typeof CROSS_COLOURS)[number];
export type CrossFace = "U" | "D" | "F" | "B" | "R" | "L";

const FACES: Record<CrossColour, CrossFace> = {
  white: "U",
  yellow: "D",
  green: "F",
  blue: "B",
  red: "R",
  orange: "L",
};

export function isCrossColour(value: unknown): value is CrossColour {
  return (
    typeof value === "string" &&
    (CROSS_COLOURS as readonly string[]).includes(value)
  );
}

export function faceOfCrossColour(colour: CrossColour): CrossFace {
  return FACES[colour];
}

export function crossColourOfFace(face: CrossFace): CrossColour {
  return CROSS_COLOURS.find((colour) => FACES[colour] === face) as CrossColour;
}
