import { describe, expect, test } from "vitest";
import { officialTokens, toOfficial } from "./official";

describe("toOfficial: the library's scramble as the official program writes it", () => {
  test("E38: a blindfolded orientation suffix turns Uw, not Dw", () => {
    expect(toOfficial("333bf", "R U F2 Rw Dw'")).toBe("R U F2 Rw Uw'");
    expect(toOfficial("333bf", "R U F2 Fw' Dw2")).toBe("R U F2 Fw' Uw2");
    expect(toOfficial("333bf", "R U F2 Dw")).toBe("R U F2 Uw");
    expect(toOfficial("333bf", "D R U F2")).toBe("D R U F2");
    expect(toOfficial("333mbf", "R U Dw\nF D2 Rw Dw2")).toBe(
      "R U Uw\nF D2 Rw Uw2",
    );
  });

  test("E39: Clock pins in the order UR DR DL UL U R D L ALL, then y2", () => {
    const raw =
      "U4- R2- D5+ L5- ALL2+ UR4- DR5+ DL2+ UL4+ y2 U4- R1+ D3- L4- ALL3+";
    expect(toOfficial("clock", raw)).toBe(
      "UR4- DR5+ DL2+ UL4+ U4- R2- D5+ L5- ALL2+ y2 U4- R1+ D3- L4- ALL3+",
    );
    expect(officialTokens("clock", toOfficial("clock", raw))).toEqual([
      "UR4-",
      "DR5+",
      "DL2+",
      "UL4+",
      "U4-",
      "R2-",
      "D5+",
      "L5-",
      "ALL2+",
      "y2",
      "U4-",
      "R1+",
      "D3-",
      "L4-",
      "ALL3+",
    ]);
  });

  test("E40: Square-1 writes (x,y) with no space", () => {
    const official = toOfficial("sq1", "(0, 5) / (-3, 0) / (4, -2) /");
    expect(official).toBe("(0,5) / (-3,0) / (4,-2) /");
    expect(official).toMatch(/^\(-?\d,-?\d\)/);
  });

  test("E41: 2x2x2 turns only U R F", () => {
    expect(toOfficial("222", "U F L R F' L2 U' R")).not.toMatch(/[LDB]/);
  });

  test("E42: 6x6x6 turns three layers only from R F U", () => {
    expect(toOfficial("666", "3Lw 3Dw2 3Bw' R Uw")).not.toMatch(/3[LDB]w/);
  });

  test("events the official program writes the same way come back unchanged", () => {
    const samples: [Parameters<typeof toOfficial>[0], string][] = [
      ["333", "R F2 U F' D' U' R2 F2 D2 B2 D U2 B' R2 D2 U' L' D2 U'"],
      ["444", "L2 D' B2 Uw Fw' Rw"],
      ["555", "Dw Lw2 R2 Bw2"],
      ["777", "F R' 3Bw' Bw"],
      ["minx", "R-- D++ R++ D-- U'\nR++ D-- R-- D++ U"],
      ["pyram", "B R B' U' R U' R U' B' R' L l b'"],
      ["skewb", "B L U L' R' U' R L' R B' R'"],
      ["444bf", "L2 D' B2 Uw R L' z' y'"],
    ];
    for (const [event, scramble] of samples) {
      expect(toOfficial(event, scramble)).toBe(scramble);
    }
  });

  test("text that is not a scramble of that event comes back unchanged and never throws", () => {
    for (const text of ["", "hello", "(((", "R U R' U'", "ALL9+ y3"]) {
      expect(() => toOfficial("clock", text)).not.toThrow();
      expect(() => toOfficial("222", text)).not.toThrow();
      expect(() => toOfficial("sq1", text)).not.toThrow();
    }
    expect(toOfficial("222", "hello")).toBe("hello");
  });
});

describe("officialTokens", () => {
  test("splits on spaces and line breaks, and keeps a Square-1 unit whole", () => {
    expect(officialTokens("333", "R U\nF'")).toEqual(["R", "U", "F'"]);
    expect(officialTokens("sq1", "(0,5) / (-3,0) /")).toEqual([
      "(0,5)",
      "/",
      "(-3,0)",
      "/",
    ]);
  });
});
