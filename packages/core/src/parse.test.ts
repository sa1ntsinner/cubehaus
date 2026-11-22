import { expect, test } from "vitest";
import { parseTime } from "./index";

test.each([
  ["12.34", 12340, 0, false],
  ["12.3", 12300, 0, false],
  ["12", 12000, 0, false],
  ["1:02.35", 62350, 0, false],
  ["1:02:03.45", 3723450, 0, false],
  ["12,34", 12340, 0, false],
  ["1234", 12340, 0, false],
  ["10235", 62350, 0, false],
  ["1020345", 3723450, 0, false],
  ["12.34+", 12340, 1, false],
  ["12.34+2", 12340, 1, false],
  ["12.34+4", 12340, 2, false],
  ["dnf", 0, 0, true],
  ["d", 0, 0, true],
  ["dnf(12.34)", 12340, 0, true],
  ["12.34 dnf", 12340, 0, true],
  ["dnf(0)", 0, 0, true],
  ["12.345", 12345, 0, false],
  ["59.99", 59990, 0, false],
  ["1:00.00", 60000, 0, false],
  ["9:59.99", 599990, 0, false],
  ["10:00.00", 600000, 0, false],
  ["  DNF ( 1 : 02 , 35 )  ", 62350, 0, true],
])(
  "manual time %j parses to %i ms, %i penalties, DNF %s",
  (input, timeMs, plus2, dnf) => {
    expect(parseTime(input)).toEqual({ timeMs, plus2, dnf });
  },
);

test.each([
  "",
  " \t ",
  "12abc",
  "99:99",
  "1:60:00",
  "12.3.4",
  "-12",
  "0",
  "1.2345",
  "12+3",
  "999999999999999999",
])("invalid manual time %j returns an error sentence", (input) => {
  expect(parseTime(input)).toEqual({
    error: expect.stringMatching(/^[A-Z].+\.$/),
  });
});

test("A7b4: 17.65 + 4 = 21.65 keeps the raw time and both penalties", () => {
  expect(parseTime("17.65 +4")).toEqual({
    timeMs: 17650,
    plus2: 2,
    dnf: false,
  });
});

test("A1a2+: DNF (1:02.27) keeps the time", () => {
  expect(parseTime("DNF (1:02.27)")).toEqual({
    timeMs: 62270,
    plus2: 0,
    dnf: true,
  });
});
