import type { EventId } from "@cubehaus/core";
import { describe, expect, test } from "vitest";
import { ACTIONS, actionsForEvent, bindActions } from "./actions";
import { createKeyEngine, type KeyEvent, type KeyState } from "./engine";

function key(code: string, extra: Partial<KeyEvent> = {}): KeyEvent {
  return {
    code,
    repeat: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...extra,
  };
}

function setup(state: KeyState, isMac = true, event: EventId = "333") {
  const ran: string[] = [];
  const notYet: string[] = [];
  let blocked = false;
  let current = state;
  const actions = bindActions(
    Object.fromEntries(
      ACTIONS.filter((a) => a.id !== "solve.move").map((a) => [
        a.id,
        () => {
          ran.push(a.id);
        },
      ]),
    ),
    (spec) => notYet.push(spec.id),
    actionsForEvent(event),
  );
  const engine = createKeyEngine({
    state: () => current,
    actions: () => actions,
    isMac,
    blocked: () => blocked,
  });
  return {
    engine,
    ran,
    notYet,
    block(value: boolean) {
      blocked = value;
    },
    set(next: KeyState) {
      current = next;
    },
  };
}

describe("key engine", () => {
  test("an action runs only in its states", () => {
    const t = setup("idle");
    expect(t.engine.handle(key("Digit2"))).toBe(true);
    expect(t.ran).toEqual(["solve.plus2"]);
    t.set("inspecting");
    expect(t.engine.handle(key("Digit2"))).toBe(false);
    expect(t.ran).toEqual(["solve.plus2"]);
  });

  test("the +2 key and its help entry are absent only for Fewest Moves", () => {
    const moves = setup("idle", true, "333fm");
    expect(moves.engine.handle(key("Digit2"))).toBe(false);
    expect(moves.engine.handle(key("KeyD"))).toBe(true);
    expect(moves.ran).toEqual(["solve.dnf"]);
    expect(
      moves.engine.bindingsFor("idle").map(({ action }) => action.id),
    ).not.toContain("solve.plus2");

    const multi = setup("stopped", true, "333mbf");
    expect(multi.engine.handle(key("Digit2"))).toBe(true);
    expect(multi.ran).toEqual(["solve.plus2"]);
    expect(
      multi.engine.bindingsFor("stopped").map(({ action }) => action.id),
    ).toContain("solve.plus2");
  });

  test("while typing, plain keys pass to the field and Mod chords still act", () => {
    const t = setup("typing");
    expect(t.engine.handle(key("Digit2"))).toBe(false);
    expect(t.engine.handle(key("KeyD"))).toBe(false);
    expect(t.engine.handle(key("KeyK", { metaKey: true }))).toBe(true);
    expect(t.engine.handle(key("Escape"))).toBe(true);
    // Undo inside a text field is the field's own undo.
    expect(t.engine.handle(key("KeyZ", { metaKey: true }))).toBe(false);
    expect(t.ran).toEqual(["palette", "escape"]);
  });

  test("while running nothing here acts: any key is the timer's stop", () => {
    const t = setup("running");
    for (const code of ["Digit2", "KeyD", "Escape", "Backspace", "KeyT"])
      expect(t.engine.handle(key(code))).toBe(false);
    expect(t.ran).toEqual([]);
  });

  test("keys are physical: a Russian layout's D is still KeyD", () => {
    const t = setup("stopped");
    // On a Russian layout the D key types "в"; only `code` is read.
    expect(t.engine.handle({ ...key("KeyD"), key: "в" } as KeyEvent)).toBe(
      true,
    );
    expect(t.engine.handle(key("KeyT"))).toBe(true);
    expect(t.ran).toEqual(["solve.dnf", "progress"]);
  });

  test("Mod is Cmd on macOS and Ctrl elsewhere", () => {
    const mac = setup("idle", true);
    expect(mac.engine.handle(key("KeyZ", { metaKey: true }))).toBe(true);
    expect(mac.engine.handle(key("KeyZ", { ctrlKey: true }))).toBe(false);
    const pc = setup("idle", false);
    expect(pc.engine.handle(key("KeyZ", { ctrlKey: true }))).toBe(true);
    expect(pc.engine.handle(key("KeyZ", { metaKey: true }))).toBe(false);
  });

  test("modifiers must match exactly", () => {
    const t = setup("idle");
    expect(t.engine.handle(key("Digit2", { shiftKey: true }))).toBe(false);
    expect(t.engine.handle(key("Digit3", { altKey: true }))).toBe(true);
    expect(t.ran).toEqual(["session.3"]);
  });

  test("a held key runs its action once", () => {
    const t = setup("stopped");
    expect(t.engine.handle(key("Digit2"))).toBe(true);
    expect(t.engine.handle(key("Digit2", { repeat: true }))).toBe(true);
    expect(t.engine.handle(key("Digit2", { repeat: true }))).toBe(true);
    expect(t.ran).toEqual(["solve.plus2"]);
  });

  test("right after a stop the keys are held back", () => {
    const t = setup("stopped");
    t.block(true);
    expect(t.engine.handle(key("Backspace"))).toBe(true);
    expect(t.ran).toEqual([]);
    t.block(false);
    expect(t.engine.handle(key("Backspace"))).toBe(true);
    expect(t.ran).toEqual(["solve.delete"]);
  });

  test("an action without its screen yet says so instead of doing nothing", () => {
    const t = setup("idle");
    expect(t.engine.handle(key("KeyM"))).toBe(true);
    expect(t.notYet).toEqual(["solve.move"]);
  });

  test("one key means one thing in one state: the default table has no conflicts", () => {
    expect(setup("idle", true).engine.conflicts()).toEqual([]);
    expect(setup("idle", false).engine.conflicts()).toEqual([]);
  });

  test("conflicts are found", () => {
    const actions = bindActions({}, () => {}, [
      { id: "a", title: { en: "A", ru: "А" }, keys: ["KeyA"], when: ["idle"] },
      {
        id: "b",
        title: { en: "B", ru: "Б" },
        keys: ["KeyA"],
        when: ["idle", "stopped"],
      },
    ]);
    const engine = createKeyEngine({
      state: () => "idle",
      actions: () => actions,
      isMac: true,
    });
    expect(engine.conflicts()).toEqual([
      { key: "KeyA", state: "idle", ids: ["a", "b"] },
    ]);
  });

  test("the help lists what works in the current state", () => {
    const t = setup("idle");
    const idle = t.engine.bindingsFor("idle").map((b) => b.action.id);
    expect(idle).toContain("solve.plus2");
    expect(idle).toContain("scramble.next");
    expect(idle).toContain("help");
    const typing = t.engine.bindingsFor("typing").map((b) => b.action.id);
    expect(typing).toEqual(["palette", "escape"]);
    expect(t.engine.bindingsFor("running")).toEqual([]);
  });

  test("every action has a title in both languages and valid defaults", () => {
    for (const spec of ACTIONS) {
      expect(spec.title.en.length, spec.id).toBeGreaterThan(0);
      expect(spec.title.ru.length, spec.id).toBeGreaterThan(0);
      expect(
        spec.keys.every((key) => key.length > 0),
        spec.id,
      ).toBe(true);
    }
  });
});
