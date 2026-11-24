import { MAIN_BEFORE_REVIEW, REVIEW_LIVE_AT, trainerSet } from "@cubehaus/algs";
import { expect, test } from "vitest";
import { texts } from "./text";
import {
  caseLabels,
  chooseAlg,
  drillElapsed,
  drillStep,
  FAMILIES,
  familyOf,
  HOLD_MS,
  learnGroups,
  learntChoices,
  memberOf,
  myAlg,
  ollcpGroupOf,
  ollcpMember,
  otherAlgs,
  parseChoices,
  setOfSlot,
  showCase,
  storedMember,
  storedSlot,
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

test("a case drilled before the review changed its main algorithm keeps the one learnt", () => {
  const e = trainerSet("pll").find((c) => c.label === "E");
  if (!e) throw new Error("no PLL E");
  const old = MAIN_BEFORE_REVIEW[e.id];
  const fresh = e.algs[0]?.moves;
  expect(old).toBeDefined();
  expect(fresh).not.toBe(old);
  const at = (minutes: number) => REVIEW_LIVE_AT + minutes * 60_000;
  const attempt = (caseId: string, when: number) => ({ caseId, at: when });

  // Drilled before the change, nothing chosen: the old one leads, the new one first after.
  const before = [attempt("pll-x", at(-500)), attempt(e.id, at(-60))];
  const learnt = learntChoices({}, "pll", before);
  expect(learnt).toEqual({ [`pll/${e.id}`]: old });
  expect(myAlg(e, learnt, "pll").moves).toBe(old);
  expect(otherAlgs(e, learnt, "pll")[0]?.moves).toBe(fresh);
  // The same from the same data every time, in any order of the attempts.
  expect(learntChoices({}, "pll", [...before].reverse())).toEqual(learnt);

  // First drilled after the change, or never: the new one.
  expect(learntChoices({}, "pll", [attempt(e.id, at(5))])).toEqual({});
  expect(learntChoices({}, "pll", [])).toEqual({});
  // Another set's attempts on the same id say nothing about this one.
  expect(learntChoices({}, "oll", before)).toEqual({});
  // A choice of their own always wins.
  const third = e.algs[2]?.moves ?? "";
  const mine = { [`pll/${e.id}`]: third };
  expect(learntChoices(mine, "pll", before)).toEqual(mine);

  // Choosing the new one is kept as a choice (it is not what they would see otherwise);
  // choosing the old one again forgets the choice and still shows the old one.
  const implicit = learntChoices({}, "pll", before);
  const chose = chooseAlg({}, "pll", e, fresh ?? "", implicit);
  expect(chose).toEqual({ [`pll/${e.id}`]: fresh });
  expect(myAlg(e, learntChoices(chose, "pll", before), "pll").moves).toBe(
    fresh,
  );
  const back = chooseAlg(chose, "pll", e, old ?? "", implicit);
  expect(back).toEqual({});
  expect(myAlg(e, learntChoices(back, "pll", before), "pll").moves).toBe(old);
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

test("F2L's four slots each open their own set, and the slot last chosen is read back", () => {
  expect(
    ["fr", "fl", "br", "bl"].map((slot) => setOfSlot(slot as never)),
  ).toEqual(["f2l", "f2l-left", "f2l-back", "f2l-back-left"]);
  expect(storedSlot("br")).toBe("br");
  expect(storedSlot("bl")).toBe("bl");
  // Kept from before the back slots: "left" and "right".
  expect(storedSlot("left")).toBe("fl");
  expect(storedSlot("right")).toBe("fr");
  expect(storedSlot(null)).toBe("fr");
  expect(storedSlot("nonsense")).toBe("fr");
});

test("the set row stays short: F2L, last slot and the 2×2's top in one go each stand for a family", () => {
  expect(familyOf("f2l-back")).toBe("f2l");
  expect(familyOf("ls-front")).toBe("ls");
  expect(familyOf("two-adj")).toBe("two-cll");
  expect(familyOf("two-cll")).toBe("two-cll");
  expect(familyOf("pll")).toBe("pll");
  expect(FAMILIES.ls.members).toEqual(["ls-right", "ls-front"]);
  expect(FAMILIES["two-cll"].members).toEqual([
    "two-cll",
    "two-adj",
    "two-diag",
  ]);
  // Each member is one word of the family's quiet choice, and reads back from storage.
  expect(memberOf("ls", "front")).toBe("ls-front");
  expect(memberOf("two-cll", "diag")).toBe("two-diag");
  expect(storedMember("ls", "front")).toBe("front");
  expect(storedMember("ls", "nonsense")).toBe("right");
  expect(storedMember("two-cll", null)).toBe("solved");
  expect(storedMember("f2l", "left")).toBe("fl");
});

test("F2L reads in the learner's order, numbered 1 to 41 in it, in four groups", () => {
  for (const set of ["f2l", "f2l-left", "f2l-back", "f2l-back-left"] as const) {
    const labels = caseLabels(set, trainerSet(set));
    const groups = learnGroups(set);
    const ids = groups?.flatMap((g) => g.ids) ?? [];
    expect(ids.map((id) => labels.get(id))).toEqual(
      ids.map((_, i) => `F2L ${i + 1}`),
    );
    // Every case once, its id as stored.
    expect([...ids].sort()).toEqual(
      trainerSet(set)
        .map((c) => c.id)
        .sort(),
    );
    expect(groups?.map((g) => g.en)).toEqual([
      "Both on top",
      "Edge in the slot",
      "Corner in the slot",
      "Both in the slot",
    ]);
  }
  // Other sets keep their own names and one list.
  expect(learnGroups("pll")).toBeNull();
  expect(
    caseLabels("ls-right", trainerSet("ls-right")).get("ls-right-1011"),
  ).toBe(trainerSet("ls-right").find((c) => c.id === "ls-right-1011")?.label);
});

test("the 2×2's swapped bottoms are named in the interface's language, in the set row's words", () => {
  for (const lang of ["en", "ru"] as const) {
    const words = texts[lang].train.memberWords["two-cll"];
    for (const [set, word] of [
      ["two-adj", words.adj],
      ["two-diag", words.diag],
    ] as const) {
      const labels = caseLabels(set, trainerSet(set), words);
      const cases = trainerSet(set);
      expect(cases.map((c) => labels.get(c.id))).toEqual(
        cases.map((_, i) => `${word} ${i + 1}`),
      );
    }
    // The solved bottom's cases keep CLL, as the set row's word says.
    expect(
      caseLabels("two-cll", trainerSet("two-cll"), words).get(
        trainerSet("two-cll")[0]?.id ?? "",
      ),
    ).toBe("CLL 1");
  }
  expect(
    caseLabels(
      "two-adj",
      trainerSet("two-adj"),
      texts.ru.train.memberWords["two-cll"],
    ).get(trainerSet("two-adj")[2]?.id ?? ""),
  ).toBe("Сосед 3");
});

test("a case whose main algorithm changed keeps the one chosen as mine, and says how many others there are", () => {
  // PLL E: the review put a new main algorithm first and kept the three it had.
  const e = trainerSet("pll").find((c) => c.label === "E");
  if (!e) throw new Error("no E");
  expect(e.algs).toHaveLength(4);
  const before = "x' R U' R' D R U R' D' R U R' D R U' R' D' x";
  const stored = parseChoices(JSON.stringify({ [`pll/${e.id}`]: before }));
  expect(myAlg(e, stored, "pll").moves).toBe(before);
  const others = otherAlgs(e, stored, "pll");
  expect(others).toHaveLength(3);
  expect(others[0]?.moves).toBe(e.algs[0]?.moves);
  expect(texts.en.train.more(others.length)).toBe("3 more");
  expect(texts.ru.train.more(others.length)).toBe("Ещё 3");
  // Nothing chosen: the new main leads, three more.
  expect(otherAlgs(e, {}, "pll")).toHaveLength(3);
});

test("OLLCP stands under OLL, its cases named by their number in a group", () => {
  expect(familyOf("ollcp")).toBe("oll");
  expect(familyOf("oll")).toBe("oll");
  expect(memberOf("oll", "ollcp")).toBe("ollcp");
  expect(storedMember("oll", null)).toBe("oll");
  expect(ollcpMember("OLL 27-3")).toBe("3");
  expect(ollcpMember("Skip 2")).toBe("2");
  const cases = [
    { id: "ollcp-a", label: "OLL 27-3" },
    { id: "ollcp-b", label: "OLL skip-2" },
  ] as never;
  // The group with nothing to orient takes the interface's word, as the 2×2's bottoms do.
  expect([
    ...caseLabels("ollcp", cases, undefined, "Пропуск").values(),
  ]).toEqual(["OLL 27-3", "Пропуск 2"]);
});

test("an OLLCP route names a group by its OLL case, 0 for the skip", () => {
  expect(ollcpGroupOf("27")).toBe(27);
  expect(ollcpGroupOf("0")).toBe(0);
  expect(ollcpGroupOf("58")).toBeNull();
  expect(ollcpGroupOf("x")).toBeNull();
  expect(ollcpGroupOf(undefined)).toBeNull();
});
