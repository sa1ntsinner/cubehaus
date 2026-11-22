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
  await action(page, "train-add").click();
  await expect(action(page, "train-remove")).toBeVisible();
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

test("review drills only the cases missed twice", async ({ page }) => {
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await page.goto("/#/train/pll/learn");
  for (const label of ["T", "Y", "Ua"]) await addCase(page, label);
  await page.goto("/#/train/pll/review");
  await expect(part(page, "train-empty")).toBeVisible();

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
  for (let i = 0; i < 3; i++) {
    await attempt(page);
    await expect(part(page, "train-label")).toHaveText("Y");
    await page.keyboard.press("Space");
  }
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

  // The choice is the set's and stays; nothing was added to the person's own cases.
  await page.reload();
  await expect(
    page.locator('[data-action="train-pool"][data-pool="all"]'),
  ).toHaveAttribute("aria-pressed", "true");
  await page.goto("/#/train/pll/drill");
  await expect(part(page, "train-empty")).toBeVisible();
  await page.goto("/#/train/oll/learn");
  await expect(
    part(page, "train-case-list").locator("button[data-learning]"),
  ).toHaveCount(0);

  // Back to the person's own: nothing to drill.
  await page.goto("/#/train/oll/drill");
  await page.locator('[data-action="train-pool"][data-pool="mine"]').click();
  await expect(part(page, "train-empty")).toBeVisible();
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
  await page.goto("/#/settings");
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
  await expect(action(page, "train-none")).toHaveAttribute(
    "aria-pressed",
    "true",
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
  await action(page, "train-none").click();
  await expect(picked).toHaveCount(0);
  // PLL has its 2-look too.
  await page.goto("/#/train/pll/learn");
  await action(page, "train-two-look").click();
  await expect(picked).toHaveCount(6);
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

test("the 41 F2L cases are learnt and drilled like the other sets", async ({
  page,
}) => {
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await page.goto("/#/train/f2l/learn");
  await expect(part(page, "train-case-list").locator("li")).toHaveCount(41);
  // A case: the slot drawn from above the front right corner, its algorithm in R, U, F.
  await addCase(page, "F2L 13");
  await expect(
    part(page, "train-case").locator('svg[data-shape="slot"]'),
  ).toBeVisible();
  await expect(
    part(page, "train-alg").first().locator('[data-part="train-moves"]'),
  ).toHaveText(/^[RUF'2\s]+$/);
  await action(page, "train-mode").filter({ hasText: "Drill" }).click();
  await expect(
    part(page, "train-picture").locator('svg[data-shape="slot"]'),
  ).toBeVisible();
  await attempt(page);
  await expect(part(page, "train-label")).toHaveText("F2L 13");
  // A scramble that leads to it.
  await page.keyboard.press("Space");
  await part(page, "train-show")
    .locator("button", { hasText: "Scramble" })
    .click();
  await expect(part(page, "train-scramble")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 20_000 },
  );
});
