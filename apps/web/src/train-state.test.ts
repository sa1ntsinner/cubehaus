import { expect, test } from "vitest";
import {
  chooseAlg,
  drillElapsed,
  drillStep,
  HOLD_MS,
  myAlg,
  otherAlgs,
  parseChoices,
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
  expect(s.result).toEqual({ recogMs: 640, execMs: 1830, split: false });
  // Further presses change nothing.
  expect(drillStep(s, { type: "down", at: 9000 })).toBe(s);

  // A scramble drill has no recognition.
  let m = showCase(false);
  m = drillStep(m, { type: "shown", at: 0 });
  m = drillStep(m, { type: "down", at: 10_000 });
  m = drillStep(m, { type: "up", at: 10_400 });
  m = drillStep(m, { type: "down", at: 12_400 });
  expect(m.result).toEqual({ recogMs: null, execMs: 2000, split: false });
});

test("a split drill marks recognition with the first press and runs on to the stop", () => {
  // A picture: the clock starts with the frame that shows the case.
  let s = showCase(true, true);
  // A press before that frame is not a recognition.
  expect(drillStep(s, { type: "down", at: 990 })).toBe(s);
  s = drillStep(s, { type: "shown", at: 1000 });
  expect(s.phase).toBe("recognising");
  // A key let go (from an earlier press) changes nothing.
  expect(drillStep(s, { type: "up", at: 1100 })).toBe(s);
  s = drillStep(s, { type: "down", at: 1620 });
  expect(s.phase).toBe("running");
  s = drillStep(s, { type: "up", at: 1700 });
  expect(s.phase).toBe("running");
  s = drillStep(s, { type: "down", at: 3420 });
  expect(s.phase).toBe("stopped");
  expect(s.result).toEqual({ recogMs: 620, execMs: 1800, split: true });

  // A scramble: hold and let go as usual (the case is on the cube), then the first press
  // is the recognition.
  let m = showCase(false, true);
  m = drillStep(m, { type: "shown", at: 0 });
  m = drillStep(m, { type: "down", at: 10_000 });
  m = drillStep(m, { type: "up", at: 10_400 });
  expect(m.phase).toBe("recognising");
  m = drillStep(m, { type: "down", at: 10_900 });
  m = drillStep(m, { type: "down", at: 12_900 });
  expect(m.result).toEqual({ recogMs: 500, execMs: 2000, split: true });
  // A short hold still does not start.
  let n = showCase(false, true);
  n = drillStep(n, { type: "down", at: 0 });
  n = drillStep(n, { type: "up", at: 100 });
  expect(n.phase).toBe("shown");
});

test("a press before the picture's first frame still gets its recognition", () => {
  let s = showCase(true);
  // The key comes down first; the frame's timestamp is a few ms earlier on the same clock.
  s = drillStep(s, { type: "down", at: 1010 });
  s = drillStep(s, { type: "shown", at: 1004 });
  s = drillStep(s, { type: "up", at: 1010 + HOLD_MS });
  s = drillStep(s, { type: "down", at: 1010 + HOLD_MS + 900 });
  expect(s.result).toEqual({ recogMs: 6, execMs: 900, split: false });
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

test("the clock on screen runs from the start, and from the recognising press in a split", () => {
  let s = showCase(false);
  expect(drillElapsed(s, 5000)).toBeNull();
  s = drillStep(s, { type: "down", at: 1000 });
  expect(drillElapsed(s, 1200)).toBeNull();
  s = drillStep(s, { type: "up", at: 1000 + HOLD_MS });
  expect(drillElapsed(s, 2550)).toBe(1250);
  // A frame stamped before the start never shows a negative time.
  expect(drillElapsed(s, 1200)).toBe(0);
  s = drillStep(s, { type: "down", at: 3000 });
  // Stopped: the result shows, not the clock.
  expect(drillElapsed(s, 4000)).toBeNull();

  let p = showCase(true, true);
  p = drillStep(p, { type: "shown", at: 100 });
  expect(drillElapsed(p, 700)).toBe(600);
  p = drillStep(p, { type: "down", at: 900 });
  // Recognised: the count starts again for the execution the result will give.
  expect(drillElapsed(p, 1400)).toBe(500);
});
