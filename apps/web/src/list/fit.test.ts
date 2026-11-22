import { expect, test } from "vitest";
import { fitFile } from "./fit";

const room = (height: number) => ({
  room: height,
  gap: 8,
  row: 44,
  fixed: 0,
  totalsChrome: 13,
  totals: [30, 30, 30],
});

test("a file with room keeps every line and total", () => {
  expect(fitFile(room(400))).toEqual({ lines: true, totals: 3, list: 289 });
});

test("the totals give way, last first, so one whole line stays", () => {
  // 13 + 90 + 8 + 44 = 155 for all three
  expect(fitFile(room(155))).toMatchObject({
    lines: true,
    totals: 3,
    list: 44,
  });
  expect(fitFile(room(154))).toMatchObject({
    lines: true,
    totals: 2,
    list: 73,
  });
  expect(fitFile(room(95))).toMatchObject({ lines: true, totals: 1, list: 44 });
  expect(fitFile(room(94))).toMatchObject({ lines: true, totals: 0, list: 94 });
});

test("a room under one whole line shows no part of the file", () => {
  expect(fitFile(room(44))).toEqual({ lines: true, totals: 0, list: 44 });
  expect(fitFile(room(43))).toEqual({ lines: false, totals: 0, list: 0 });
  expect(fitFile({ ...room(60), fixed: 24 })).toMatchObject({ lines: false });
});

test("nothing measured yet leaves the file as it is", () => {
  expect(fitFile({ ...room(90), row: 0 })).toEqual({
    lines: true,
    totals: 3,
    list: 90,
  });
});
