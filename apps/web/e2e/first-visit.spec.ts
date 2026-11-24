import { expect, test } from "./fixtures";
import { inspectionOff, keyboardSolve } from "./helpers";

test("an empty session shows no words about starting, before or after a solve", async ({
  page,
}) => {
  await page.goto("/");
  const hint = page.locator('[data-part="solves-empty"]');
  await expect(page.locator('[data-part="time"]')).toBeVisible();
  await expect(hint).toHaveCount(0);
  await inspectionOff(page);
  await keyboardSolve(page);
  await expect(hint).toHaveCount(0);
});
