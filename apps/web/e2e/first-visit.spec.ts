import { expect, test } from "./fixtures";
import { createSession, inspectionOff, keyboardSolve } from "./helpers";

test("a first visit says only how to start, and never again after the first solve", async ({
  page,
}) => {
  await page.goto("/");
  const hint = page.locator('[data-part="solves-empty"]');
  await expect(hint).toBeVisible();
  await expect(hint.locator("a")).toHaveCount(0);
  await inspectionOff(page);
  await keyboardSolve(page);
  await expect(hint).toHaveCount(0);
  // A new, empty session does not bring it back.
  await createSession(page, "Second", "333");
  await expect(hint).toHaveCount(0);
});
