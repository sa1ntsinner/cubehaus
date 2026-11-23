import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOLDING,
  frontsFor,
  HOLDINGS,
  holdingFaces,
  holdingWithBottom,
  isHolding,
  renameTurns,
} from "./holding";

describe("how the cube is held", () => {
  it("the 24 ways to hold the cube are exactly the valid top and front pairs", () => {
    expect(HOLDINGS).toHaveLength(24);
    expect(new Set(HOLDINGS).size).toBe(24);
    for (const top of "UDFBRL") expect(frontsFor(top as never)).toHaveLength(4);
    expect(frontsFor("D")).toEqual(["F", "R", "B", "L"]);
    expect(isHolding("UF")).toBe(true);
    expect(isHolding("UD")).toBe(false);
    expect(isHolding("UU")).toBe(false);
    expect(isHolding("XF")).toBe(false);
  });

  it("yellow on top with green in front is the default; white on top is the scrambling orientation", () => {
    // Most people solve the white cross at the bottom, so yellow is on top.
    expect(DEFAULT_HOLDING).toBe("DF");
    expect(holdingFaces("UF")).toEqual({
      U: "U",
      D: "D",
      F: "F",
      B: "B",
      R: "R",
      L: "L",
    });
  });

  it("yellow on top with green in front puts white at the bottom and red on the left", () => {
    // Faces are named by their centre colour as scrambled: U white, D yellow, F green,
    // B blue, R red, L orange.
    expect(holdingFaces("DF")).toEqual({
      U: "D",
      D: "U",
      F: "F",
      B: "B",
      R: "L",
      L: "R",
    });
    // Green on top, white in front: x then y2 from the scrambling orientation, so
    // orange is on the right.
    expect(holdingFaces("FU").R).toBe("L");
    // Every holding is a rotation: opposite faces stay opposite, and right follows.
    for (const h of HOLDINGS) {
      const f = holdingFaces(h);
      expect(new Set(Object.values(f)).size).toBe(6);
    }
  });

  it("a scramble meant for the faces as held is renamed for the scrambling orientation", () => {
    expect(renameTurns("R U R' U2 F' D Lw", holdingFaces("DF"))).toBe(
      "L D L' D2 F' U Rw",
    );
    expect(renameTurns("R U R'", holdingFaces("UF"))).toBe("R U R'");
  });
});

describe("holdingWithBottom", () => {
  it("turns the cube whole so the colour is at the bottom, keeping the front where it can", () => {
    for (const holding of HOLDINGS)
      for (const face of ["U", "D", "F", "B", "R", "L"] as const) {
        const turned = holdingWithBottom(holding, face);
        expect(isHolding(turned)).toBe(true);
        const faces = holdingFaces(turned);
        expect(faces.D).toBe(face);
        const front = holdingFaces(holding).F;
        if (front !== face && front !== faces.U) expect(faces.F).toBe(front);
      }
    // Yellow on top, green in front; a yellow cross is white on top, green still in front.
    expect(holdingWithBottom("DF", "D")).toBe("UF");
    // A green cross: blue on top; green cannot stay in front, the old top (yellow) is.
    expect(holdingWithBottom("DF", "F")).toBe("BD");
  });
});
