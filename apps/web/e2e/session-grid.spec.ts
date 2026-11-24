import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openSwitch, sessionButton } from "./helpers";

// The session grid as someone new meets it (DESIGN.md section 10, the grid): pictures in
// the colours they hold, a held tile that stays under the hand, a folder that forms
// under it, the open session's name as its field, and a phone's grid that keeps still.

const part = (page: Page, name: string) =>
  page.locator(`[data-part="${name}"]`);
const tiles = (page: Page) =>
  part(page, "switch-grid").locator(':scope > li[data-tile="session"]');
const sheetScroll = (page: Page) =>
  part(page, "switch").evaluate((sheet) => sheet.scrollTop);

async function seeded(page: Page, state: string) {
  await page.goto(`/?state=${state}&lang=en&theme=dark`);
  await expect(tiles(page).first()).toBeVisible();
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations().map((a) => a.finished.catch(() => {})),
    ),
  );
}

/** The top face's colour of a tile's picture: the face letter it is painted as. */
const topColour = (page: Page) =>
  part(page, "switch-grid")
    .locator('li[data-tile="session"][data-current] [data-glyph]')
    .and(page.locator(':not([data-glyph="core"])'))
    .first()
    .getAttribute("data-glyph");

test("the pictures take the colours held: yellow on top by default, white once chosen", async ({
  page,
}) => {
  await page.goto("/");
  await openSwitch(page);
  // Yellow on top and green in front, as most people hold the cube: the right is orange.
  await expect.poll(() => topColour(page)).toBe("D");
  const fill = await part(page, "switch-grid")
    .locator('li[data-current] [data-glyph="D"]')
    .first()
    .evaluate((path) => getComputedStyle(path).fill);
  expect(fill).toBe("rgb(255, 224, 0)");
  await page.keyboard.press("Escape");

  await page.evaluate(() => {
    location.hash = "#/settings/look";
  });
  await page.locator('[data-setting="holdingTop"] select').selectOption("U");
  await page.evaluate(() => {
    location.hash = "";
  });
  await openSwitch(page);
  await expect.poll(() => topColour(page)).toBe("U");
});

test.describe("dragging with a mouse", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the held tile stays under the pointer anywhere on the screen; a folder's square forms over a picture; Esc puts it back", async ({
    page,
  }) => {
    await seeded(page, "switch-many");
    const names = await tiles(page)
      .locator('[data-part="switch-label"]')
      .allTextContents();
    const picture = tiles(page).nth(0).locator('[data-part="tile-picture"]');
    const from = await picture.boundingBox();
    if (!from) throw new Error("No tile");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    // Far from where it was taken, the picture is still where the pointer holds it.
    for (const [x, y] of [
      [700, 400],
      [1300, 600],
      [120, 500],
    ] as const) {
      await page.mouse.move(x, y, { steps: 4 });
      const held = await part(page, "switch-ghost")
        .locator('[data-part="tile-picture"]')
        .boundingBox();
      if (!held) throw new Error("Nothing held");
      expect(Math.abs(held.x + held.width / 2 - x)).toBeLessThan(6);
      expect(Math.abs(held.y + held.height / 2 - y)).toBeLessThan(8);
    }
    // The trash is a band across the whole foot.
    const band = await part(page, "switch-drop-trash").boundingBox();
    expect(band?.width).toBe(1440);

    // Over another session's picture: it reacts, and a folder's square forms behind it.
    const id = await tiles(page).nth(6).getAttribute("data-id");
    const target = part(page, "switch-grid").locator(`li[data-id="${id}"]`);
    // The tiles make room as the pointer passes them: aim again once they have settled.
    for (let aim = 0; aim < 3; aim++) {
      await page.evaluate(() =>
        Promise.all(
          document.getAnimations().map((a) => a.finished.catch(() => {})),
        ),
      );
      const over = await target
        .locator('[data-part="tile-picture"]')
        .boundingBox();
      if (!over) throw new Error("No target");
      await page.mouse.move(over.x + over.width / 2, over.y + over.height / 3, {
        steps: 3,
      });
    }
    await expect(target).toHaveAttribute("data-drop", "on");
    await expect(part(page, "switch")).toHaveAttribute("data-onto", "true");
    await expect
      .poll(() =>
        target
          .locator('[data-part="tile-picture"]')
          .evaluate((element) => getComputedStyle(element, "::before").opacity),
      )
      .toBe("1");

    // Esc lets go of it where it came from; nothing changed.
    await page.keyboard.press("Escape");
    await expect(part(page, "switch-ghost")).toHaveCount(0);
    await page.mouse.up();
    await expect(part(page, "switch")).toBeVisible();
    await expect(tiles(page).locator('[data-part="switch-label"]')).toHaveText(
      names,
    );
  });

  test("held just above the trash, the grid scrolls on its own while the hand stays still", async ({
    page,
  }) => {
    await seeded(page, "switch-many");
    const from = await tiles(page)
      .nth(0)
      .locator('[data-part="tile-picture"]')
      .boundingBox();
    if (!from) throw new Error("No tile");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(720, 790, { steps: 6 });
    const start = await sheetScroll(page);
    await expect.poll(() => sheetScroll(page)).toBeGreaterThan(start + 100);
    // Over the trash itself it stops: that is where a drop deletes.
    await page.mouse.move(720, 870, { steps: 2 });
    await expect(part(page, "switch-drop-trash")).toHaveAttribute("data-over");
    const there = await sheetScroll(page);
    await page.waitForTimeout(300);
    expect(await sheetScroll(page)).toBe(there);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(part(page, "switch-undo")).toHaveCount(0);
  });

  test("a click on the open session's name renames it; its picture goes back to the timer", async ({
    page,
  }) => {
    await page.goto("/");
    await openSwitch(page);
    const current = part(page, "switch-grid").locator(
      'li[data-tile="session"][data-current]',
    );
    await current.locator('[data-part="switch-label"]').click();
    const field = part(page, "switch-rename");
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("3×3");
    await field.fill("Main");
    await field.press("Enter");
    await expect(current.locator('[data-part="switch-label"]')).toHaveText(
      "Main",
    );
    await current.locator('[data-part="tile-picture"]').click();
    await expect(part(page, "switch")).toHaveCount(0);
    await expect(sessionButton(page)).toHaveText("Main");
  });

  test("Backspace and Undo give the selection back to the tile that came back", async ({
    page,
  }) => {
    await seeded(page, "switch-many");
    const fourth = tiles(page).nth(3);
    const name = await fourth
      .locator('[data-part="switch-label"]')
      .textContent();
    await fourth.locator('[data-action="switch-pick"]').focus();
    await page.keyboard.press("Backspace");
    await expect(part(page, "switch-undo")).toContainText(
      "In the trash for 30 days.",
    );
    await page.locator('[data-action="switch-undo"]').click();
    await expect(
      part(page, "switch-grid").locator("li[data-selected]"),
    ).toContainText(name ?? "");
  });
});

for (const viewport of [{ width: 390, height: 844 }]) {
  test.describe(`a touch screen ${viewport.width}×${viewport.height}`, () => {
    test.use({ hasTouch: true, isMobile: true, viewport });

    test("a long press lifts a tile without the grid moving under the finger, and selects no text", async ({
      page,
    }) => {
      await seeded(page, "switch-few");
      const pick = tiles(page).nth(1).locator('[data-action="switch-pick"]');
      const before = await pick.boundingBox();
      if (!before) throw new Error("No tile");
      const after = await pick.evaluate(async (element, box) => {
        const x = box.x + box.width / 2;
        const y = box.y + 30;
        const send = (type: string) =>
          element.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 9,
              pointerType: "touch",
              isPrimary: true,
              button: 0,
              clientX: x,
              clientY: y,
              bubbles: true,
              cancelable: true,
            }),
          );
        send("pointerdown");
        await new Promise((done) => setTimeout(done, 600));
        await new Promise((done) => requestAnimationFrame(done));
        // Lifted: a moving finger drags the tile, the sheet does not scroll under it.
        const move = new TouchEvent("touchmove", {
          bubbles: true,
          cancelable: true,
        });
        element.dispatchEvent(move);
        const top = element.getBoundingClientRect().top;
        const lifted = !!document.querySelector('[data-part="switch-ghost"]');
        const text = getSelection()?.toString() ?? "";
        element.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        send("pointerup");
        return { top, lifted, prevented: move.defaultPrevented, text };
      }, before);
      expect(after.lifted).toBe(true);
      expect(after.prevented).toBe(true);
      expect(after.text).toBe("");
      expect(Math.abs(after.top - before.y)).toBeLessThan(1);
      const style = await pick.evaluate((element) => {
        const css = getComputedStyle(element);
        return css.userSelect || css.webkitUserSelect;
      });
      expect(style).toBe("none");
    });
  });
}
