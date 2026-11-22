import { readFile } from "node:fs/promises";
import { solveCross, solveXCross } from "@cubehaus/cube";
import { holdingFaces, renameTurns } from "@cubehaus/cube/holding";
import { kpuzzle333 } from "@cubehaus/scramble/cubing";
import { classifyLL, lastLayerCases } from "@cubehaus/scramble/last-layer";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  action,
  createSession,
  inspectionOff,
  keyboardSolve,
  switchSession,
} from "./helpers";

// Drill scrambles on the ordinary timer (plan task 29): the sheet, the line under the
// scramble, the cross solution, and the scramble saved with the solve.

const sheet = (page: Page) => page.locator('dialog[data-part="training"]');
const line = (page: Page) => page.locator('[data-part="drill"]');
const scramble = (page: Page) => page.locator('[data-part="scramble"]');
const solution = (page: Page) => page.locator('[data-part="drill-solution"]');
const caseButton = (page: Page, name: string) =>
  sheet(page)
    .locator('[data-part="training-case-list"] button')
    .filter({
      has: page.locator("span", { hasText: new RegExp(`^${name}$`) }),
    });

/**
 * A last-layer drill's scramble as if held white on top: the default holding (yellow on
 * top, green in front) is a z2 away, which renames back the same way.
 */
const whiteOnTop = (scramble: string) =>
  renameTurns(scramble, holdingFaces("DF"));

async function readyScramble(page: Page) {
  await expect(scramble(page)).toHaveAttribute("data-ready", "true", {
    timeout: 15_000,
  });
  return ((await scramble(page).textContent()) ?? "").trim();
}

async function pickDrill(page: Page, value: string) {
  await sheet(page).locator(`input[type="radio"][value="${value}"]`).check();
}

async function closeSheet(page: Page) {
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await inspectionOff(page);
});

test("a late PLL scramble never replaces the OLL case picked after it", async ({
  page,
}) => {
  const { oll, pll } = lastLayerCases();
  const oll27 = oll.find((c) => c.label === "OLL 27")?.id;
  const h = pll.find((c) => c.label === "H")?.id;
  await readyScramble(page);

  await page.keyboard.press("KeyL");
  await expect(sheet(page)).toBeVisible();
  // PLL with nothing picked: no scramble, and the timer does not start.
  await pickDrill(page, "pll");
  await expect(sheet(page).locator('[data-part="training-empty"]')).toHaveText(
    "Pick at least one case.",
  );
  // H alone is asked for, then OLL 27 at once, before H's scramble can arrive.
  await caseButton(page, "H").click();
  await expect(caseButton(page, "H")).toHaveAttribute("aria-pressed", "true");
  await pickDrill(page, "oll");
  // Every OLL case has its number; the search also knows the edges' shape.
  const listed = sheet(page).locator(
    '[data-part="training-case-list"] button span',
  );
  await expect(listed).toHaveCount(57);
  await expect(listed.first()).toHaveText("OLL 1");
  await sheet(page).locator('[data-part="training-query"]').fill("dot");
  await expect(listed).toHaveText([
    "OLL 1",
    "OLL 2",
    "OLL 3",
    "OLL 4",
    "OLL 17",
    "OLL 18",
    "OLL 19",
    "OLL 20",
  ]);
  await sheet(page).locator('[data-part="training-query"]').fill("27");
  await caseButton(page, "OLL 27").click();
  await expect(caseButton(page, "OLL 27")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await closeSheet(page);

  await expect(line(page)).toContainText("Drill: OLL, 1 case");
  const shown = await readyScramble(page);
  const puzzle = await kpuzzle333();
  const held = whiteOnTop(shown);
  expect(classifyLL(puzzle.defaultPattern().applyAlg(held)).oll).toBe(oll27);
  expect(classifyLL(puzzle.defaultPattern().applyAlg(held)).pll).not.toBe(h);

  await keyboardSolve(page);
  await expect(page.locator("[data-solve-id]")).toHaveCount(1);
  await page.goto("/#/settings");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('[data-action="backup-save"]').click(),
  ]);
  const backup = JSON.parse(
    await readFile((await download.path()) as string, "utf8"),
  ) as { tables: { solve: { scramble: string }[] } };
  const stored = backup.tables.solve[0]?.scramble ?? "";
  expect(stored).toBe(shown);
  // Replayed on a solved cube, the stored scramble makes OLL 27.
  expect(
    classifyLL(puzzle.defaultPattern().applyAlg(whiteOnTop(stored))).oll,
  ).toBe(oll27);
  // The setting row names the drill and leads back to the sheet.
  await expect(page.locator('[data-part="training-current"]')).toHaveText(
    "OLL, 1 case",
  );
});

test("a drill with no case picked keeps the timer from starting", async ({
  page,
}) => {
  await readyScramble(page);
  await page.keyboard.press("KeyL");
  await pickDrill(page, "pll");
  await closeSheet(page);
  await expect(scramble(page)).toHaveText("Pick at least one case.");
  await expect(line(page)).toContainText("PLL: no case picked");
  await page.keyboard.down("Space");
  await page.waitForTimeout(400);
  await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
  await page.keyboard.up("Space");
});

test("the cross and xcross solutions follow the scramble, back and forth", async ({
  page,
}) => {
  await readyScramble(page);
  await page.keyboard.press("KeyL");
  await pickDrill(page, "easy-cross");
  await sheet(page)
    .locator('[data-action="training-length"]')
    .selectOption("5");
  await sheet(page).locator('[data-action="training-face"]').selectOption("D");
  await closeSheet(page);
  await expect(line(page)).toContainText("Drill: yellow cross in 5 turns");

  const first = await readyScramble(page);
  expect(solveCross(first, "D").length).toBe(5);
  await page.keyboard.press("KeyV");
  await expect(solution(page)).toHaveAttribute("data-state", "found");
  await expect(solution(page)).toHaveText(/ \(5\)$/);
  await page.keyboard.press("KeyV");
  await expect(solution(page)).toHaveCount(0);

  // A new scramble hides it; a step back finds the first again.
  await page.keyboard.press("ArrowRight");
  const second = await readyScramble(page);
  expect(second).not.toBe(first);
  expect(solveCross(second, "D").length).toBe(5);
  await page.keyboard.press("ArrowLeft");
  await expect(scramble(page)).toHaveText(first);
  await action(page, "drill-solution").click();
  await expect(solution(page)).toHaveText(/ \(5\)$/);

  // Xcross in three on the same face: the slot is named by its two faces.
  await action(page, "drill-change").click();
  await pickDrill(page, "easy-xcross");
  await sheet(page)
    .locator('[data-action="training-length"]')
    .selectOption("3");
  await closeSheet(page);
  await expect(line(page)).toContainText("Drill: yellow xcross in 3 turns");
  const xcross = await readyScramble(page);
  expect(solveXCross(xcross, "D")?.length).toBe(3);
  await page.keyboard.press("KeyV");
  await expect(solution(page)).toHaveText(/ \(3\) · [UDFBRL]{2} slot$/);

  // Another puzzle has official scrambles and no drill; back, the drill waits as left.
  await createSession(page, "Two", "222");
  await expect(line(page)).toHaveCount(0);
  await readyScramble(page);
  await switchSession(page, "3×3");
  await expect(line(page)).toContainText("Drill: yellow xcross in 3 turns");
  await expect(scramble(page)).toHaveText(xcross);
  await page.reload();
  await expect(line(page)).toContainText("Drill: yellow xcross in 3 turns");
});

test("a search that runs too long ends and leaves the timer working", async ({
  page,
}) => {
  await page.goto("/?solver-timeout=1");
  await readyScramble(page);
  await page.keyboard.press("KeyL");
  await pickDrill(page, "cross-solved");
  await closeSheet(page);
  await expect(line(page)).toContainText("Drill: white cross solved");
  await readyScramble(page);
  await page.keyboard.press("KeyV");
  await expect(solution(page)).toHaveAttribute("data-state", "failed");
  await expect(solution(page)).toContainText("Not found.");
  await expect(action(page, "drill-retry")).toBeVisible();
  await keyboardSolve(page);
  await expect(page.locator("[data-solve-id]")).toHaveCount(1);
});

test("the sheet and the line in Russian", async ({ page }) => {
  await page.goto("/#/settings");
  await page.locator("#setting-language").selectOption("ru");
  await page.locator('[data-action="settings-close"]').click();
  await readyScramble(page);
  await page.keyboard.press("KeyL");
  await expect(sheet(page).locator("legend")).toHaveText(
    "Тренировочные скрамблы",
  );
  await pickDrill(page, "easy-cross");
  await closeSheet(page);
  await expect(line(page)).toContainText("Тренировка: белый крест, 4 хода");
  await readyScramble(page);
  await action(page, "drill-solution").click();
  await expect(solution(page)).toHaveText(/ \(4\)$/);
  await expect(action(page, "drill-solution")).toHaveText("Скрыть");
});

test.describe("on a phone", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  test("the drill is picked from Settings by touch", async ({ page }) => {
    await page.goto("/#/settings");
    await expect(page.locator('[data-part="training-current"]')).toHaveText(
      "Official",
    );
    await page.locator('[data-action="training-open"]').tap();
    await expect(sheet(page)).toBeVisible();
    await sheet(page).locator('input[value="pll"]').tap();
    await caseButton(page, "T").tap();
    await expect(caseButton(page, "T")).toHaveAttribute("aria-pressed", "true");
    await sheet(page).locator('[data-action="dialog-close"]').tap();
    await expect(sheet(page)).toHaveCount(0);
    await expect(line(page)).toContainText("Drill: PLL, 1 case");
    const shown = await readyScramble(page);
    const puzzle = await kpuzzle333();
    const t = lastLayerCases().pll.find((c) => c.label === "T")?.id;
    expect(
      classifyLL(puzzle.defaultPattern().applyAlg(whiteOnTop(shown))).pll,
    ).toBe(t);
    const box = await line(page).boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(390);
  });
});
