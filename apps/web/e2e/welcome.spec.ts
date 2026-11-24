import { expect, test } from "./fixtures";

test.describe("the first run on a touch phone", () => {
  test.use({
    welcome: true,
    hasTouch: true,
    isMobile: true,
    viewport: { width: 393, height: 852 },
  });

  test("shows the controls once; Start closes them for good", async ({
    page,
  }) => {
    await page.goto("/");
    test.skip(
      !(await page.evaluate(
        () => matchMedia("(hover: none) and (pointer: coarse)").matches,
      )),
      "this browser does not report a touch screen for an emulated phone",
    );
    const welcome = page.locator('dialog[data-part="welcome"]');
    await expect(welcome).toBeVisible();
    await expect(welcome.locator("li")).toHaveCount(8);
    await welcome.getByRole("button", { name: "Start" }).click();
    await expect(welcome).toHaveCount(0);
    await page.reload();
    await expect(page.locator('[data-part="time"]')).toBeVisible();
    await expect(welcome).toHaveCount(0);
  });
});

test.describe("a desktop with a keyboard", () => {
  test.use({ welcome: true });

  test("shows no welcome", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-part="time"]')).toBeVisible();
    await expect(page.locator('dialog[data-part="welcome"]')).toHaveCount(0);
  });
});
