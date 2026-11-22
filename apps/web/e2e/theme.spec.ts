import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";
import { pngFixture } from "./png";

test("a saved dark choice paints dark over a light system", async ({
  page,
  browserName,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/#/settings");
  const choice = page.locator("#setting-theme");
  await expect(choice).toBeEnabled();
  await choice.selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // Hold the application entry so the frame comes from the document and CSS.
  let releaseEntry = () => {};
  const entry = new Promise<void>((resolve) => {
    releaseEntry = resolve;
  });
  await page.route(/\/assets\/index-[^/]+\.js$/, async (route) => {
    await entry;
    await route.continue();
  });
  try {
    await page.reload({ waitUntil: "commit" });
    await expect(page.locator("html")).toHaveCSS(
      "background-color",
      "rgb(0, 0, 0)",
    );
    // WebKit and Firefox take no screenshot while the entry script is held; there the
    // computed ground above is the check, and Chromium also checks the pixel.
    if (browserName === "chromium") {
      const pixel = await page.screenshot({
        clip: { x: 0, y: 0, width: 1, height: 1 },
      });
      expect(
        await page.evaluate(async (base64) => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("No canvas context");
          ctx.drawImage(image, 0, 0);
          return Array.from(ctx.getImageData(0, 0, 1, 1).data);
        }, pixel.toString("base64")),
      ).toEqual([0, 0, 0, 255]);
    }
  } finally {
    releaseEntry();
  }
  await expect(choice).toHaveValue("dark");
});

test("only the system choice follows changes to the system scheme", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/#/settings");
  const html = page.locator("html");
  const choice = page.locator("#setting-theme");
  await expect(choice).toBeEnabled();
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveAttribute("data-theme", "dark");
  await choice.selectOption("light");
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveAttribute("data-theme", "light");
});

test("the large time keeps its width when the solid face arrives", async ({
  page,
  browserName,
}) => {
  // Safari ships only on Apple systems, where Arial is always present. Playwright's
  // Linux WebKit does not resolve the metric-compatible Liberation faces by local(),
  // so the fallback there is not the one any Safari user gets.
  test.skip(
    browserName === "webkit" && process.platform === "linux",
    "Linux WebKit does not resolve local() fallbacks; Safari runs on Apple systems",
  );
  // Firefox does not fall through to the next family while the first one loads: it lays
  // the time out in its default face (the metric-matched fallback stays unloaded), so the
  // width changes once when the face arrives on a first, uncached visit.
  test.skip(
    browserName === "firefox",
    "Firefox uses its default face, not the next family, while a font loads",
  );
  let releaseFont = () => {};
  const font = new Promise<void>((resolve) => {
    releaseFont = resolve;
  });
  await page.route("**/fonts/roboto-solid.woff2", async (route) => {
    await font;
    await route.continue();
  });
  try {
    await page.goto("/?state=long", { waitUntil: "domcontentloaded" });
    const time = page.locator('[data-part="time"]');
    await expect(time).toHaveText("1:02:03");
    // Exercise the design token at display size before the screen CSS lands.
    await time.evaluate((element) => {
      element.style.cssText =
        "display:inline-block;font:700 250px var(--font-solid);font-feature-settings:'tnum' 1";
    });
    const width = () =>
      time.evaluate((element) => element.getBoundingClientRect().width);
    const before = await width();
    releaseFont();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    expect(Math.abs((await width()) - before)).toBeLessThanOrEqual(1);
  } finally {
    releaseFont();
  }
});

test("a custom theme is made, refused when unreadable, exported, imported and reset", async ({
  page,
  browserName,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/#/settings");
  const html = page.locator("html");
  const choice = page.locator("#setting-theme");
  await expect(choice).toBeEnabled();
  await choice.selectOption("dark");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await choice.selectOption("custom");
  // Made from the theme in view: dark, with its own colours until one is changed.
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#theme-base")).toHaveValue("dark");
  await page.locator("#theme-ground").fill("#121820");
  const token = (name: string) =>
    page.evaluate(
      (name) =>
        getComputedStyle(document.documentElement)
          .getPropertyValue(`--${name}`)
          .trim(),
      name,
    );
  await expect.poll(() => token("ground")).toBe("#121820");
  await expect(html).toHaveCSS("background-color", "rgb(18, 24, 32)");

  // Muted text nearly the ground: named with its contrast and not applied.
  await page.locator("#theme-gutter").fill("#202830");
  const status = page.locator('[data-part="theme-status"]');
  await expect(status).toContainText("Hard to read: Muted text");
  expect(await token("gutter")).toBe("#8a96a3");
  await page.locator('[data-action="theme-reset-colours"]').click();
  await expect(status).toBeEmpty();
  await expect.poll(() => token("ground")).toMatch(/^#0+$/);
  await page.locator("#theme-ground").fill("#121820");
  await expect.poll(() => token("ground")).toBe("#121820");

  // A picture: shown behind the timer; a file that is not one is refused.
  await page.locator('[data-action="theme-picture"] input').setInputFiles({
    name: "ground.png",
    mimeType: "image/png",
    buffer: Buffer.from(pngFixture(48, 30, [20, 30, 50])),
  });
  await expect(html).toHaveAttribute("data-image", "");
  await page.locator('[data-action="theme-picture"] input').setInputFiles({
    name: "fake.png",
    mimeType: "image/png",
    buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),
  });
  await expect(status).toHaveText(
    "Choose a PNG, JPEG or WebP picture up to 2 MB and 4096 px.",
  );
  await expect(html).toHaveAttribute("data-image", "");

  // Export, change, import: the exported theme comes back whole.
  const saving = page.waitForEvent("download");
  await page.locator('[data-action="theme-export"]').click();
  const file = await (await saving).path();
  const exported = await readFile(file, "utf8");
  expect(JSON.parse(exported)).toMatchObject({
    cubehaus: "theme",
    version: 1,
    base: "dark",
    tokens: { ground: "#121820" },
  });
  await page.locator("#theme-base").selectOption("light");
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.locator('[data-action="theme-import"] input').setInputFiles({
    name: "theme.json",
    mimeType: "application/json",
    buffer: Buffer.from(exported),
  });
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => token("ground")).toBe("#121820");
  await expect(html).toHaveAttribute("data-image", "");

  // The built-in presets and back; System follows the system scheme again.
  await choice.selectOption("light");
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(html).not.toHaveAttribute("data-image", "");
  expect(await token("ground")).toMatch(/^#f+$/i);
  await choice.selectOption("custom");
  await expect.poll(() => token("ground")).toBe("#121820");
  await choice.selectOption("system");
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveAttribute("data-theme", "dark");
  expect(await token("ground")).toMatch(/^#0+$/);
  // The keyboard reaches every colour (Safari moves Tab between text fields only, by
  // default, so this is a Chromium check).
  await choice.selectOption("custom");
  if (browserName !== "webkit") {
    await page.locator("#theme-base").focus();
    await page.keyboard.press("Tab");
    await expect(page.locator("#theme-ground")).toBeFocused();
  }
});
