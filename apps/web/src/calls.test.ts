import { describe, expect, test } from "vitest";
import { type CallMode, createCaller } from "./calls";

function setup(mode: CallMode, language: "en" | "ru" = "en") {
  const log: string[] = [];
  const caller = createCaller(
    () => ({
      mode,
      language,
      words:
        language === "ru"
          ? { 8: "8 секунд", 12: "12 секунд" }
          : { 8: "8 seconds", 12: "12 seconds" },
    }),
    {
      noise: (count) => log.push(`noise ${count}`),
      speak: (words, lang) => log.push(`speak ${words} ${lang}`),
      vibrate: (pattern) => log.push(`vibrate ${pattern.length}`),
    },
  );
  return { caller, log };
}

describe("inspection calls", () => {
  test("A3b3: tick is one burst at 8 s and two at 12 s, with a vibration", () => {
    const { caller, log } = setup("tick");
    caller.call(8);
    caller.call(12);
    expect(log).toEqual(["noise 1", "vibrate 1", "noise 2", "vibrate 3"]);
  });

  test("A3b3, A3b4: voice says the official words in the interface language", () => {
    const en = setup("voice");
    en.caller.call(8);
    expect(en.log[0]).toBe("speak 8 seconds en");
    const ru = setup("voice", "ru");
    ru.caller.call(12);
    expect(ru.log[0]).toBe("speak 12 секунд ru");
  });

  test("off makes no sound and no vibration", () => {
    const { caller, log } = setup("off");
    caller.call(8);
    caller.call(12);
    expect(log).toEqual([]);
  });

  test("an output that throws is ignored", () => {
    const caller = createCaller(
      () => ({ mode: "tick", language: "en", words: { 8: "8", 12: "12" } }),
      {
        noise: () => {
          throw new Error("no audio");
        },
      },
    );
    expect(() => caller.call(8)).not.toThrow();
  });
});
