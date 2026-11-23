import { expect, test } from "./fixtures";
import { inspectionOff, keyboardSolve, sessionButton } from "./helpers";

test("a first visit says where old solves come in, once, and it leads to the import", async ({
  page,
}) => {
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  const line = page.locator('[data-part="solves-import"]');
  await expect(line).toContainText("Solves from another timer:");
  await line.locator("a").click();
  await expect(page.locator("h1")).toHaveText("Settings");
  await expect(page.locator('[data-action="import-file"] input')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sessionButton(page)).toBeEnabled();
  // Gone with the first solve, like the rest of the comment.
  await inspectionOff(page);
  await keyboardSolve(page);
  await expect(page.locator('[data-part="solves-empty"]')).toHaveCount(0);
  await expect(line).toHaveCount(0);
});
