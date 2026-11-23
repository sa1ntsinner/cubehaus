import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  createSession,
  inspectionOff,
  keyboardSolve,
  openSwitch,
  sessionButton,
  switchRow,
} from "./helpers";

// Daily conveniences (F4): small things a cuber reaches for every day.

const part = (page: Page, name: string) =>
  page.locator(`[data-part="${name}"]`);

test("a session picked with the pointer leaves the keyboard on the timer: Space times at once", async ({
  page,
}) => {
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await createSession(page, "Other", "333");
  await openSwitch(page);
  await switchRow(page, "3×3").locator('[data-action="switch-pick"]').click();
  await expect(sessionButton(page)).toHaveText("3×3");
  await expect(page.locator("[data-timer-surface]")).toBeFocused();
  await expect(part(page, "scramble")).toHaveAttribute("data-ready", "true");
  // Inspection is on: one press and release of Space starts it.
  await page.keyboard.press("Space");
  await expect(page.locator("main")).toHaveAttribute(
    "data-phase",
    "inspecting",
  );
  await page.keyboard.press("Escape");
});

test("Alt+C copies the solve on show as its result and scramble", async ({
  page,
}) => {
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await inspectionOff(page);
  const scramble = await part(page, "scramble").textContent();
  await keyboardSolve(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.body.setAttribute("data-copied", text);
        },
      },
    });
  });
  await page.waitForTimeout(250);
  await page.keyboard.press("Alt+KeyC");
  await expect(part(page, "notice")).toHaveText("Solve copied");
  const copied = await page.locator("body").getAttribute("data-copied");
  expect(copied).toMatch(/^\d+\.\d{2}\+? {2}/);
  expect(copied?.endsWith(`  ${scramble}`)).toBe(true);
});

test("one session alone saves as a table and for csTimer", async ({ page }) => {
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await inspectionOff(page);
  await keyboardSolve(page);
  await createSession(page, "Other", "222");
  await inspectionOff(page);
  await page.waitForTimeout(250);
  await keyboardSolve(page);
  await page.waitForTimeout(250);
  await keyboardSolve(page);

  await page.goto("/#/settings/data");
  const save = async (action: string) => {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(`[data-action="${action}"]`).click(),
    ]);
    return readFile((await download.path()) as string, "utf8");
  };
  const table = (await save("export-csv-session")).trim().split(/\r\n/);
  expect(table).toHaveLength(3);
  expect(table.slice(1).every((row) => row.includes(",Other,222,"))).toBe(true);
  const everything = (await save("export-csv")).trim().split(/\r\n/);
  expect(everything).toHaveLength(4);
  const cstimer = JSON.parse(await save("export-cstimer-session"));
  expect(Object.keys(cstimer)).toEqual(["session1", "properties"]);
  expect(cstimer.session1).toHaveLength(2);
});

test("inspection calls are off until chosen", async ({ page }) => {
  await page.goto("/#/settings/timer");
  await expect(page.locator("#setting-calls")).toHaveValue("off");
});
