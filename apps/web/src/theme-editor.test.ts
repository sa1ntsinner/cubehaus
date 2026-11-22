import { describe, expect, test } from "vitest";
import { pngFixture } from "../e2e/png";
import {
  base64FromBytes,
  bytesFromBase64,
  checkImage,
  contrastIssues,
  customThemeKey,
  exportTheme,
  importTheme,
  loadTheme,
  saveTheme,
  type ThemeDocument,
  ThemeError,
} from "./theme-editor";

function memoryStore() {
  const values = new Map<string, string>();
  return {
    values,
    full: false,
    get: async (key: string) => values.get(key) ?? null,
    async set(key: string, value: string) {
      if (this.full) throw new DOMException("full", "QuotaExceededError");
      values.set(key, value);
    },
  };
}

const png = pngFixture(4, 3, [20, 40, 60]);
const picture = (data = base64FromBytes(png), mime = "image/png") =>
  ({
    mime,
    data,
    strength: 0.2,
    tones: [0.01, 0.05],
  }) as ThemeDocument["image"];

describe("custom theme", () => {
  test("theme reset and local image survive offline reload", async () => {
    const store = memoryStore();
    const saved: ThemeDocument = {
      version: 1,
      base: "dark",
      tokens: { ink: "#F0F0F0" },
      image: picture(),
    };
    await saveTheme(store, saved);
    // A reload reads the row again: the same colour (normalised) and the same bytes.
    const back = await loadTheme(store);
    expect(back?.tokens).toEqual({ ink: "#f0f0f0" });
    expect(back?.base).toBe("dark");
    expect(bytesFromBase64(back?.image?.data ?? "")).toEqual(png);
    expect(back?.image?.mime).toBe("image/png");
    const before = store.values.get(customThemeKey);

    // A colour that is not one, and an SVG passed off as a PNG: refused, theme kept.
    await expect(
      saveTheme(store, { ...saved, tokens: { ink: "url(x)" } }),
    ).rejects.toBeInstanceOf(ThemeError);
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    await expect(
      saveTheme(store, { ...saved, image: picture(base64FromBytes(svg)) }),
    ).rejects.toBeInstanceOf(ThemeError);
    // A PNG's bytes under a JPEG's name are refused too.
    await expect(
      saveTheme(store, { ...saved, image: picture(undefined, "image/jpeg") }),
    ).rejects.toBeInstanceOf(ThemeError);
    // Storage full: the write fails and the stored theme is the old one.
    store.full = true;
    await expect(
      saveTheme(store, { ...saved, tokens: { ink: "#eeeeee" } }),
    ).rejects.toThrow();
    store.full = false;
    expect(store.values.get(customThemeKey)).toBe(before);

    // The picture removed: a reload has none.
    await saveTheme(store, { ...saved, image: null });
    expect((await loadTheme(store))?.image).toBeNull();
    // A row that no longer validates reads as no custom theme, never a throw.
    store.values.set(
      customThemeKey,
      '{"version":1,"base":"dark","tokens":{"ink":"red"}}',
    );
    expect(await loadTheme(store)).toBeNull();
  });

  test("pictures are raster, at most 2 MB and 4096 px a side", () => {
    expect(checkImage(png)).toBe("image/png");
    expect(() => checkImage(pngFixture(4097, 1, [0, 0, 0]))).toThrow(
      ThemeError,
    );
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(png);
    expect(() => checkImage(big)).toThrow(/2 MB/);
    // A JPEG header: SOI, an APP0 segment, then SOF0 with 300×200.
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11,
      0x08, 0x00, 0xc8, 0x01, 0x2c, 0x03, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(checkImage(jpeg, "image/jpeg")).toBe("image/jpeg");
  });

  test("unreadable colours are named with their contrast", () => {
    const doc: ThemeDocument = {
      version: 1,
      base: "dark",
      tokens: {},
      image: null,
    };
    expect(contrastIssues(doc)).toEqual([]);
    expect(contrastIssues({ ...doc, base: "light" })).toEqual([]);
    expect(
      contrastIssues({ ...doc, tokens: { dim: "#333333" } }).map(
        (i) => i.token,
      ),
    ).toEqual(["dim"]);
    // A bright picture at 40 % lifts the ground under the quiet grey.
    const bright = contrastIssues({
      ...doc,
      image: {
        ...(picture() as NonNullable<ThemeDocument["image"]>),
        strength: 0.4,
        tones: [0.2, 1],
      },
    });
    expect(bright.map((i) => i.token)).toContain("gutter");
  });

  test("a theme exports and imports through the same check", () => {
    const doc: ThemeDocument = {
      version: 1,
      base: "light",
      tokens: { ground: "#fdf6e3", ink: "#002b36" },
      image: picture(),
    };
    expect(importTheme(exportTheme(doc))).toEqual(doc);
    expect(() => importTheme("{}")).toThrow(ThemeError);
    expect(() => importTheme('{"cubehaus":"keymap"}')).toThrow(ThemeError);
    expect(() =>
      importTheme(
        JSON.stringify({ ...doc, tokens: { ground: "expression(1)" } }),
      ),
    ).toThrow(ThemeError);
  });
});
