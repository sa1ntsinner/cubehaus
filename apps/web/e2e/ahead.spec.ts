import type { Page } from "@playwright/test";
import { officialShape } from "../../../packages/scramble/src/shapes";
import { expect, test } from "./fixtures";
import {
  createSession,
  inspectionOff,
  keyboardSolve,
  sessionButton,
  switchSession,
} from "./helpers";

// Scrambles are made ahead of time, per puzzle, and none while the page is hidden.

const part = (page: Page, name: string) =>
  page.locator(`[data-part="${name}"]`);
const scramble = (page: Page) => part(page, "scramble");
const made = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { cubehausScrambles?: string[] })
        .cubehausScrambles ?? [],
  );

// The page's visibility, set by the spec: a flag in sessionStorage outlives a reload.
async function controlVisibility(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(Document.prototype, "visibilityState", {
      configurable: true,
      get: () =>
        sessionStorage.getItem("spec-hidden") === "1" ? "hidden" : "visible",
    });
    Object.defineProperty(Document.prototype, "hidden", {
      configurable: true,
      get: () => sessionStorage.getItem("spec-hidden") === "1",
    });
  });
}
async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((hidden) => {
    sessionStorage.setItem("spec-hidden", hidden ? "1" : "0");
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

async function solveShowing(page: Page) {
  await expect(scramble(page)).toHaveAttribute("data-ready", "true");
  const shown = await scramble(page).textContent();
  // Keys are ignored for 200 ms after a stop, so a bounce cannot act.
  await page.waitForTimeout(250);
  await keyboardSolve(page);
  await expect(scramble(page)).not.toHaveText(shown ?? "");
  return shown;
}

test("each solve records the scramble that was on screen, with scrambles made ahead", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await createSession(page, "Big", "444");
  // The first 4×4 scramble of a page builds the search's tables: seconds on a busy machine.
  await expect(scramble(page)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await inspectionOff(page);
  const shown = [];
  for (let i = 0; i < 3; i++) shown.push(await solveShowing(page));
  expect(new Set(shown).size).toBe(3);
  // ↑ shows the solves before the newest, each with the scramble it was timed on (keys
  // are ignored for 200 ms after a stop, so a bounce cannot act).
  await page.waitForTimeout(250);
  for (const i of [1, 0]) {
    await page.keyboard.press("ArrowUp");
    await expect(part(page, "time-meta")).toContainText(`No. ${i + 1}`);
    await expect(scramble(page)).toHaveText(shown[i] ?? "");
  }
  // Back to now: the scramble waiting is none of them.
  await page.keyboard.press("Escape");
  await expect(scramble(page)).not.toHaveText(shown[0] ?? "");
  expect(shown).not.toContain(await scramble(page).textContent());
});

test("switching puzzles shows each puzzle's own scramble", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  for (const [name, event] of [
    ["Big", "444"],
    ["Slice", "sq1"],
    ["Minx", "minx"],
  ] as const) {
    await createSession(page, name, event);
    await expect(scramble(page)).toHaveAttribute("data-ready", "true", {
      timeout: 30_000,
    });
  }
  // Back and forth: every switch shows a scramble of the puzzle switched to, at once.
  for (const [name, event] of [
    ["3×3", "333"],
    ["Big", "444"],
    ["Minx", "minx"],
    ["Slice", "sq1"],
    ["3×3", "333"],
    ["Slice", "sq1"],
  ] as const) {
    await switchSession(page, name);
    await expect(scramble(page)).toHaveAttribute("data-event", event);
    await expect(scramble(page)).toHaveAttribute("data-ready", "true");
    await expect(scramble(page)).toHaveText(officialShape[event]);
  }
});

test("a hidden page makes no scramble ahead; shown again, it makes them", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await controlVisibility(page);
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await createSession(page, "Big", "444");
  await expect(scramble(page)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await switchSession(page, "3×3");
  await expect(scramble(page)).toHaveAttribute("data-ready", "true");

  // Loaded hidden: only the scramble on show is made.
  await page.evaluate(() => sessionStorage.setItem("spec-hidden", "1"));
  await page.reload();
  await expect(sessionButton(page)).toBeEnabled();
  await expect(scramble(page)).toHaveAttribute("data-ready", "true");
  await page.waitForTimeout(3000);
  expect(await made(page)).toEqual(["333"]);

  // Shown: the next 3×3 is made ahead, then, once idle, the first 4×4.
  await setHidden(page, false);
  await expect
    .poll(() => made(page), { timeout: 10_000 })
    .toEqual(["333", "333", "444", "444"]);

  // Hidden again: nothing more, even after a while.
  await setHidden(page, true);
  await page.waitForTimeout(3000);
  expect(await made(page)).toHaveLength(4);
});
