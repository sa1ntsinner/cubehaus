import { readFile } from "node:fs/promises";
import { crossLengths, solveCross } from "@cubehaus/cube";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { action, inspectionOff, keyboardSolve, sessionButton } from "./helpers";

// Colour neutrality: the cross colour assigned per scramble, kept with the solve, the
// shortest cross of each colour after it, drills on the colour, choosing the cross, and
// F2L pictures on another cross colour.

const FACE = {
  white: "U",
  yellow: "D",
  green: "F",
  blue: "B",
  red: "R",
  orange: "L",
} as const;
type Colour = keyof typeof FACE;

const mark = (page: Page) => page.locator('[data-part="cross-mark"]');
const crossLine = (page: Page) =>
  page.locator('[data-part="time-cross"]:not([data-pending])');
const scramble = (page: Page) => page.locator('[data-part="scramble"]');
const sheet = (page: Page) => page.locator('dialog[data-part="training"]');

async function readyScramble(page: Page) {
  await expect(scramble(page)).toHaveAttribute("data-ready", "true", {
    timeout: 15_000,
  });
  return ((await scramble(page).textContent()) ?? "").trim();
}

async function assign(page: Page) {
  await page.goto("/#/settings");
  const select = page.locator("#setting-cross");
  await expect(select).toBeEnabled();
  await select.selectOption("assigned");
  await expect(
    page.locator('[data-action="cross-colour"][aria-pressed="true"]'),
  ).toHaveCount(2);
  await page.goto("/#/");
  await expect(sessionButton(page)).toBeEnabled();
}

test("an assigned colour is shown, kept with the solve, and survives reload and a backup", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await inspectionOff(page);
  // Any, the default, shows nothing.
  await readyScramble(page);
  await expect(mark(page)).toHaveCount(0);

  await assign(page);
  await readyScramble(page);
  // Nothing known yet: the block starts on the person's own colour, white (yellow on top).
  await expect(mark(page)).toHaveAttribute("data-colour", "white");
  await expect(mark(page)).toHaveText("white cross");
  const timed = await readyScramble(page);
  await keyboardSolve(page);
  // The line after the solve: each colour's shortest cross, the solve's own marked.
  const lengths = crossLengths(timed, ["U", "D"]);
  await expect(crossLine(page)).toHaveText(
    `cross white ${lengths?.U} yellow ${lengths?.D}`,
  );
  await expect(crossLine(page).locator("[data-own]")).toHaveAttribute(
    "data-colour",
    "white",
  );

  await page.reload();
  await expect(sessionButton(page)).toBeEnabled();
  await expect(crossLine(page).locator("[data-own]")).toHaveAttribute(
    "data-colour",
    "white",
  );

  await page.goto("/#/settings/data");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('[data-action="backup-save"]').click(),
  ]);
  const file = (await download.path()) as string;
  const backup = JSON.parse(await readFile(file, "utf8")) as {
    tables: { solve: { scramble: string; cross_colour: string | null }[] };
  };
  expect(backup.tables.solve.map((row) => row.cross_colour)).toEqual(["white"]);
  expect(backup.tables.solve[0]?.scramble).toBe(timed);

  const other = await browser.newContext(baseURL ? { baseURL } : {});
  try {
    const fresh = await other.newPage();
    await fresh.goto("/");
    await expect(sessionButton(fresh)).toBeEnabled();
    await fresh.goto("/#/settings/data");
    await fresh
      .locator('[data-action="backup-restore"] input')
      .setInputFiles(file);
    await expect(fresh.locator('[data-part="data-result"]')).toHaveText(
      /^Restored: \d+ added/,
    );
    await fresh.goto("/#/");
    await expect(sessionButton(fresh)).toBeEnabled();
    await expect(crossLine(fresh).locator("[data-own]")).toHaveAttribute(
      "data-colour",
      "white",
    );
    await expect(mark(fresh)).toHaveAttribute("data-colour", "white");
  } finally {
    await other.close();
  }
});

test("with Any, X asks for each colour's shortest cross after a solve", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await inspectionOff(page);
  const timed = await readyScramble(page);
  await keyboardSolve(page);
  await expect(page.locator('[data-part="time-cross"]')).toHaveCount(0);
  await page.waitForTimeout(250);
  await page.keyboard.press("KeyX");
  // Every colour: which would have been the shortest.
  const lengths = crossLengths(timed, ["U", "D", "F", "B", "R", "L"]);
  await expect(crossLine(page)).toHaveText(
    `cross white ${lengths?.U} yellow ${lengths?.D} green ${lengths?.F} blue ${lengths?.B} red ${lengths?.R} orange ${lengths?.L}`,
  );
  // The solve had no colour: none is marked as its own.
  await expect(crossLine(page).locator("[data-own]")).toHaveCount(0);
  await page.keyboard.press("KeyX");
  await expect(page.locator('[data-part="time-cross"]')).toHaveCount(0);
});

test("a cross drill is made for the colour assigned to it", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await inspectionOff(page);
  await assign(page);
  await readyScramble(page);
  await page.keyboard.press("KeyL");
  await expect(sheet(page)).toBeVisible();
  await sheet(page).locator('input[type="radio"][value="easy-cross"]').check();
  // The colour is the assignment's, so the sheet offers none.
  await expect(
    sheet(page).locator('[data-action="training-face"]'),
  ).toHaveCount(0);
  await sheet(page)
    .locator('[data-action="training-length"]')
    .selectOption("3");
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await expect(
    page.locator('[data-part="drill"] > span').first(),
  ).toBeVisible();
  for (let round = 0; round < 2; round++) {
    const made = await readyScramble(page);
    const colour = (await mark(page).getAttribute("data-colour")) as Colour;
    expect(Object.keys(FACE)).toContain(colour);
    await expect(page.locator('[data-part="drill"]')).toContainText(
      "Drill: cross in 3 turns",
    );
    expect(solveCross(made, FACE[colour]).length).toBe(3);
    // The solution is for the assigned colour's cross.
    await action(page, "drill-solution").click();
    await expect(
      page.locator('[data-part="drill-solution"][data-state="found"]'),
    ).toContainText("(3)");
    await keyboardSolve(page);
    await expect(crossLine(page).locator("[data-own]")).toHaveAttribute(
      "data-colour",
      colour,
    );
  }
});

test("choosing the cross: a colour key in inspection, then every colour's shortest cross", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // Inspection off for the session: the choosing drill inspects anyway.
  await inspectionOff(page);
  await readyScramble(page);
  await page.keyboard.press("KeyL");
  await sheet(page)
    .locator('input[type="radio"][value="cross-choice"]')
    .check();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator('[data-part="drill"]')).toContainText(
    "Drill: choose the cross",
  );
  const shown = await readyScramble(page);
  await page.keyboard.down("Space");
  await page.keyboard.up("Space");
  await expect(page.locator("main")).toHaveAttribute(
    "data-phase",
    "inspecting",
  );
  const picks = page.locator('[data-action="cross-pick"]');
  await expect(picks).toHaveCount(2);
  await expect(picks.nth(0)).toHaveAttribute("data-colour", "white");
  await expect(picks.nth(1)).toHaveAttribute("data-colour", "yellow");
  await page.keyboard.press("KeyY");
  const lengths = crossLengths(shown, ["U", "D"]);
  const result = page.locator('[data-part="choice-result"]');
  await expect(result).toContainText(
    `white ${lengths?.U} yellow ${lengths?.D}`,
  );
  const over = (lengths?.D ?? 0) - Math.min(lengths?.U ?? 0, lengths?.D ?? 0);
  await expect(result.locator('[data-part="choice-over"]')).toHaveText(
    `+${over}`,
  );
  await expect(result.locator("[data-picked]")).toHaveAttribute(
    "data-colour",
    "yellow",
  );
  // The next scramble comes; no solve was kept, and no inspection is running.
  await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
  await expect.poll(() => readyScramble(page)).not.toBe(shown);
  await expect(
    page.locator('[data-part="solves"] [data-solve-id]'),
  ).toHaveCount(0);
  await expect(page.locator('[data-part="notice"]')).toHaveCount(0);

  // By pointer too: the word of a colour picks it.
  await page.keyboard.down("Space");
  await page.keyboard.up("Space");
  await picks.nth(0).click();
  await expect(result.locator("[data-picked]")).toHaveAttribute(
    "data-colour",
    "white",
  );
});

test("F2L pictures turn to another cross colour, remembered", async ({
  page,
}) => {
  await page.goto("/#/train/f2l/learn", { waitUntil: "domcontentloaded" });
  const first = page.locator('[data-part="train-case-list"] li').first();
  // The colour is said and changed in the open case, under its name.
  await expect(page.locator('[data-action="train-cross"]')).toHaveCount(0);
  await first.locator("button").first().click();
  const word = page.locator(
    '[data-part="train-case"] [data-action="train-cross"]',
  );
  await expect(word).toHaveAttribute("data-colour", "white");
  await expect(word).toHaveText("white cross");
  const fills = () =>
    first
      .locator("polygon")
      .evaluateAll((items) => items.map((item) => item.getAttribute("fill")));
  const white = await fills();
  // Own colour, its opposite, then the other pairs.
  await word.click();
  await expect(word).toHaveAttribute("data-colour", "yellow");
  const yellow = await fills();
  expect(yellow).not.toEqual(white);
  // The same stickers stay grey, so the case and its slot are the same: only colours move.
  expect(yellow.map((fill) => fill === "var(--pz-grey)")).toEqual(
    white.map((fill) => fill === "var(--pz-grey)"),
  );
  await page.reload();
  await first.locator("button").first().click();
  await expect(word).toHaveAttribute("data-colour", "yellow");
});
