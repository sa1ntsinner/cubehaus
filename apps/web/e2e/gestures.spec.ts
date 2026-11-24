import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  action,
  createSession,
  inspectionOff,
  keyboardSolve,
  sessionButton,
} from "./helpers";

// Touch gestures (DESIGN.md section 18a). The finger is a run of touch pointer events
// dispatched in the page, so the same steps drive Chromium and WebKit; ios.spec.ts drives
// Chromium's own touch pipeline where that matters.

interface Stroke {
  dx: number;
  dy?: number;
  /** How long the finger takes over the move. */
  ms?: number;
  /** How long it rests before moving. */
  rest?: number;
  /** Where on the part it starts, as a fraction of its box (default the centre). */
  at?: { x: number; y: number };
}

async function swipe(page: Page, selector: string, stroke: Stroke) {
  // A part still springing back from the last stroke is not where its box says.
  await page
    .locator(selector)
    .first()
    .evaluate((element) =>
      Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  const at = stroke.at ?? { x: 0.5, y: 0.5 };
  await page.evaluate(
    async ({ selector, x, y, dx, dy, ms, rest }) => {
      const part = document.querySelector(selector);
      if (!part) throw new Error(selector);
      const target = document.elementFromPoint(x, y) ?? part;
      const fire = (type: string, px: number, py: number) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            pointerId: 41,
            pointerType: "touch",
            isPrimary: true,
            button: type === "pointermove" ? -1 : 0,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: px,
            clientY: py,
          }),
        );
      const wait = (time: number) =>
        new Promise((done) => setTimeout(done, time));
      fire("pointerdown", x, y);
      if (rest) await wait(rest);
      const steps = 12;
      for (let step = 1; step <= steps; step++) {
        await wait(ms / steps);
        fire("pointermove", x + (dx * step) / steps, y + (dy * step) / steps);
      }
      fire("pointerup", x + dx, y + dy);
    },
    {
      selector,
      x: box.x + box.width * at.x,
      y: box.y + box.height * at.y,
      dx: stroke.dx,
      dy: stroke.dy ?? 0,
      ms: stroke.ms ?? 240,
      rest: stroke.rest ?? 0,
    },
  );
}

const TIME = 'main > output[data-part="time"]';
const lines = (page: Page) =>
  page.locator('[data-part="solves"] > li[data-solve-id]');

/** A solve, then the moment after a stop in which gestures wait. */
async function solve(page: Page) {
  await keyboardSolve(page);
  await page.waitForTimeout(800);
}

test.describe("touch gestures", () => {
  test.use({ hasTouch: true, isMobile: true });

  test.beforeEach(async ({ page, browserName }) => {
    test.skip(
      browserName === "firefox",
      "Firefox has no mobile emulation in Playwright",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
    await inspectionOff(page);
  });

  test("the time: right is +2, down DNF, a short or slow move nothing, left deletes; a hold that moves times", async ({
    page,
  }) => {
    await solve(page);
    const line = lines(page).first();
    await swipe(page, TIME, { dx: 120 });
    await expect(line).toHaveAttribute("data-penalty", "plus2");
    await swipe(page, TIME, { dx: 120 });
    await expect(line).not.toHaveAttribute("data-penalty", "plus2");
    await swipe(page, TIME, { dx: 0, dy: 120 });
    await expect(line).toHaveAttribute("data-penalty", "dnf");
    await swipe(page, TIME, { dx: 0, dy: 120 });
    await expect(line).not.toHaveAttribute("data-penalty", "dnf");
    // A short or slow move springs back and changes nothing.
    await swipe(page, TIME, { dx: 40, ms: 600 });
    await expect(line).toHaveAttribute("data-penalty", "ok");
    await expect(page.locator(TIME)).not.toHaveAttribute("data-swiping");
    // None of it started an attempt.
    await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
    await expect(lines(page)).toHaveCount(1);

    // Left deletes, even begun beside a short time on its row (a tenth of a second is a
    // narrow number: start to its right, on the ground); Undo brings it back.
    await swipe(page, TIME, { dx: -120, at: { x: 1.25, y: 0.5 } });
    await expect(lines(page)).toHaveCount(0);
    // The click a timing touch may still send is swallowed for 600 ms (input/touch.ts).
    await page.waitForTimeout(700);
    await action(page, "undo").click();
    await expect(lines(page)).toHaveCount(1);
    await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");

    // A hold that then moves is the timer's: it starts, it never swipes.
    await swipe(page, TIME, { dx: 150, rest: 400 });
    await expect(page.locator("main")).toHaveAttribute("data-phase", "running");
    await page.waitForTimeout(200);
    await page.keyboard.press("Space");
    await expect(lines(page)).toHaveCount(2);
    await expect(lines(page).nth(0)).toHaveAttribute("data-penalty", "ok");

    // Nothing acts in the moment after a stop, when the other hand lands.
    await page.waitForTimeout(800);
    await keyboardSolve(page);
    await swipe(page, TIME, { dx: -120 });
    await expect(lines(page)).toHaveCount(3);

    // A line of the file swiped left is deleted.
    await page.waitForTimeout(800);
    await swipe(page, '[data-part="solves"] > li[data-solve-id]:last-child', {
      dx: -140,
      at: { x: 0.7, y: 0.5 },
    });
    await expect(lines(page)).toHaveCount(2);
  });

  test("the scramble swiped left is the next one, right the one before", async ({
    page,
  }) => {
    const scramble = page.locator('main > [data-part="scramble"]');
    await expect(scramble).toHaveAttribute("data-ready", "true");
    const first = await scramble.textContent();
    await swipe(page, 'main > [data-part="scramble"]', { dx: -120 });
    await expect(scramble).not.toHaveText(first ?? "");
    await swipe(page, 'main > [data-part="scramble"]', { dx: 120 });
    await expect(scramble).toHaveText(first ?? "");
  });

  test("the session name swiped left goes to the next session", async ({
    page,
  }) => {
    await createSession(page, "Second", "333");
    await expect(sessionButton(page)).toHaveText("Second");
    await page.waitForTimeout(300);
    await swipe(page, '[data-action="session-switch"]', { dx: 120 });
    await expect(sessionButton(page)).not.toHaveText("Second");
    await expect(page.locator('dialog[data-part="switch"]')).toHaveCount(0);
  });

  test("after the second solve one hint names a gesture, and it retires once used", async ({
    page,
  }) => {
    test.skip(
      !(await page.evaluate(() => matchMedia("(hover: none)").matches)),
      "this browser does not report hover: none for an emulated phone",
    );
    const hint = page.locator('[data-part="notice"][data-kind="hint"]');
    await solve(page);
    await page.waitForTimeout(1000);
    await expect(hint).toHaveCount(0);
    await solve(page);
    await expect(hint).toContainText("Swipe the time right for +2");
    await expect(page.locator(TIME)).toHaveAttribute("data-nudge", "right");
    // Its word opens the list of gestures.
    await hint.locator('[data-action="gestures-open"]').click();
    const list = page.locator('dialog[data-part="keys-help"]');
    await expect(list).toContainText("Swipe the time ←");
    await list.locator('[data-action="dialog-close"]').click();
    // Used once: never hinted again.
    await swipe(page, TIME, { dx: 120 });
    await swipe(page, TIME, { dx: 120 });
    const learned = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("cubehaus.gestures") ?? "{}"),
    );
    expect(learned["time-right"]).toEqual({ shown: 1, used: true });
    await solve(page);
    await solve(page);
    await expect(hint).toContainText("Swipe the time down for DNF");
  });

  test("the status line's ? lists the gestures on a touch screen", async ({
    page,
  }) => {
    test.skip(
      !(await page.evaluate(
        () => matchMedia("(hover: none) and (pointer: coarse)").matches,
      )),
      "this browser does not report a touch screen for an emulated phone",
    );
    await expect(action(page, "keys")).toBeHidden();
    await action(page, "gestures").click();
    const list = page.locator('dialog[data-part="keys-help"]');
    await expect(list).toHaveAttribute("aria-label", "Gestures");
    await expect(list.locator("dt").first()).toHaveText(
      "Hold the screen, let go",
    );
    await expect(list.locator("kbd")).toHaveCount(0);
  });
});

test.describe("touch gestures in Algorithms", () => {
  test.use({ hasTouch: true, isMobile: true });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test("a case swiped in Learn goes into the drills and out again", async ({
    page,
  }) => {
    await page.goto("/#/train/pll/learn");
    const tile = page.locator('[data-part="train-case-list"] > li').nth(2);
    const pick = tile.locator('[data-action="train-pick"]');
    await expect(pick).not.toBeChecked();
    const selector = '[data-part="train-case-list"] > li:nth-child(3)';
    await swipe(page, selector, { dx: 90, at: { x: 0.3, y: 0.3 } });
    await expect(pick).toBeChecked();
    // Let it settle back into its place first.
    await page.waitForTimeout(400);
    await swipe(page, selector, { dx: -90, at: { x: 0.7, y: 0.3 } });
    await expect(pick).not.toBeChecked();
  });

  test("after a case, a swipe left is the next case and right marks it missed", async ({
    page,
  }) => {
    await page.goto("/#/train/pll/drill");
    await action(page, "train-drill-all").click();
    const drill = page.locator('[data-part="train-drill"]');
    await expect(drill).toHaveAttribute("data-phase", "shown");
    await page.keyboard.down("Space");
    await page.waitForTimeout(400);
    await page.keyboard.up("Space");
    await expect(drill).toHaveAttribute("data-phase", "running");
    await page.waitForTimeout(250);
    await page.keyboard.press("Space");
    await expect(drill).toHaveAttribute("data-phase", "stopped");
    await page.waitForTimeout(800);
    await swipe(page, '[data-part="train-stage"]', { dx: 120 });
    await expect(action(page, "train-missed")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await swipe(page, '[data-part="train-stage"]', { dx: -120 });
    await expect(drill).toHaveAttribute("data-phase", "shown");
  });
});
