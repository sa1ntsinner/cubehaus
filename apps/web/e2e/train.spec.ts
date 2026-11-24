import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { sessionButton } from "./helpers";

const part = (page: Page, name: string) =>
  page.locator(`[data-part="${name}"]`);
const action = (page: Page, name: string) =>
  page.locator(`[data-action="${name}"]`);

async function addCase(page: Page, label: string) {
  await part(page, "train-case-list")
    .locator(`li button[aria-label="${label}"]`)
    .click();
  await expect(part(page, "train-case").locator("h2")).toHaveText(label);
  // Beside the list, the case's own tile puts it in the drills.
  const pick = part(page, "train-case-list")
    .locator("li")
    .filter({ has: page.locator(`button[aria-label="${label}"]`) })
    .locator('[data-action="train-pick"]');
  await pick.check();
  await expect(pick).toBeChecked();
}

/** Hold Space past the hold time, let go to start, press to stop. */
async function attempt(page: Page) {
  const drill = part(page, "train-drill");
  await expect(drill).toHaveAttribute("data-phase", "shown");
  await page.keyboard.down("Space");
  await expect(drill).toHaveAttribute("data-phase", "holding");
  await page.waitForTimeout(400);
  await page.keyboard.up("Space");
  await expect(drill).toHaveAttribute("data-phase", "running");
  await page.waitForTimeout(250);
  await page.keyboard.press("Space");
  await expect(drill).toHaveAttribute("data-phase", "stopped");
  await expect(part(page, "train-result")).toBeVisible();
}

test("a picture drill records recognition and execution apart from solves", async ({
  page,
}) => {
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await action(page, "train").click();
  await expect(page).toHaveURL(/#\/train$/);
  await expect(page.locator("h1")).toHaveText("Algorithms");

  // Learn: every PLL case, each with how to recognise it and its algorithms.
  await expect(part(page, "train-case-list").locator("li")).toHaveCount(21);
  await addCase(page, "T");
  await expect(part(page, "train-recognise")).not.toBeEmpty();
  await expect(part(page, "train-alg").first()).toContainText("R U R'");
  await addCase(page, "Y");

  // Drill: the picture's case, timed from the input events.
  await action(page, "train-mode").filter({ hasText: "Drill" }).click();
  await expect(page).toHaveURL(/#\/train\/pll\/drill$/);
  await expect(part(page, "train-picture").locator("svg")).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await attempt(page);
    const numbers = part(page, "train-numbers");
    await expect(numbers).toContainText("recognition");
    const time = await part(page, "train-time").textContent();
    // The hold does not count: about the quarter second between start and stop.
    expect(Number(time)).toBeGreaterThanOrEqual(0.2);
    expect(Number(time)).toBeLessThan(2);
    const label = await part(page, "train-label").textContent();
    expect(["T", "Y"]).toContain(label);
    // M marks it missed; the time turns hollow.
    await page.keyboard.press("KeyM");
    await expect(action(page, "train-missed")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(part(page, "train-time")).toHaveAttribute("data-missed", "");
    await page.keyboard.press("Space");
  }

  // After a reload both cases were missed twice: Review has them.
  await page.reload();
  await page.goto("/#/train/pll/review");
  await expect(part(page, "train-picture").locator("svg")).toBeVisible();
  await expect(part(page, "train-empty")).toHaveCount(0);

  // Learn still knows which cases are being learnt.
  await action(page, "train-mode").filter({ hasText: "Learn" }).click();
  await expect(
    part(page, "train-case-list").locator("button[data-learning]"),
  ).toHaveCount(2);

  // None of it is a solve: the timer's averages and Progress are untouched.
  await page.goto("/#/");
  await expect(sessionButton(page)).toBeEnabled();
  await expect(
    page.locator('[data-part="solves"] [data-solve-id]'),
  ).toHaveCount(0);
  await action(page, "progress").click();
  await expect(page).toHaveURL(/#\/progress$/);
  await expect(page.locator('[data-part="progress-empty"]')).toBeVisible();
});

test("a scramble drill records execution only", async ({ page }) => {
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await page.goto("/#/train/pll/learn");
  await addCase(page, "Ua");
  await action(page, "train-mode").filter({ hasText: "Drill" }).click();
  await part(page, "train-show")
    .locator("button", { hasText: "Scramble" })
    .click();
  await expect(part(page, "train-scramble")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 20_000 },
  );
  await attempt(page);
  // With a scramble the person sees the case on the cube, which nothing here sees.
  await expect(part(page, "train-numbers")).not.toContainText("recognition");
  await expect(part(page, "train-label")).toHaveText("Ua");

  // The way of showing is remembered.
  await page.reload();
  await expect(part(page, "train-scramble")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 20_000 },
  );
  await expect(
    part(page, "train-show").locator("button", { hasText: "Scramble" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("review takes what is due, then the missed, each with its look-alike", async ({
  page,
}) => {
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await page.goto("/#/train/pll/learn");
  for (const label of ["T", "Y", "Ua"]) await addCase(page, label);
  // A case just added is due: Review says so before its first case.
  await page.goto("/#/train/pll/review");
  await expect(part(page, "train-today")).toHaveText("3 due");

  // Drill until Y has been missed twice; the others are done right.
  await page.goto("/#/train/pll/drill");
  let misses = 0;
  for (let i = 0; i < 12 && misses < 2; i++) {
    await attempt(page);
    if ((await part(page, "train-label").textContent()) === "Y") {
      await page.keyboard.press("KeyM");
      await expect(part(page, "train-time")).toHaveAttribute("data-missed", "");
      misses++;
    }
    await page.keyboard.press("Space");
  }
  expect(misses).toBe(2);

  await action(page, "train-mode").filter({ hasText: "Review" }).click();
  // The route changes on the next hashchange: wait for Review before pressing.
  await expect(page.locator('main[data-part="train"]')).toHaveAttribute(
    "data-mode",
    "review",
  );
  // Y (due again, or missed twice in five), then T, its look-alike among the cases
  // being learnt, back to back; then nothing more today.
  await expect(part(page, "train-today")).toHaveText(/^1 (due|missed)$/);
  await attempt(page);
  await expect(part(page, "train-label")).toHaveText("Y");
  await page.keyboard.press("Space");
  await expect(part(page, "train-today")).toHaveCount(0);
  await attempt(page);
  await expect(part(page, "train-label")).toHaveText("T");
  await page.keyboard.press("Space");
  await expect(part(page, "train-empty")).toBeVisible();
});

test("every case of a set can be drilled without adding any", async ({
  page,
}) => {
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await page.goto("/#/train/oll/drill");
  await expect(part(page, "train-empty")).toBeVisible();
  await action(page, "train-drill-all").click();
  await attempt(page);
  await expect(part(page, "train-label")).toHaveText(/^OLL \d+$/);
  await page.keyboard.press("Space");
  await attempt(page);

  // The choice is the set's and stays; nothing was added to the person's own cases. With
  // none of their own, Mine and All are no choice, and the drill does not offer it.
  await page.reload();
  await expect(part(page, "train-label")).toHaveCount(0);
  await expect(part(page, "train-picture")).toBeVisible();
  await expect(page.locator('[data-action="train-pool"]')).toHaveCount(0);
  await page.goto("/#/train/pll/drill");
  await expect(part(page, "train-empty")).toBeVisible();
  await page.goto("/#/train/oll/learn");
  await expect(
    part(page, "train-case-list").locator("button[data-learning]"),
  ).toHaveCount(0);

  // One case of their own: Mine and All differ, and Mine drills that case alone.
  await part(page, "train-pick")
    .filter({ hasText: /^OLL 1$/ })
    .locator("input")
    .check();
  await page.goto("/#/train/oll/drill");
  await expect(
    page.locator('[data-action="train-pool"][data-pool="all"]'),
  ).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-action="train-pool"][data-pool="mine"]').click();
  await attempt(page);
  await expect(part(page, "train-label")).toHaveText("OLL 1");
});

test("the colour held on top colours every case picture", async ({ page }) => {
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  // Yellow on top by default.
  await page.goto("/#/train/pll/learn");
  const top = part(page, "train-case-list")
    .locator("li")
    .first()
    .locator("rect")
    .first();
  await expect(top).toHaveAttribute("fill", "var(--pz-D)");
  await page.goto("/#/settings/look");
  await page.locator("#setting-holdingTop").selectOption("U");
  // Only the four colours that can be in front with white on top.
  await expect(page.locator("#setting-holdingFront option")).toHaveCount(4);
  await expect(page.locator("#setting-holdingFront")).toHaveValue("F");
  await page.goto("/#/train/pll/learn");
  await expect(top).toHaveAttribute("fill", "var(--pz-U)");
});

test("cases go into the drills and out in one tap each", async ({ page }) => {
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await page.goto("/#/train/oll/learn");
  const picked = part(page, "train-case-list").locator("input:checked");
  await expect(picked).toHaveCount(0);
  // No None: All and 2-look are presets, and the one in use, pressed again, empties the
  // drills.
  await expect(action(page, "train-none")).toHaveCount(0);
  await expect(action(page, "train-all")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  // 2-look: exactly its ten cases.
  await action(page, "train-two-look").click();
  await expect(picked).toHaveCount(10);
  await expect(action(page, "train-two-look")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // One checkbox: one case more, without opening it.
  await part(page, "train-pick")
    .filter({ hasText: /^OLL 1$/ })
    .locator("input")
    .check();
  await expect(picked).toHaveCount(11);
  await expect(part(page, "train-case")).toHaveCount(0);
  await action(page, "train-all").click();
  await expect(picked).toHaveCount(57);
  await expect(action(page, "train-all")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await action(page, "train-all").click();
  await expect(picked).toHaveCount(0);
  await action(page, "train-two-look").click();
  await expect(picked).toHaveCount(10);
  await action(page, "train-two-look").click();
  await expect(picked).toHaveCount(0);
  // PLL has its 2-look too.
  await page.goto("/#/train/pll/learn");
  await action(page, "train-two-look").click();
  await expect(picked).toHaveCount(6);
});

test("on a phone, back from a case lands on its tile where the list was", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await page.goto("/#/train/oll/learn");
  const tile = page.locator(
    '[data-part="train-case-list"] li[data-case-id] button[aria-label="OLL 40"]',
  );
  await tile.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);
  await tile.click();
  await expect(part(page, "train-case")).toBeVisible();
  await action(page, "train-case-close").click();
  await expect(part(page, "train-case")).toHaveCount(0);
  await expect(tile).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});

test("an algorithm chosen as mine is the one Learn and the drill show", async ({
  page,
}) => {
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await page.goto("/#/train/pll/learn");
  await addCase(page, "Ga");
  const main = part(page, "train-alg")
    .first()
    .locator('[data-part="train-moves"]');
  const best = (await main.textContent())?.replace(/\s+/g, " ").trim();
  await action(page, "train-more").click();
  const other = part(page, "train-algs")
    .nth(1)
    .locator('[data-part="train-moves"]')
    .first();
  const chosen = (await other.textContent())?.replace(/\s+/g, " ").trim();
  expect(chosen).not.toBe(best);
  await action(page, "train-use").first().click();
  await expect(main).toHaveText(chosen as string, { useInnerText: true });
  // The choice and the added case are written as the page goes on; a reload at once can
  // end the database worker before the write. Another set and back reads both from the
  // database, after the writes, so the reload below finds them stored.
  await page.locator('[data-action="train-set"][data-set="oll"]').click();
  await expect(part(page, "train-case-list").locator("li")).toHaveCount(57);
  await page.locator('[data-action="train-set"][data-set="pll"]').click();
  await page
    .locator('[data-part="train-case-list"] li button[aria-label="Ga"]')
    .click();
  await expect(main).toHaveText(chosen as string, { useInnerText: true });
  // Kept after a reload, and the drill's answer gives it.
  await page.reload();
  await page
    .locator('[data-part="train-case-list"] li button[aria-label="Ga"]')
    .click();
  await expect(main).toHaveText(chosen as string, { useInnerText: true });
  await action(page, "train-mode").filter({ hasText: "Drill" }).click();
  await attempt(page);
  const answer = (
    await part(page, "train-answer")
      .locator('[data-part="train-moves"]')
      .textContent()
  )
    ?.replace(/\s+/g, " ")
    .trim();
  expect(answer).toBe(chosen);
});

test("F2L: the 41 cases from above each slot, each slot learnt and drilled on its own", async ({
  page,
}) => {
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await page.goto("/#/train/f2l/learn");
  await expect(
    action(page, "train-slot").filter({ hasText: "FR" }),
  ).toHaveAttribute("aria-pressed", "true");
  // In a learner's order, numbered in it, in four groups by where the pair is.
  await expect(part(page, "train-group-name")).toHaveText([
    "Both on top",
    "Edge in the slot",
    "Corner in the slot",
    "Both in the slot",
  ]);
  await expect(
    part(page, "train-case-list").first().locator("li button").first(),
  ).toHaveAttribute("aria-label", "F2L 1");
  for (const [label, route, letters, mirrored] of [
    ["FR", "f2l", /^[RUF'2\s]+$/, false],
    ["FL", "f2l-left", /^[LUF'2\s]+$/, true],
    ["BR", "f2l-back", /^[RUB'2\s]+$/, false],
    ["BL", "f2l-back-left", /^[LUB'2\s]+$/, true],
  ] as const) {
    await action(page, "train-slot").filter({ hasText: label }).click();
    await expect(page).toHaveURL(new RegExp(`#/train/${route}/learn$`));
    await expect(
      action(page, "train-set").filter({ hasText: "F2L" }),
    ).toHaveAttribute("aria-pressed", "true");
    // The same 41, numbered the same; a slot's drills are its own.
    await expect(part(page, "train-case-list").locator("li")).toHaveCount(41);
    await expect(
      part(page, "train-case-list")
        .locator("li")
        .filter({ has: page.locator('button[aria-label="F2L 13"]') })
        .locator('[data-action="train-pick"]'),
      label,
    ).not.toBeChecked();
    // A case: the slot drawn from above its corner, its algorithm in that slot's faces,
    // and one line that says what it does.
    await addCase(page, "F2L 13");
    const picture = part(page, "train-case").locator('svg[data-shape="slot"]');
    await expect(picture).toBeVisible();
    if (mirrored) await expect(picture).toHaveAttribute("data-mirrored", "");
    else await expect(picture).not.toHaveAttribute("data-mirrored");
    await expect(
      part(page, "train-alg").first().locator('[data-part="train-moves"]'),
    ).toHaveText(letters);
    await expect(part(page, "train-recognise")).not.toBeEmpty();
    // Drilled by picture, then by a scramble that leads to the case.
    await action(page, "train-mode").filter({ hasText: "Drill" }).click();
    await expect(page).toHaveURL(new RegExp(`#/train/${route}/drill$`));
    await expect(
      part(page, "train-picture").locator('svg[data-shape="slot"]'),
    ).toBeVisible();
    await attempt(page);
    await expect(part(page, "train-label")).toHaveText("F2L 13");
    await page.keyboard.press("Space");
    await part(page, "train-show")
      .locator("button", { hasText: "Scramble" })
      .click();
    await expect(part(page, "train-scramble")).toHaveAttribute(
      "data-ready",
      "true",
      { timeout: 20_000 },
    );
    await part(page, "train-show")
      .locator("button", { hasText: "Picture" })
      .click();
    await action(page, "train-mode").filter({ hasText: "Learn" }).click();
  }
  // The tab remembers the last slot.
  await action(page, "train-set").filter({ hasText: "PLL" }).click();
  await action(page, "train-set").filter({ hasText: "F2L" }).click();
  await expect(page).toHaveURL(/#\/train\/f2l-back-left\/learn$/);
});

test("the 2×2: its sets from the puzzle word, learnt and drilled like the 3×3's", async ({
  page,
}) => {
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await page.goto("/#/train/pll/learn");
  // One word, the other puzzle: the sets already say which one is open.
  await expect(action(page, "train-puzzle")).toHaveText("2×2");
  await action(page, "train-puzzle").click();
  await expect(action(page, "train-puzzle")).toHaveText("3×3");
  await expect(page).toHaveURL(/#\/train\/two-oll\/learn$/);
  // The 2×2's sets take the row; the 3×3's are gone from it.
  await expect(action(page, "train-set")).toHaveText(["OLL", "PBL", "CLL"]);
  for (const [set, count] of [
    ["two-oll", 7],
    ["two-pbl", 5],
    ["two-cll", 42],
  ] as const) {
    await page.locator(`[data-action="train-set"][data-set="${set}"]`).click();
    await expect(part(page, "train-case-list").locator("li")).toHaveCount(
      count,
    );
  }
  await page.locator('[data-action="train-set"][data-set="two-pbl"]').click();
  await addCase(page, "PBL 1");
  await expect(
    part(page, "train-case").locator('svg[data-shape="two"]'),
  ).toBeVisible();
  await expect(
    part(page, "train-alg").first().locator('[data-part="train-moves"]'),
  ).toHaveText(/^[RUF'2\s]+$/);
  // Drilled by picture, then by a scramble shipped with the case.
  await action(page, "train-mode").filter({ hasText: "Drill" }).click();
  await attempt(page);
  await expect(part(page, "train-label")).toHaveText("PBL 1");
  await page.keyboard.press("Space");
  await part(page, "train-show")
    .locator("button", { hasText: "Scramble" })
    .click();
  await expect(part(page, "train-scramble")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(part(page, "train-scramble")).toHaveText(/^[RUFLBD'2\s]+$/);
  await part(page, "train-show")
    .locator("button", { hasText: "Picture" })
    .click();
  // Back to the 3×3: the set it was left on.
  await action(page, "train-puzzle").click();
  await expect(page).toHaveURL(/#\/train\/pll\/drill$/);
});

/** Review: what is due, each case followed at once by its look-alike, then nothing. */
async function reviewInOrder(page: Page, labels: readonly string[]) {
  await action(page, "train-mode").filter({ hasText: "Review" }).click();
  await expect(page.locator('main[data-part="train"]')).toHaveAttribute(
    "data-mode",
    "review",
  );
  await expect(part(page, "train-today")).toHaveText(`${labels.length} due`);
  for (const label of labels) {
    await attempt(page);
    await expect(part(page, "train-label")).toHaveText(label);
    await page.keyboard.press("Space");
  }
  await expect(part(page, "train-empty")).toBeVisible();
}

test("last slot: one word in the row, two inserts, each learnt, drilled and reviewed", async ({
  page,
}) => {
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await page.goto("/#/train/pll/learn");
  await expect(action(page, "train-set")).toHaveText([
    "PLL",
    "OLL",
    "COLL",
    "F2L",
    "LS",
  ]);
  await action(page, "train-set").filter({ hasText: "LS" }).click();
  await expect(page).toHaveURL(/#\/train\/ls-right\/learn$/);
  await expect(
    action(page, "train-member").filter({ hasText: "R U' R'" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(part(page, "train-case-list").locator("li")).toHaveCount(26);
  // A case: its top as it is read, and beside it the cube from above the slot.
  await addCase(page, "LS-R 1");
  await expect(
    part(page, "train-case").locator('svg[data-part="case-diagram"]'),
  ).toHaveCount(2);
  await expect(
    part(page, "train-case").locator('svg[data-shape="slot"]'),
  ).toBeVisible();
  await expect(
    part(page, "train-alg").first().locator('[data-part="train-moves"]'),
  ).toHaveText(/^[RUF'2\s]+$/);
  // LS-R 14 looks like LS-R 1; LS-R 2 like neither.
  await addCase(page, "LS-R 2");
  await addCase(page, "LS-R 14");
  await reviewInOrder(page, ["LS-R 1", "LS-R 14", "LS-R 2"]);
  // Drilled by picture, then by a scramble that leads to the case.
  await action(page, "train-mode").filter({ hasText: "Drill" }).click();
  await expect(page).toHaveURL(/#\/train\/ls-right\/drill$/);
  await attempt(page);
  await expect(part(page, "train-label")).toHaveText(/^LS-R (1|2|14)$/);
  await page.keyboard.press("Space");
  await part(page, "train-show")
    .locator("button", { hasText: "Scramble" })
    .click();
  await expect(part(page, "train-scramble")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 20_000 },
  );
  await expect(part(page, "train-scramble")).toHaveText(/^[RUFLBD'2\s]+$/);
  await attempt(page);
  await page.keyboard.press("Space");
  await part(page, "train-show")
    .locator("button", { hasText: "Picture" })
    .click();
  // The other insert is a set of its own; the word remembers it.
  await action(page, "train-mode").filter({ hasText: "Learn" }).click();
  await action(page, "train-member").filter({ hasText: "F' U F" }).click();
  await expect(page).toHaveURL(/#\/train\/ls-front\/learn$/);
  await expect(part(page, "train-case-list").locator("li")).toHaveCount(26);
  await expect(
    action(page, "train-set").filter({ hasText: "LS" }),
  ).toHaveAttribute("aria-pressed", "true");
  await action(page, "train-set").filter({ hasText: "PLL" }).click();
  await action(page, "train-set").filter({ hasText: "LS" }).click();
  await expect(page).toHaveURL(/#\/train\/ls-front\/learn$/);
});

test("the 2×2's top in one go: CLL with the bottom solved, swapped side by side or across", async ({
  page,
}) => {
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await page.goto("/#/train/two-cll/learn");
  // The row stays three words; the bottom is a quiet choice under CLL.
  await expect(action(page, "train-set")).toHaveText(["OLL", "PBL", "CLL"]);
  await expect(
    action(page, "train-member").filter({ hasText: "Solved" }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const [word, route] of [
    ["Diag", "two-diag"],
    ["Adj", "two-adj"],
  ] as const) {
    await action(page, "train-member").filter({ hasText: word }).click();
    await expect(page).toHaveURL(new RegExp(`#/train/${route}/learn$`));
    await expect(part(page, "train-case-list").locator("li")).toHaveCount(43);
    await expect(
      action(page, "train-set").filter({ hasText: "CLL" }),
    ).toHaveAttribute("aria-pressed", "true");
  }
  // A case shows both layers' sides and how to tell it.
  await addCase(page, "Adj 1");
  await expect(
    part(page, "train-case").locator('svg[data-shape="two"]'),
  ).toBeVisible();
  await expect(part(page, "train-recognise")).not.toBeEmpty();
  // Adj 14 looks like Adj 1; Adj 2 does not come first among its look-alikes.
  await addCase(page, "Adj 2");
  await addCase(page, "Adj 14");
  await reviewInOrder(page, ["Adj 1", "Adj 14", "Adj 2"]);
  await action(page, "train-mode").filter({ hasText: "Drill" }).click();
  await attempt(page);
  await page.keyboard.press("Space");
  await part(page, "train-show")
    .locator("button", { hasText: "Scramble" })
    .click();
  await expect(part(page, "train-scramble")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(part(page, "train-scramble")).toHaveText(/^[RUFLBD'2\s]+$/);
  await attempt(page);
  await expect(part(page, "train-label")).toHaveText(/^Adj (1|2|14)$/);
  await page.keyboard.press("Space");
  await part(page, "train-show")
    .locator("button", { hasText: "Picture" })
    .click();
  // CLL opens the bottom last chosen.
  await action(page, "train-set").filter({ hasText: "OLL" }).click();
  await action(page, "train-set").filter({ hasText: "CLL" }).click();
  await expect(page).toHaveURL(/#\/train\/two-adj\/drill$/);
});

test("a split drill times recognition and execution in one run, and Learn shows their medians", async ({
  page,
}) => {
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await page.goto("/#/train/pll/learn");
  await addCase(page, "T");
  await action(page, "train-mode").filter({ hasText: "Drill" }).click();
  const drill = part(page, "train-drill");
  // Off by default; one quiet word turns it on, and it is remembered.
  await expect(action(page, "train-split")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await action(page, "train-split").click();
  await expect(action(page, "train-split")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // A picture: the clock runs from the moment the case shows, no hold.
  for (let i = 0; i < 3; i++) {
    await expect(drill).toHaveAttribute("data-phase", "recognising");
    await expect(part(page, "train-picture").locator("svg")).toBeVisible();
    await page.waitForTimeout(200);
    await page.keyboard.press("Space");
    await expect(drill).toHaveAttribute("data-phase", "running");
    await page.waitForTimeout(300);
    await page.keyboard.press("Space");
    await expect(drill).toHaveAttribute("data-phase", "stopped");
    await expect(part(page, "train-numbers")).toContainText("recognition");
    const time = Number(await part(page, "train-time").textContent());
    expect(time).toBeGreaterThanOrEqual(0.25);
    expect(time).toBeLessThan(2);
    await page.keyboard.press("Space");
  }
  await page.reload();
  await expect(action(page, "train-split")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // A scramble: hold and let go as usual, then a press for the recognition.
  await part(page, "train-show")
    .locator("button", { hasText: "Scramble" })
    .click();
  await expect(part(page, "train-scramble")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 20_000 },
  );
  await page.keyboard.down("Space");
  await page.waitForTimeout(400);
  await page.keyboard.up("Space");
  await expect(drill).toHaveAttribute("data-phase", "recognising");
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
  await expect(drill).toHaveAttribute("data-phase", "running");
  await page.waitForTimeout(200);
  await page.keyboard.press("Space");
  await expect(part(page, "train-numbers")).toContainText("recognition");

  // Learn: the case's own medians, recognition and execution.
  await action(page, "train-mode").filter({ hasText: "Learn" }).click();
  await part(page, "train-case-list")
    .locator('li button[aria-label="T"]')
    .click();
  const numbers = part(page, "train-case").locator("[data-case-numbers]");
  await expect(numbers).toContainText("recognition");
  await expect(numbers).toContainText("execution");

  // ? lists the trainer's keys; Esc closes the list, not the trainer.
  await page.keyboard.press("Shift+Slash");
  const keys = page.locator('[data-part="keys-help"]');
  await expect(keys).toContainText("Split: the case is recognised");
  await page.keyboard.press("Escape");
  await expect(keys).toHaveCount(0);
  await expect(page).toHaveURL(/#\/train\/pll\/learn$/);
});

test("the drill's clock runs as the timer's does, in whole seconds", async ({
  page,
}) => {
  await page.goto("/#/train/pll/learn");
  await expect(part(page, "train-case-list").locator("li")).toHaveCount(21);
  await addCase(page, "T");
  await action(page, "train-mode").filter({ hasText: "Drill" }).click();
  const drill = part(page, "train-drill");
  const time = part(page, "train-time");
  await expect(drill).toHaveAttribute("data-phase", "shown");
  await page.keyboard.down("Space");
  await page.waitForTimeout(400);
  await page.keyboard.up("Space");
  await expect(drill).toHaveAttribute("data-phase", "running");
  // Never a frozen zero: the figures count up while the clock runs.
  await expect(time).toHaveText("0");
  await expect(time).toHaveText("1", { timeout: 3_000 });
  await page.keyboard.press("Space");
  await expect(drill).toHaveAttribute("data-phase", "stopped");
  expect(Number(await time.textContent())).toBeGreaterThanOrEqual(1);
});

test("opening Algorithms from the keyboard lights nothing else in the status line", async ({
  page,
}) => {
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    const frame = () => {
      const label = document.querySelector('[data-part="status-line"] > label');
      if (label) seen.push(getComputedStyle(label).opacity);
      requestAnimationFrame(frame);
    };
    frame();
  });
  await page.locator('[data-action="train"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("h1")).toHaveText("Algorithms");
  const seen = await page.evaluate(
    () => (window as unknown as { seen: string[] }).seen,
  );
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((opacity) => opacity === "0")).toBe(true);
});

test("wide Learn tabs between the picked tile and its case controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/train/pll/learn");
  const tile = part(page, "train-case-list").getByRole("button", {
    name: "Ga",
    exact: true,
  });
  await tile.focus();
  await page.keyboard.press("Enter");
  const more = action(page, "train-more");
  await expect(more).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(more).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(tile).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(action(page, "train-use").first()).toBeFocused();
  const picks = part(page, "train-case-list").getByRole("checkbox", {
    name: "Ga",
    exact: true,
  });
  await action(page, "train-use").last().focus();
  await page.keyboard.press("Tab");
  await expect(picks).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(action(page, "train-use").last()).toBeFocused();
});

test("OLLCP: the OLL tiles open a group, its cases open and go into a drill", async ({
  page,
}) => {
  await page.goto("/#/train/oll/learn");
  await action(page, "train-member").filter({ hasText: "OLLCP" }).click();
  await expect(page).toHaveURL(/#\/train\/ollcp\/learn$/);
  // The first list: the 57 OLL cases and the one with nothing to orient.
  const tiles = part(page, "train-case-list").locator("li");
  await expect(tiles).toHaveCount(58);
  await expect(tiles.last().locator("label")).toHaveText("Skip");

  // A group opens in the list's place; opened from the keyboard, it takes the keyboard.
  const group = tiles.locator('button[aria-label="OLL 27"]');
  await group.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/train\/ollcp\/learn\/27$/);
  await expect(part(page, "train-group-name")).toHaveText("OLL 27");
  await expect(part(page, "train-group-name")).toBeFocused();
  await expect(tiles).toHaveCount(6);
  await expect(tiles.nth(1).locator("label")).toHaveText("2");

  // A case: its full name, its algorithm once the group has loaded, no recognition line.
  const tile = tiles.locator('button[aria-label="OLL 27-2"]');
  await tile.click();
  await expect(part(page, "train-case").locator("h2")).toHaveText("OLL 27-2");
  await expect(part(page, "train-alg").first()).toBeVisible();
  await expect(part(page, "train-recognise")).toHaveCount(0);
  await tiles.nth(1).locator('[data-action="train-pick"]').check();

  // Escape: back to the case's tile, then to the group's tile in the first list.
  await page.keyboard.press("Escape");
  await expect(part(page, "train-case")).toHaveCount(0);
  await expect(tile).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#\/train\/ollcp\/learn$/);
  await expect(tiles).toHaveCount(58);
  await expect(group).toBeFocused();

  // From the first list a drill holds the cases put in the drills, here the one.
  await action(page, "train-mode").filter({ hasText: "Drill" }).click();
  await expect(page).toHaveURL(/#\/train\/ollcp\/drill$/);
  await expect(part(page, "train-picture").locator("svg")).toBeVisible();
  await attempt(page);
  await expect(part(page, "train-label")).toHaveText("OLL 27-2");
  await expect(part(page, "train-answer")).toContainText("R");
});

// The first five draws recorded with the original eager loader and the same seeds.
const ollcpDraws = {
  drill: {
    file: "oll-43-45",
    labels: ["OLL 43-4", "OLL 25-2", "OLL 40-2", "OLL 2-3", "OLL 23-4"],
  },
  review: {
    file: "oll-07-09",
    labels: ["OLL 7-2", "OLL 28-3", "OLL 42-5", "OLL 41-2", "OLL 49-1"],
  },
};

for (const mode of ["drill", "review"] as const) {
  test(`whole OLLCP ${mode} keeps the seeded order with other files delayed`, async ({
    browser,
    baseURL,
  }) => {
    const { file, labels } = ollcpDraws[mode];
    const context = await browser.newContext({
      ...(baseURL ? { baseURL } : {}),
      serviceWorkers: "block",
      timezoneId: "UTC",
    });
    const page = await context.newPage();
    let releaseFiles = () => {};
    const otherFiles = new Promise<void>((resolve) => {
      releaseFiles = resolve;
    });
    const files = new Set<string>();
    try {
      await page.clock.setFixedTime(new Date("2026-11-24T12:00:00Z"));
      await page.addInitScript(() => {
        let seed = 12345;
        const original = crypto.getRandomValues.bind(crypto);
        crypto.getRandomValues = (array) => {
          if (array instanceof Uint32Array && array.length === 1) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            array[0] = seed;
            return array;
          }
          return original(array);
        };
      });
      if (mode === "review") {
        // Choose All while Review is empty, then make every card due.
        await page.goto("/#/train/ollcp/review");
        const whole = page.locator(
          '[data-action="train-pool"][data-pool="all"]',
        );
        await whole.click();
        await expect(whole).toHaveAttribute("aria-pressed", "true");
        await page
          .locator('[data-action="train-mode"][data-mode="learn"]')
          .click();
        await action(page, "train-all").click();
        await page
          .locator('[data-action="train-mode"][data-mode="review"]')
          .click();
        await expect(part(page, "train-picture")).toBeVisible();
      }
      await page.route(/\/oll-(?:\d\d-\d\d|skip)-[^/]+\.js$/, async (route) => {
        const path = new URL(route.request().url()).pathname;
        files.add(path);
        if (!path.includes(`/${file}-`)) await otherFiles;
        await route.continue();
      });
      if (mode === "drill") {
        await page.goto("/#/train/ollcp/drill");
        await action(page, "train-drill-all").click();
      } else {
        await page.reload();
      }
      await expect(part(page, "train-picture")).toBeVisible();
      await expect.poll(() => files.size).toBe(20);
      for (const [i, label] of labels.entries()) {
        if (i > 0) await action(page, "train-next").click();
        await attempt(page);
        await expect(part(page, "train-label")).toHaveText(label);
        await expect(part(page, "train-answer")).toContainText(/\s[A-Z]/);
        if (i === 0) releaseFiles();
      }
    } finally {
      releaseFiles();
      await context.close();
    }
  });
}
