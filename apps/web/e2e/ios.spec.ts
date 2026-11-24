import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { action, inspectionOff, keyboardSolve, openSwitch } from "./helpers";

/** A finger at a point, through Chromium's own touch pipeline (CDP). */
async function finger(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  return async (type: "down" | "up", at?: { x: number; y: number }) => {
    await cdp.send("Input.dispatchTouchEvent", {
      type: type === "down" ? "touchStart" : "touchEnd",
      touchPoints: type === "down" && at ? [at] : [],
    });
  };
}

async function centreOf(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Guards for what iOS Safari showed in the simulator. The
// simulator itself is the check for what an emulated browser cannot show; these hold the
// CSS and markup the fixes rest on.
test.describe("on a phone", () => {
  test.use({ hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
  });

  test("a text field is at least 16 px, so iOS does not zoom into it", async ({
    page,
  }) => {
    test.skip(
      !(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)),
      "this browser does not report a coarse pointer for an emulated touch screen",
    );
    await inspectionOff(page);
    await keyboardSolve(page);
    const latest = page
      .locator('[data-part="solves"] > li[data-solve-id]')
      .last();
    await latest.locator('[data-action="comment-edit"]').tap();
    const field = page.locator('[data-part="comment-input"]');
    await expect(field).toBeVisible();
    const size = await field.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
    expect(size).toBeGreaterThanOrEqual(16);
  });

  test("a downward drag never reaches the page as pull to refresh", async ({
    page,
  }) => {
    for (const element of ["html", "body"])
      await expect(page.locator(element)).toHaveCSS(
        "overscroll-behavior-y",
        "none",
      );
  });

  test("while the on-screen keyboard shows, the session sheet ends above it", async ({
    page,
  }) => {
    await expect(action(page, "session-switch")).toBeEnabled();
    await openSwitch(page);
    const sheet = page.locator('dialog[data-part="switch"]');
    const height = () =>
      sheet.evaluate((element) => element.getBoundingClientRect().bottom);
    expect(await height()).toBe(844);
    // What input/keyboard-inset.ts sets from the visual viewport while the keys show.
    await page.evaluate(() =>
      document.documentElement.style.setProperty("--keyboard-inset", "330px"),
    );
    expect(await height()).toBe(844 - 330);
  });

  // DESIGN.md section 7: while inspecting only the count, the scramble and its picture
  // stay. On iOS the file and the status line stayed; and a touch where they were must
  // be the timer's, not an unseen link's.
  test("inspection hides the file and the status line, and a touch there holds", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "needs CDP touch");
    await keyboardSolve(page);
    const main = page.locator("main");
    const touch = await finger(page);
    const time = await centreOf(page, 'main > output[data-part="time"]');
    await touch("down", time);
    await touch("up");
    await expect(main).toHaveAttribute("data-phase", "inspecting");
    for (const part of ["file", "stats", "status-line", "last-actions"])
      await expect(page.locator(`main > [data-part="${part}"]`)).toHaveCSS(
        "opacity",
        "0",
      );
    await expect(page.locator('main > [data-part="scramble"]')).toHaveCSS(
      "opacity",
      "1",
    );
    const settings = await centreOf(page, '[data-action="settings"]');
    await touch("down", settings);
    await expect(main).toHaveAttribute("data-phase", "holding");
    // Held during inspection, the file stays hidden and the scramble readable.
    await expect(page.locator('main > [data-part="file"]')).toHaveCSS(
      "opacity",
      "0",
    );
    await expect(page.locator('main > [data-part="scramble"]')).toHaveCSS(
      "opacity",
      "1",
    );
    await touch("up");
    await expect(main).toHaveAttribute("data-phase", "inspecting");
    await expect(page).not.toHaveURL(/#\/settings/);
  });

  // iOS spends the first tap on a hover that reveals something: Comment waited for one.
  test("on a touch screen Comment stands on the line on show, one tap away", async ({
    page,
  }) => {
    test.skip(
      !(await page.evaluate(() => matchMedia("(hover: none)").matches)),
      "this browser does not report hover: none for an emulated touch screen",
    );
    await inspectionOff(page);
    await keyboardSolve(page);
    await keyboardSolve(page);
    const lines = page.locator('[data-part="solves"] > li[data-solve-id]');
    const comment = (line: number) =>
      lines.nth(line).locator('[data-action="comment-edit"]');
    // Newest first in the markup: the newest line offers it, the older one does not.
    await expect(comment(0)).toHaveCSS("opacity", "1");
    await expect(comment(1)).toHaveCSS("opacity", "0");
    await lines.nth(1).locator('[data-action="solve-show"]').tap();
    await expect(lines.nth(1)).toHaveAttribute("data-shown");
    await expect(comment(1)).toHaveCSS("opacity", "1");
    await expect(comment(0)).toHaveCSS("opacity", "0");
    await comment(1).tap();
    await expect(page.locator('[data-part="comment-input"]')).toBeFocused();
  });

  test("while a solve runs, a finger on the file scrolls nothing", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "needs CDP touch");
    await inspectionOff(page);
    const solves = page.locator('[data-part="solves"]');
    await keyboardSolve(page);
    await expect(solves).toHaveCSS("touch-action", "pan-y");
    const touch = await finger(page);
    const time = await centreOf(page, 'main > output[data-part="time"]');
    await touch("down", time);
    await page.waitForTimeout(400);
    await touch("up");
    await expect(page.locator("main")).toHaveAttribute("data-phase", "running");
    await expect(solves).toHaveCSS("touch-action", "none");
    await touch("down", time);
    await touch("up");
    await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
  });

  // Both hands come off the cube to stop, rarely together: the second, landing just after
  // the first has lifted, must not start the next attempt.
  test("the second hand landing just after the stop starts nothing", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "needs CDP touch");
    await inspectionOff(page);
    const main = page.locator("main");
    const touch = await finger(page);
    const time = await centreOf(page, 'main > output[data-part="time"]');
    await touch("down", time);
    await page.waitForTimeout(400);
    await touch("up");
    await expect(main).toHaveAttribute("data-phase", "running");
    await page.waitForTimeout(300);
    await touch("down", time);
    await touch("up");
    await expect(main).toHaveAttribute("data-phase", "idle");
    await touch("down", { x: time.x + 40, y: time.y });
    await page.waitForTimeout(350);
    await expect(main).toHaveAttribute("data-phase", "idle");
    await touch("up");
    await expect(main).toHaveAttribute("data-phase", "idle");
    await expect(
      page.locator('[data-part="solves"] > li[data-solve-id]'),
    ).toHaveCount(1);
  });
});
