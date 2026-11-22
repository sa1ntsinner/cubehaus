import { expect, test } from "vitest";
import {
  chooseAlg,
  drillStep,
  HOLD_MS,
  myAlg,
  otherAlgs,
  parseChoices,
  reviewCase,
  reviewPool,
  showCase,
} from "./train-state";

test("a picture drill records recognition and execution from input timestamps", () => {
  let s = showCase(true);
  s = drillStep(s, { type: "shown", at: 1000 });
  // A frame later is not a new showing.
  s = drillStep(s, { type: "shown", at: 1016 });
  // A short tap does not start; recognition is the first key down.
  s = drillStep(s, { type: "down", at: 1640 });
  s = drillStep(s, { type: "up", at: 1700 });
  expect(s.phase).toBe("shown");
  s = drillStep(s, { type: "down", at: 2000 });
  expect(s.phase).toBe("holding");
  s = drillStep(s, { type: "up", at: 2000 + HOLD_MS });
  expect(s.phase).toBe("running");
  s = drillStep(s, { type: "down", at: 2300 + 1830 });
  expect(s.phase).toBe("stopped");
  expect(s.result).toEqual({ recogMs: 640, execMs: 1830 });
  // Further presses change nothing.
  expect(drillStep(s, { type: "down", at: 9000 })).toBe(s);

  // A scramble drill has no recognition.
  let m = showCase(false);
  m = drillStep(m, { type: "shown", at: 0 });
  m = drillStep(m, { type: "down", at: 10_000 });
  m = drillStep(m, { type: "up", at: 10_400 });
  m = drillStep(m, { type: "down", at: 12_400 });
  expect(m.result).toEqual({ recogMs: null, execMs: 2000 });
});

test("a press before the picture's first frame still gets its recognition", () => {
  let s = showCase(true);
  // The key comes down first; the frame's timestamp is a few ms earlier on the same clock.
  s = drillStep(s, { type: "down", at: 1010 });
  s = drillStep(s, { type: "shown", at: 1004 });
  s = drillStep(s, { type: "up", at: 1010 + HOLD_MS });
  s = drillStep(s, { type: "down", at: 1010 + HOLD_MS + 900 });
  expect(s.result).toEqual({ recogMs: 6, execMs: 900 });
});

test("review drills only the slow and the often missed", () => {
  // Y is slow against the others, Jb missed twice in its last five, T and Ua fine.
  const attempts = [
    ...["T", "Ua", "Jb", "Y"].flatMap((caseId) =>
      [0, 1, 2, 3].map((i) => ({
        caseId,
        execMs: caseId === "Y" ? 4000 : 1500,
        missed: caseId === "Jb" && i >= 2,
        at: i,
      })),
    ),
  ];
  const weak = reviewPool(attempts, ["T", "Ua", "Jb", "Y"]);
  expect(weak).toEqual(["Jb", "Y"]);
  const seen = new Set<string>();
  let last: string | null = null;
  for (const draw of [0, 0.3, 0.6, 0.9, 0.99]) {
    const id = reviewCase(weak, last, draw);
    expect(id).not.toBe(last);
    seen.add(id as string);
    last = id;
  }
  expect([...seen].sort()).toEqual(["Jb", "Y"]);
  // One weak case repeats; none gives nothing.
  expect(reviewCase(["Y"], "Y", 0.5)).toBe("Y");
  expect(reviewCase([], null, 0.5)).toBeNull();
});

test("the algorithm chosen as mine is the one shown, the others are one tap away", () => {
  const c = {
    id: "pll-T",
    algs: [
      { moves: "A B", auf: 0 },
      { moves: "C D", auf: 1 },
      { moves: "E F", auf: 0 },
    ],
  };
  // Nothing chosen: the best first.
  expect(myAlg(c, {}).moves).toBe("A B");
  expect(otherAlgs(c, {}).map((a) => a.moves)).toEqual(["C D", "E F"]);
  // Chosen: it leads, the best moves among the others.
  const mine = chooseAlg({}, "pll", c, "C D");
  expect(mine).toEqual({ "pll/pll-T": "C D" });
  expect(myAlg(c, mine, "pll").moves).toBe("C D");
  expect(otherAlgs(c, mine, "pll").map((a) => a.moves)).toEqual(["A B", "E F"]);
  // Choosing the best again forgets the choice; one no longer shipped falls back.
  expect(chooseAlg(mine, "pll", c, "A B")).toEqual({});
  expect(myAlg(c, { "pll/pll-T": "X Y" }, "pll").moves).toBe("A B");
  expect(parseChoices('{"pll/pll-T":"C D","x":3}')).toEqual({
    "pll/pll-T": "C D",
  });
  expect(parseChoices("nonsense")).toEqual({});
});
