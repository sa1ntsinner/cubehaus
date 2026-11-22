import { expect, test, vi } from "vitest";
import { ACTIONS, bindActions } from "./actions";
import { createKeyEngine, type KeyEvent } from "./engine";
import { parseKeymap, resolveBindings, validateBindings } from "./keymap";

const press = (code: string): KeyEvent => ({
  code,
  repeat: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
});

test("rebound actions share one effective map in all contexts", () => {
  const map = {
    "solve.dnf": ["KeyJ"],
    "picture.zoom": ["KeyY"],
    "timer.start": ["KeyG"],
    "timer.handLeft": ["ShiftLeft"],
    "timer.handRight": ["ShiftRight"],
    "progress.close": ["KeyX"],
  };
  const dnf = vi.fn();
  const resolved = resolveBindings(ACTIONS, map);
  const engine = createKeyEngine({
    state: () => "idle",
    actions: () => bindActions({ "solve.dnf": dnf }, vi.fn(), resolved),
    isMac: true,
  });
  expect(engine.handle(press("KeyD"))).toBe(false);
  const russianJ = { ...press("KeyJ"), key: "о" };
  expect(engine.handle(russianJ)).toBe(true);
  expect(dnf).toHaveBeenCalledTimes(1);
  for (const [id, keys] of Object.entries(map))
    expect(resolved.find((spec) => spec.id === id)?.keys).toEqual(keys);

  expect(validateBindings(map, "mac")).toEqual([]);
  expect(validateBindings({ ...map, "solve.plus2": ["KeyJ"] }, "mac")).toEqual([
    { state: "idle", key: "KeyJ", ids: ["solve.dnf", "solve.plus2"] },
    { state: "stopped", key: "KeyJ", ids: ["solve.dnf", "solve.plus2"] },
  ]);
  expect(
    resolveBindings(ACTIONS, {}).find(({ id }) => id === "solve.dnf")?.keys,
  ).toEqual(["KeyD"]);
});

test("reserved browser keys and native Tab cannot replace commands", () => {
  const conflicts = validateBindings(
    { palette: ["Mod+KeyL"], "solve.dnf": ["Tab"] },
    "mac",
  );
  expect(conflicts.map(({ reason }) => reason)).toEqual([
    "reserved",
    "reserved",
  ]);
});

test("restoring a malformed keymap preserves independent bindings", () => {
  expect(
    parseKeymap(
      JSON.stringify({
        "solve.dnf": ["KeyJ"],
        "solve.plus2": ["KeyJ"],
        "picture.zoom": ["KeyD"],
        "progress.close": ["KeyX"],
      }),
    ),
  ).toEqual({ "progress.close": ["KeyX"] });
});
