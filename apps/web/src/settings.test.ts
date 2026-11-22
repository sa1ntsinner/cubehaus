import { describe, expect, test } from "vitest";
import {
  changeSetting,
  DEFAULT_SETTINGS,
  defaultSettings,
  isTrainingProfile,
  languageFrom,
  loadSettings,
  parseStoredSettings,
  resolveSettings,
} from "./settings";

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

describe("settings", () => {
  test("defaults are the official ones", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      language: "en",
      theme: "system",
      inspection: "official",
      calls: "tick",
      startMode: "space",
      holdMs: 300,
      precision: 2,
      running: "seconds",
      entry: "timer",
      picture: true,
      statSlots: {},
      layout: "lift",
      recordCue: true,
      today: false,
      training: { request: null },
      sizes: {
        scramble: 100,
        picture: 100,
        time: 100,
        averages: 100,
        times: 100,
      },
      holding: "DF",
      awake: true,
    });
  });

  test("the colours held on top and in front are kept only as a valid pair", async () => {
    const store = memoryStore();
    await changeSetting(store, "holding", "UF");
    expect((await loadSettings(store, "s1")).holding).toBe("UF");
    // Yellow on top with white in front cannot be held.
    await expect(changeSetting(store, "holding", "DU")).rejects.toThrow();
    store.values.set("settings.global", JSON.stringify({ holding: "DU" }));
    expect((await loadSettings(store, "s1")).holding).toBe("DF");
  });

  test("a drill belongs to its session and a malformed one is ignored", async () => {
    const store = memoryStore();
    const drill = { request: { kind: "easy-cross", face: "D", length: 5 } };
    await changeSetting(store, "training", drill as never, "s1");
    expect((await loadSettings(store, "s1")).training).toEqual(drill);
    expect(
      isTrainingProfile({
        request: { kind: "easy-cross", face: "D", length: 9 },
      }),
    ).toBe(false);
    expect(
      isTrainingProfile({ request: { kind: "pll", caseIds: ["oll-1"] } }),
    ).toBe(false);
    expect(isTrainingProfile({ request: { kind: "oll", caseIds: [] } })).toBe(
      true,
    );
  });

  test("layout and quiet record cue persist for the device", async () => {
    const store = memoryStore();
    await changeSetting(store, "layout", "focus", "s1");
    await changeSetting(store, "recordCue", false, "s1");
    expect(await loadSettings(store, "s2")).toMatchObject({
      layout: "focus",
      recordCue: false,
    });
    expect(
      resolveSettings({}, { layout: "times", recordCue: false }),
    ).toMatchObject({
      layout: "lift",
      recordCue: true,
    });
  });

  test("the language comes from the browser: ru-RU is Russian, anything else English", () => {
    expect(languageFrom("ru-RU")).toBe("ru");
    expect(languageFrom("ru")).toBe("ru");
    expect(languageFrom("RU-ru")).toBe("ru");
    expect(languageFrom("en-GB")).toBe("en");
    expect(languageFrom("de-DE")).toBe("en");
    expect(languageFrom(undefined)).toBe("en");
    expect(defaultSettings("ru-RU").language).toBe("ru");
  });

  test("a session's value overrides the global one, which overrides the default", () => {
    expect(
      resolveSettings(
        { calls: "voice", holdMs: 0 },
        { calls: "off", inspection: "off" },
        "en",
      ),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      calls: "off",
      holdMs: 0,
      inspection: "off",
    });
  });

  test("DESIGN §12: the picture preference is global and defaults to on", async () => {
    const store = memoryStore();
    await changeSetting(store, "picture", false);
    expect((await loadSettings(store, "s1", "en")).picture).toBe(false);
    expect((await loadSettings(store, "s2", "en")).picture).toBe(false);
    expect(resolveSettings({}, { picture: false }).picture).toBe(true);
  });

  test("malformed stored text and unknown values fall back without throwing", () => {
    expect(parseStoredSettings("{not json")).toEqual({});
    expect(parseStoredSettings("[1,2]")).toEqual({});
    expect(parseStoredSettings("null")).toEqual({});
    expect(parseStoredSettings(null)).toEqual({});
    expect(
      parseStoredSettings(
        JSON.stringify({
          calls: "bell",
          holdMs: 5000,
          precision: 4,
          running: "tenths",
          extra: true,
        }),
      ),
    ).toEqual({ running: "tenths" });
    expect(
      resolveSettings(
        { holdMs: -1 } as never,
        { language: "fr" } as never,
        "en",
      ),
    ).toEqual(DEFAULT_SETTINGS);
  });

  test("the device theme survives reload and old running values are preserved", async () => {
    const store = memoryStore();
    await changeSetting(store, "theme", "dark", "s1");
    await changeSetting(store, "running", "tenths");
    expect(await loadSettings(store, "s2", "en")).toMatchObject({
      theme: "dark",
      running: "tenths",
    });
    expect(resolveSettings({ theme: "dark" }, { theme: "light" }).theme).toBe(
      "dark",
    );
    expect(parseStoredSettings('{"theme":"unknown"}')).toEqual({});
  });

  test("changes are stored per scope and read back", async () => {
    const store = memoryStore();
    await changeSetting(store, "calls", "voice");
    await changeSetting(store, "inspection", "off", "s1");
    expect(await loadSettings(store, "s1", "en")).toMatchObject({
      calls: "voice",
      inspection: "off",
    });
    expect(await loadSettings(store, "s2", "en")).toMatchObject({
      calls: "voice",
      inspection: "official",
    });
    await expect(changeSetting(store, "holdMs", 2000)).rejects.toThrow(
      RangeError,
    );
    store.values.set("settings.global", "garbage");
    expect(await loadSettings(store, "s1", "en")).toMatchObject({
      calls: "tick",
      inspection: "off",
    });
  });

  test("a session's choice becomes its event's default for new sessions", async () => {
    const store = memoryStore();
    await changeSetting(store, "holdMs", 500);
    await changeSetting(store, "inspection", "off", "bld-a", "333bf");
    await changeSetting(store, "holdMs", 0, "bld-a", "333bf");
    // A new Blindfolded session starts from the event's choice, over the global one.
    expect(await loadSettings(store, "bld-b", "en", "333bf")).toMatchObject({
      inspection: "off",
      holdMs: 0,
    });
    // Another event and the device-wide values are untouched.
    expect(await loadSettings(store, "three", "en", "333")).toMatchObject({
      inspection: "official",
      holdMs: 500,
    });
    // The session's own value still wins over its event's.
    await changeSetting(store, "inspection", "official", "bld-c", "333bf");
    await changeSetting(store, "inspection", "off", "bld-a", "333bf");
    expect(await loadSettings(store, "bld-c", "en", "333bf")).toMatchObject({
      inspection: "official",
    });
  });
});
