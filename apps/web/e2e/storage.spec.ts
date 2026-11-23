import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { keyboardSolve, sessionButton } from "./helpers";

const dbState = (page: Page) => page.locator('[data-part="db-state"]');
const solves = (page: Page) =>
  page.locator('[data-part="solves"] [data-solve-id]');
// After a reload WebKit opens the origin's file system again behind the old page's lock;
// on a busy machine that alone has taken over 5 s. The line goes once the database is
// open, which is what these specs wait for.
async function expectPersistent(page: Page) {
  await expect(sessionButton(page)).toBeEnabled({ timeout: 15_000 });
  await expect(dbState(page)).toHaveCount(0, { timeout: 15_000 });
}
async function reloadWithoutHooks(page: Page) {
  await page.evaluate(() => history.replaceState(null, "", "/"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectPersistent(page);
}

test("a keyboard solve survives reload", async ({ page }) => {
  await page.goto("/");
  await expectPersistent(page);
  await keyboardSolve(page);
  await expect(solves(page)).toHaveCount(1);
  const id = await solves(page).getAttribute("data-solve-id");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectPersistent(page);
  await expect(solves(page)).toHaveCount(1);
  await expect(solves(page)).toHaveAttribute("data-solve-id", id as string);
});

test("a solve before the delayed first worker answer survives reload", async ({
  page,
}) => {
  await page.goto("/?dbDelay=1500", { waitUntil: "domcontentloaded" });
  await expect(dbState(page)).toHaveAttribute("data-kind", "opening");
  await keyboardSolve(page);
  await expect(dbState(page)).toHaveAttribute("data-kind", "opening");
  // Reload while still pending: this tests the synchronous journal, not just
  // the eventual normal database write after a slow open.
  await reloadWithoutHooks(page);
  await expect(solves(page)).toHaveCount(1);
});

test("a keyboard hold survives the first session opening", async ({ page }) => {
  await page.goto("/?dbDelay=2500", { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-part="scramble"]')).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(dbState(page)).toHaveAttribute("data-kind", "opening");
  const timer = page.locator("main");

  await page.keyboard.press("Space");
  await expect(timer).toHaveAttribute("data-phase", "inspecting");
  await page.keyboard.down("Space");
  await expect(timer).toHaveAttribute("data-phase", "ready");
  await expect(dbState(page)).toHaveAttribute("data-kind", "opening");

  await expectPersistent(page);
  await page.keyboard.up("Space");
  await expect(timer).toHaveAttribute("data-phase", "running");
  await page.waitForTimeout(100);
  await page.keyboard.press("Space");
  await expect(solves(page)).toHaveCount(1);
  const id = await solves(page).getAttribute("data-solve-id");
  await reloadWithoutHooks(page);
  await expect(solves(page)).toHaveAttribute("data-solve-id", id ?? "");
});

test("a dropped insert is recovered exactly once", async ({ page }) => {
  await page.goto("/?dbDrop=1");
  await expectPersistent(page);
  await keyboardSolve(page);
  await expect(solves(page)).toHaveCount(1);
  const id = await solves(page).getAttribute("data-solve-id");
  await reloadWithoutHooks(page);
  await expect(solves(page)).toHaveCount(1);
  await expect(solves(page)).toHaveAttribute("data-solve-id", id as string);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectPersistent(page);
  await expect(solves(page)).toHaveCount(1);
});

test("a busy tab saves its pending solve when the first tab closes", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expectPersistent(page);
  const second = await context.newPage();
  try {
    await second.goto("/");
    await expect(dbState(second)).toHaveAttribute("data-kind", "busy");
    await expect(dbState(second)).toBeVisible();
    await expect(sessionButton(second)).toBeDisabled();
    await keyboardSolve(second);
    await expect(solves(second)).toHaveCount(1);
    const id = await solves(second).getAttribute("data-solve-id");

    await page.close();
    await expectPersistent(second);
    await expect(solves(second)).toHaveCount(1);
    await expect(solves(second)).toHaveAttribute("data-solve-id", id as string);
    await expect
      .poll(() =>
        second.evaluate(
          () =>
            Object.keys(localStorage).filter((key) =>
              key.startsWith("cubehaus.pending"),
            ).length,
        ),
      )
      .toBe(0);

    await second.reload({ waitUntil: "domcontentloaded" });
    await expectPersistent(second);
    await expect(solves(second)).toHaveCount(1);
    await expect(solves(second)).toHaveAttribute("data-solve-id", id as string);
  } finally {
    await second.close();
  }
});

// The settings are in the database the first tab holds: the second says why its rows are
// off, in a line like the timer's, and they come on once that tab goes.
for (const { language, line } of [
  {
    language: "en",
    line: "Open in another tab. Settings can be changed there, or here once it closes.",
  },
  {
    language: "ru",
    line: "Открыто в другой вкладке. Настройки можно изменить там или здесь, когда она закроется.",
  },
]) {
  test(`a second tab says why its settings are off (${language})`, async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await expectPersistent(page);
    const second = await context.newPage();
    try {
      await second.addInitScript((language) => {
        Object.defineProperty(navigator, "language", { value: language });
      }, language);
      await second.goto("/#/settings/look");
      const busy = second.locator(
        '[data-part="settings"] [data-part="db-state"][data-kind="busy"]',
      );
      await expect(busy).toHaveText(line);
      await expect(second.locator("#setting-language")).toBeDisabled();
      await page.close();
      await expect(busy).toHaveCount(0, { timeout: 15_000 });
      await expect(second.locator("#setting-language")).toBeEnabled();
    } finally {
      await second.close();
    }
  });
}

test("a solve the browser refuses to store is offered for download", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expectPersistent(page);
  const second = await context.newPage();
  // The second tab cannot reach the database (the first owns it) and its storage
  // refuses the pending journal, as with a full quota.
  await second.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith("cubehaus.pending."))
        throw new DOMException("full", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  try {
    await second.goto("/");
    await expect(
      second.locator('[data-part="db-state"][data-kind="busy"]'),
    ).toBeVisible();
    await keyboardSolve(second);
    const alert = second.locator('[data-part="db-state"][data-kind="unsaved"]');
    await expect(alert).toBeVisible();
    const id = await solves(second).first().getAttribute("data-solve-id");
    const [download] = await Promise.all([
      second.waitForEvent("download"),
      alert.locator('[data-action="download-unsaved"]').click(),
    ]);
    const file = JSON.parse(
      await readFile((await download.path()) as string, "utf8"),
    ) as { format: string; solves: { id: string }[] };
    expect(file.format).toBe("cubehaus-pending");
    expect(file.solves.map((solve) => solve.id)).toEqual([id]);
  } finally {
    await second.close();
  }
});

test("without OPFS the timer and in-memory solve list work", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    // The method lives on the prototype in current engines.
    let object: object | null = navigator.storage;
    while (object) {
      if (Object.hasOwn(object, "getDirectory"))
        Reflect.deleteProperty(object, "getDirectory");
      object = Object.getPrototypeOf(object);
    }
  });
  await page.goto("/");
  await expect(dbState(page)).toHaveAttribute("data-kind", "memory");
  await keyboardSolve(page);
  await expect(solves(page)).toHaveCount(1);
  expect(errors).toEqual([]);
});
