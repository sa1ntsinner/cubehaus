import { expect, test } from "./fixtures";
import { inspectionOff, keyboardSolve } from "./helpers";

// Android's Back closes the comment line and keeps what was written; it does not leave
// the app (input/back-field.ts).
test.describe("Android back", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("Back closes the comment line, keeps the comment and stays in the app", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "Android runs Chrome");
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
    await inspectionOff(page);
    await keyboardSolve(page);
    await page.waitForTimeout(800);
    const before = await page.evaluate(() => history.length);
    await page.locator('main > output[data-part="time"]').evaluate((time) => {
      const box = time.getBoundingClientRect();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      const fire = (type: string, dy: number) =>
        time.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 7,
            pointerType: "touch",
            isPrimary: true,
            button: type === "pointermove" ? -1 : 0,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: x,
            clientY: y + dy,
          }),
        );
      fire("pointerdown", 0);
      for (let step = 1; step <= 6; step++) fire("pointermove", -20 * step);
      fire("pointerup", -120);
    });
    const field = page.locator('[data-part="time-comment-input"]');
    await expect(field).toBeFocused();
    await field.fill("cross on D");
    expect(await page.evaluate(() => history.length)).toBe(before + 1);

    await page.evaluate(() => history.back());
    await expect(field).toHaveCount(0);
    await expect(page.locator("main")).toContainText("cross on D");
    expect(page.url()).not.toContain("#");
  });
});
