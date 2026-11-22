import { checkFewestMoves } from "@cubehaus/scramble/cubing";
import { expect, test } from "vitest";

test("E2c: a solution may finish in a rotation, and an unsolved cube is DNF", async () => {
  const scramble = "Rw2 U";
  expect(await checkFewestMoves(scramble, " \tu'\n2rw2' X  ")).toEqual({
    moves: 2,
  });
  expect(await checkFewestMoves(scramble, "U")).toEqual({
    dnf: expect.any(String),
  });
});

test("E2c4: invalid notation returns a DNF naming the move", async () => {
  expect(await checkFewestMoves("R", "r U M")).toEqual({
    dnf: expect.stringContaining("M"),
  });
});

test("E2d1: 80 ETM is valid and 81 ETM is DNF, including rotations", async () => {
  const solution = ["R'", ...Array<string>(79).fill("x")].join(" ");
  expect(await checkFewestMoves("R", solution)).toEqual({ moves: 1 });
  expect(await checkFewestMoves("R", `${solution} x`)).toEqual({
    dnf: expect.stringContaining("80"),
  });
});
