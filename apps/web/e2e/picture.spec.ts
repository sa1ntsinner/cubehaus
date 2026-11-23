import { cubeState } from "@cubehaus/cube";
import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";
import { inspectionOff, sessionButton } from "./helpers";

const part = (name: string) => `[data-part="${name}"]`;
const picture = part("scramble-picture");
const drawing = part("picture-drawing");
const zoom = part("picture-zoom");
const scramble = part("scramble");
const topFace = (svg: Locator) =>
  svg
    .locator("[data-sticker]")
    .evaluateAll((stickers) =>
      stickers
        .slice(0, 9)
        .map((sticker) => sticker.getAttribute("data-sticker")),
    );

test("R F from white top and green front gives the expected nine top stickers", async ({
  page,
}) => {
  await page.goto("/?test-scramble=R%20F");
  await expect(page.locator(scramble)).toHaveText("R F");
  const svg = page.locator(picture).locator(drawing);
  await expect(svg).toBeVisible();
  expect(await topFace(svg)).toEqual(cubeState(3, "R F").U);
});

test("P hides and restores the picture across reloads", async ({ page }) => {
  await page.goto("/?test-scramble=R%20F");
  const figure = page.locator(picture);
  await expect(figure.locator("svg")).toBeVisible();
  await page.keyboard.press("KeyP");
  await expect(figure).toHaveCount(0);
  await page.reload();
  await expect(sessionButton(page)).toBeEnabled();
  await expect(page.locator(scramble)).toHaveAttribute("data-ready", "true");
  await expect(figure).toHaveCount(0);
  await page.keyboard.press("KeyP");
  await expect(figure.locator("svg")).toBeVisible();
});

test("mouse hover steps both drawings and leaving restores the whole scramble", async ({
  page,
}) => {
  await page.goto("/?test-scramble=R%20F");
  const figure = page.locator(picture);
  const line = page.locator(scramble);
  const svg = figure.locator(drawing);
  await expect(svg).toBeVisible();
  const firstMove = line.locator('[data-n="0"]');
  for (const pointerType of ["touch", "pen"]) {
    await firstMove.dispatchEvent("pointerover", { pointerType });
    await expect(line).not.toHaveAttribute("data-upto");
  }
  const originalSticker = await svg
    .locator("[data-sticker]")
    .first()
    .elementHandle();
  await firstMove.hover();
  await expect(line).toHaveAttribute("data-upto", "0");
  await expect(line.locator('[data-n="0"]')).not.toHaveAttribute("data-after");
  await expect(line.locator('[data-n="1"]')).toHaveAttribute("data-after", "");
  await expect(figure).toHaveAttribute("data-stepping", "");
  expect(await topFace(svg)).toEqual(cubeState(3, "R").U);
  expect(
    await svg
      .locator("[data-sticker]")
      .first()
      .evaluate((sticker, original) => sticker === original, originalSticker),
  ).toBe(true);
  await page.keyboard.press("KeyF");
  await expect(line).toHaveAttribute("data-over-zoom", "");
  const large = page.locator(zoom).locator(drawing);
  expect(await topFace(large)).toEqual(cubeState(3, "R").U);
  await page.mouse.move(4, 200);
  await expect(line).not.toHaveAttribute("data-upto");
  expect(await topFace(large)).toEqual(cubeState(3, "R F").U);
  await expect(figure).toHaveAttribute("data-stepping", "");
  await firstMove.hover();
  expect(await topFace(large)).toEqual(cubeState(3, "R").U);
});

test("click enlarges, and Escape, a click and Space close without timing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?test-scramble=R%20F");
  const open = page.getByRole("button", {
    name: "Enlarge the scramble picture",
  });
  const overlay = page.locator(zoom);
  const box = overlay.locator(part("picture-zoom-box"));
  await open.click();
  await expect(box).toBeVisible();
  const line = page.locator(scramble);
  const bottom = await line.evaluate(
    (element) => element.getBoundingClientRect().bottom,
  );
  await expect
    .poll(async () => (await box.boundingBox())?.y)
    .toBeCloseTo(bottom + 24, 0);
  const adjusted = await box.boundingBox();
  expect(adjusted?.height).toBeGreaterThanOrEqual(630);
  expect(
    adjusted && Math.abs(adjusted.x + adjusted.width / 2 - 720),
  ).toBeLessThanOrEqual(2);

  // With a clear top edge, the full-sized box is centered on both axes.
  await page.addStyleTag({
    content: `main > ${scramble} { position: fixed !important; top: 0; font-size: 16px; }`,
  });
  await expect
    .poll(async () => {
      const rect = await box.boundingBox();
      return rect
        ? Math.hypot(
            rect.x + rect.width / 2 - 720,
            rect.y + rect.height / 2 - 450,
          )
        : Infinity;
    })
    .toBeLessThanOrEqual(2);
  expect((await box.boundingBox())?.height).toBeGreaterThanOrEqual(630);
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);

  await page.keyboard.press("KeyF");
  await expect(overlay).toBeVisible();
  await page.mouse.click(4, 200);
  await expect(overlay).toHaveCount(0);

  await open.click();
  const main = page.locator("main");
  await main.dispatchEvent("pointerdown", {
    pointerType: "touch",
    pointerId: 5,
    button: 0,
  });
  await expect(main).toHaveAttribute("data-phase", "idle");
  await main.dispatchEvent("pointerup", {
    pointerType: "touch",
    pointerId: 5,
    button: 0,
  });
  await page.keyboard.press("Space");
  await expect(overlay).toHaveCount(0);
  await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
  await expect(page.locator(`${part("solves")} [data-solve-id]`)).toHaveCount(
    0,
  );
});

test("reduced motion opens and closes without a flight and P hides the picture", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?test-scramble=R%20F");
  const svg = page.locator(picture).locator(drawing);
  const overlay = page.locator(zoom);
  await expect(svg).toBeVisible();
  await page.keyboard.press("KeyF");
  await expect(overlay).toBeVisible();
  await expect(svg).toBeHidden();
  expect(
    await overlay.evaluate(
      (element) => element.getAnimations({ subtree: true }).length,
    ),
  ).toBe(0);
  await page.keyboard.press("KeyF");
  await expect(overlay).toHaveCount(0);
  await expect(svg).toBeVisible();
  await page.keyboard.press("KeyF");
  await expect(overlay).toBeVisible();
  await page.keyboard.press("KeyP");
  await expect(overlay).toHaveCount(0);
  await expect(page.locator(picture)).toHaveCount(0);
});

test("the picture is absent while armed and running and returns after a solve", async ({
  page,
}) => {
  await page.goto("/?test-scramble=R%20F");
  await inspectionOff(page);
  const figure = page.locator(picture);
  const main = page.locator("main");
  await expect(figure).toBeVisible();
  await page.keyboard.down("Space");
  await expect(main).toHaveAttribute("data-phase", "ready");
  await expect(figure).toHaveCount(0);
  await page.keyboard.up("Space");
  await expect(main).toHaveAttribute("data-phase", "running");
  await expect(figure).toHaveCount(0);
  await page.waitForTimeout(100);
  // The stop holds "stopped" until the key is let go; then the timer is idle.
  await page.keyboard.down("Space");
  await expect(main).toHaveAttribute("data-phase", "stopped");
  await page.keyboard.up("Space");
  await expect(main).toHaveAttribute("data-phase", "idle");
  await expect(figure).toBeVisible();
});

for (const [event, partName, count] of [
  ["pyram", "[data-sticker]", 36],
  ["skewb", "[data-sticker]", 48],
  ["minx", "[data-sticker]", 180],
  ["fto", "[data-sticker]", 72],
  ["sq1", "[data-sticker]", 52],
  ["clock", part("clock-dial"), 18],
] as const) {
  test(`${event} draws ${count} stickers or dials`, async ({ page }) => {
    await page.goto(`/?state=event-${event}`);
    await expect(page.locator(scramble)).toHaveAttribute("data-event", event);
    // The puzzle's first scramble in a page builds its search first (Square-1 most).
    await expect(page.locator(scramble)).toHaveAttribute("data-ready", "true", {
      timeout: 30_000,
    });
    const svg = page.locator(picture).locator(drawing);
    await expect(svg).toBeVisible();
    await expect(svg.locator(partName)).toHaveCount(count);
    expect(
      await svg.evaluate((element) =>
        Array.from(element.querySelectorAll("path")).every(
          (path) => !/NaN|Infinity/.test(path.getAttribute("d") ?? ""),
        ),
      ),
    ).toBe(true);
  });
}
