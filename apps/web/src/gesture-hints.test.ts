import { describe, expect, test } from "vitest";
import {
  HINT_GAP,
  type HintMemory,
  MAX_SHOWN,
  nextHint,
  readHints,
  shownHint,
  usedGesture,
  writeHints,
} from "./gesture-hints";

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    items,
  };
}

describe("which hint, when", () => {
  test("no hint until enough solves since the last one", () => {
    expect(nextHint({}, ["time-left"], HINT_GAP - 1)).toBe(null);
    expect(nextHint({}, ["time-left"], HINT_GAP)).toBe("time-left");
  });

  test("the first gesture available that is neither used nor shown enough", () => {
    const memory: HintMemory = {
      "time-left": { shown: 0, used: true },
      "time-right": { shown: MAX_SHOWN, used: false },
    };
    expect(
      nextHint(memory, ["time-left", "time-right", "time-down"], HINT_GAP),
    ).toBe("time-down");
  });

  test("a gesture not available here is never hinted", () => {
    expect(nextHint({}, [], HINT_GAP)).toBe(null);
  });

  test("each hint shows at most MAX_SHOWN times", () => {
    let memory: HintMemory = {};
    const seen: (string | null)[] = [];
    for (let round = 0; round < MAX_SHOWN + 2; round++) {
      const hint = nextHint(memory, ["scramble"], HINT_GAP);
      seen.push(hint);
      if (hint) memory = shownHint(memory, hint);
    }
    expect(seen.filter((hint) => hint === "scramble")).toHaveLength(MAX_SHOWN);
    expect(seen.at(-1)).toBe(null);
  });

  test("using a gesture retires its hint for good", () => {
    const memory = usedGesture(shownHint({}, "row-left"), "row-left");
    expect(memory["row-left"]).toEqual({ shown: 1, used: true });
    expect(nextHint(memory, ["row-left"], 99)).toBe(null);
  });
});

describe("stored on this device", () => {
  test("written and read back", () => {
    const storage = memoryStorage();
    writeHints(storage, usedGesture({}, "drill"));
    expect(readHints(storage)).toEqual({ drill: { shown: 0, used: true } });
  });

  test("nothing stored, broken or foreign data reads as nothing learned", () => {
    expect(readHints(memoryStorage())).toEqual({});
    expect(
      readHints(memoryStorage({ "cubehaus.gestures": "{not json" })),
    ).toEqual({});
    expect(
      readHints(
        memoryStorage({
          "cubehaus.gestures": JSON.stringify({
            drill: { shown: "x", used: 1 },
            unknown: { shown: 1, used: true },
            learn: { shown: 2, used: false },
          }),
        }),
      ),
    ).toEqual({ learn: { shown: 2, used: false } });
  });

  test("a storage that throws (a private window) is not an error", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readHints(throwing)).toEqual({});
    expect(() => writeHints(throwing, {})).not.toThrow();
    expect(readHints(null)).toEqual({});
  });
});
