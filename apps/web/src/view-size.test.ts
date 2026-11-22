import { describe, expect, test } from "vitest";
import { ACTIONS } from "./keys/actions";
import { createKeyEngine, type KeyEvent } from "./keys/engine";
import { changeSetting, loadSettings } from "./settings";
import {
  cleanSizes,
  DEFAULT_SIZES,
  sizeTarget,
  stepSize,
  VIEW_PARTS,
  type ViewSizes,
  viewSizesKey,
} from "./view-size";

function memoryStore() {
  const values = new Map<string, string>();
  return {
    values,
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

const press = (code: string, shift = false): KeyEvent => ({
  code,
  repeat: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: shift,
});

describe("view sizes", () => {
  test("sizes clamp and remember the focused part", async () => {
    let sizes: ViewSizes = DEFAULT_SIZES;
    expect(Object.values(sizes)).toEqual([100, 100, 100, 100, 100]);
    sizes = stepSize("scramble", 1, stepSize("scramble", 1, sizes));
    expect(sizes.scramble).toBe(120);
    expect(sizes.picture).toBe(100);
    for (let i = 0; i < 20; i++) sizes = stepSize("time", -1, sizes);
    expect(sizes.time).toBe(70);
    for (let i = 0; i < 20; i++) sizes = stepSize("times", 1, sizes);
    expect(sizes.times).toBe(150);
    // Nothing changes when a step would leave the range: the same object comes back.
    expect(stepSize("times", 1, sizes)).toBe(sizes);

    // Reload: the sizes are a device setting under their own key.
    const store = memoryStore();
    await changeSetting(store, "sizes", sizes, "s1", "333");
    expect(JSON.parse(store.values.get(viewSizesKey) ?? "null")).toEqual(sizes);
    expect((await loadSettings(store, "s2", "en", "222")).sizes).toEqual(sizes);
    // A stored value off the scale is read as the default for that part only.
    await store.set(
      viewSizesKey,
      JSON.stringify({ ...sizes, picture: 135, averages: "big", time: 200 }),
    );
    expect((await loadSettings(store, "s1")).sizes).toEqual({
      ...sizes,
      picture: 100,
      averages: 100,
      time: 100,
    });
    expect(cleanSizes("nonsense")).toEqual(DEFAULT_SIZES);

    // The part with the keyboard's focus wins over the one under the pointer, so a
    // keyboard-only user reaches every part; with neither, there is no target.
    for (const part of VIEW_PARTS) {
      expect(sizeTarget(part, null)).toBe(part);
      expect(sizeTarget(part, "scramble")).toBe(part);
      expect(sizeTarget(null, part)).toBe(part);
    }
    expect(sizeTarget(null, null)).toBeNull();

    // + and − are keys at rest; in a text field they type.
    let ran = "";
    const engine = (state: "idle" | "typing") =>
      createKeyEngine({
        state: () => state,
        isMac: true,
        actions: () =>
          ACTIONS.filter((spec) => spec.id.startsWith("size.")).map((spec) => ({
            ...spec,
            run: () => {
              ran = spec.id;
            },
          })),
      });
    expect(engine("idle").handle(press("Equal", true))).toBe(true);
    expect(ran).toBe("size.larger");
    expect(engine("idle").handle(press("Minus"))).toBe(true);
    expect(ran).toBe("size.smaller");
    expect(engine("idle").handle(press("NumpadAdd"))).toBe(true);
    expect(ran).toBe("size.larger");
    ran = "";
    expect(engine("typing").handle(press("Equal", true))).toBe(false);
    expect(engine("typing").handle(press("Minus"))).toBe(false);
    expect(ran).toBe("");
  });
});
