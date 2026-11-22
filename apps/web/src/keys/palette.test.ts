import { expect, test } from "vitest";
import { actionsForEvent, bindActions } from "./actions";
import { matchActions } from "./Palette";

const timerActions = (event: "333" | "333fm" | "333mbf") =>
  bindActions(
    {},
    () => {},
    actionsForEvent(event).filter(
      (spec) => spec.when.includes("idle") && !spec.input,
    ),
  );
const actions = timerActions("333");

test("the palette finds actions by title in the current language", () => {
  expect(matchActions(actions, "undo", "en").map((a) => a.id)).toEqual([
    "undo",
  ]);
  expect(matchActions(actions, "сесси", "ru").map((a) => a.id)).toContain(
    "session.switch",
  );
  expect(matchActions(actions, "prev sess", "en").map((a) => a.id)).toEqual([
    "session.previous",
  ]);
  expect(matchActions(actions, "", "en")).toHaveLength(actions.length);
  expect(matchActions(actions, "zzz", "en")).toEqual([]);
});

test("the palette offers +2 for Multi-Blind and omits it for Fewest Moves", () => {
  const moves = timerActions("333fm");
  const multi = timerActions("333mbf");
  expect(matchActions(moves, "+2", "en")).toEqual([]);
  expect(matchActions(moves, "DNF", "en").map(({ id }) => id)).toEqual([
    "solve.dnf",
  ]);
  expect(matchActions(multi, "+2", "en").map(({ id }) => id)).toEqual([
    "solve.plus2",
  ]);
});
