import { expect, test } from "vitest";
import {
  CROSS_COLOURS,
  crossColourOfFace,
  faceOfCrossColour,
  isCrossColour,
} from "./index";

test("six cross colours, white and yellow first", () => {
  expect(CROSS_COLOURS).toEqual([
    "white",
    "yellow",
    "green",
    "blue",
    "red",
    "orange",
  ]);
});

test("a colour is the face it has in the scrambling orientation (WCA: white U, green F)", () => {
  expect(faceOfCrossColour("white")).toBe("U");
  expect(faceOfCrossColour("yellow")).toBe("D");
  expect(faceOfCrossColour("green")).toBe("F");
  expect(faceOfCrossColour("blue")).toBe("B");
  expect(faceOfCrossColour("red")).toBe("R");
  expect(faceOfCrossColour("orange")).toBe("L");
  for (const colour of CROSS_COLOURS)
    expect(crossColourOfFace(faceOfCrossColour(colour))).toBe(colour);
});

test("only the six names are cross colours", () => {
  for (const colour of CROSS_COLOURS) expect(isCrossColour(colour)).toBe(true);
  for (const value of [null, undefined, "", "U", "White", "purple", 1])
    expect(isCrossColour(value)).toBe(false);
});
