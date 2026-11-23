import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const part = (page: Page, name: string) =>
  page.locator(`[data-part="${name}"]`);
const solves = (page: Page) => part(page, "solves").locator("[data-solve-id]");

async function addTypedSolve(page: Page, time: string) {
  await expect(part(page, "scramble")).toHaveAttribute("data-ready", "true");
  const input = part(page, "entry-input");
  await input.fill(time);
  await input.press("Enter");
  await expect(part(page, "solve-time").first()).toHaveText(time);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  const mode = part(page, "entry-mode");
  await mode.selectOption("typing");
  await addTypedSolve(page, "12.34");
  await addTypedSolve(page, "10.00");
  await mode.selectOption("timer");
  await expect(part(page, "entry")).toHaveCount(0);
  await page.locator("main").focus();
});

test("A6i, 9f4 and DESIGN §18: 2 toggles +2 and D sets DNF on the newest solve", async ({
  page,
}) => {
  const newest = solves(page).first();
  const older = solves(page).nth(1);

  await page.keyboard.press("Digit2");
  await expect(newest).toHaveAttribute("data-plus2", "1");
  await expect(newest).toHaveAttribute("data-penalty", "plus2");
  await page.keyboard.press("Digit2");
  await expect(newest).toHaveAttribute("data-plus2", "0");
  await expect(newest).toHaveAttribute("data-penalty", "ok");

  await page.keyboard.press("KeyD");
  await expect(newest).toHaveAttribute("data-penalty", "dnf");
  await expect(newest.locator('[data-part="solve-time"]')).toHaveText("DNF");
  await expect(older).toHaveAttribute("data-penalty", "ok");
});

test("DESIGN §18: Backspace deletes the newest solve and Mod+Z restores it", async ({
  page,
}) => {
  const rows = solves(page);
  const id = await rows.first().getAttribute("data-solve-id");
  expect(id).toBeTruthy();
  await page.keyboard.press("Backspace");
  await expect(rows).toHaveCount(1);
  await expect(part(page, "solve-time")).toHaveText("12.34");

  await page.keyboard.press("ControlOrMeta+KeyZ");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toHaveAttribute("data-solve-id", id ?? "");
  await expect(part(page, "solve-time").first()).toHaveText("10.00");
});

test("Task 7: Mod+K opens the palette and Enter runs the filtered action", async ({
  page,
}) => {
  await page.keyboard.press("ControlOrMeta+KeyK");
  const palette = part(page, "palette");
  await expect(palette).toBeVisible();

  const query = part(page, "palette-query");
  await query.pressSequentially("delete solve");
  const results = part(page, "palette-results").locator("li");
  await expect(results).toHaveCount(1);
  await expect(results.first()).toHaveAttribute(
    "data-action-id",
    "solve.delete",
  );
  await query.press("Enter");

  await expect(palette).toHaveCount(0);
  await expect(solves(page)).toHaveCount(1);
  await expect(part(page, "solve-time")).toHaveText("12.34");
});

test("Review Focus 5: typing 2 in the comment field changes no penalty", async ({
  page,
}) => {
  const newest = solves(page).first();
  await newest.locator('[data-action="comment-edit"]').click();
  const comment = part(page, "comment-input");
  await comment.press("Digit2");
  await expect(comment).toHaveValue("2");
  await newest.locator('[data-action="comment-save"]').click();

  await expect(part(page, "solve-comment")).toHaveText("// 2");
  await expect(newest).toHaveAttribute("data-penalty", "ok");
  await expect(newest).toHaveAttribute("data-plus2", "0");
});

test("DESIGN §18: ? lists the current idle bindings", async ({ page }) => {
  await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
  await page.keyboard.press("Shift+Slash");
  const help = part(page, "keys-help");
  await expect(help).toBeVisible();
  await expect(help.getByText("Turn inspection on or off")).toBeVisible();
  await expect(help.getByText("Enter times by hand")).toBeVisible();
  // Each key is written as it is printed on the keyboard; data-key keeps its code.
  for (const [action, key, label] of [
    ["solve.plus2", "Digit2", /^2$/],
    ["scramble.next", "ArrowRight", /^→$/],
    ["picture.toggle", "KeyP", /^P$/],
    ["palette", "Mod+KeyK", /^(⌘K|Ctrl\+K)$/],
  ] as const) {
    const kbd = help.locator(`[data-action-id="${action}"] kbd`);
    await expect(kbd).toHaveAttribute("data-key", key);
    await expect(kbd).toHaveText(label);
  }

  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
});

test("status-line Keys opens help and pointer dismissal restores focus", async ({
  page,
}) => {
  const keys = page.locator('[data-action="keys"]');
  const help = part(page, "keys-help");
  const close = help.locator(
    ':scope > [data-action="dialog-close"]:first-child',
  );
  await keys.click();
  await expect(close).toHaveText("Timer");
  await close.click();
  await expect(help).toHaveCount(0);
  await expect(keys).toBeFocused();

  await keys.click();
  await expect(help).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
  await expect(keys).toBeFocused();
});

test("the palette close button restores the same focus as Escape", async ({
  page,
}) => {
  const mode = part(page, "entry-mode");
  await mode.selectOption("typing");
  await page.setViewportSize({ width: 390, height: 844 });
  const input = part(page, "entry-input");
  await input.focus();
  const palette = part(page, "palette");
  const close = palette.locator(
    ':scope > [data-action="dialog-close"]:first-child',
  );
  await page.keyboard.press("ControlOrMeta+KeyK");
  await expect(close).toHaveText("Timer");
  await close.click();
  await expect(palette).toHaveCount(0);
  await expect(input).toBeFocused();

  await page.keyboard.press("ControlOrMeta+KeyK");
  await expect(part(page, "palette-query")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(input).toBeFocused();
});

test("the I key switches the session's inspection and says so", async ({
  page,
}) => {
  const main = page.locator("main");
  // Inspection is a setting: the main screen carries no word for it.
  await expect(page.locator('[data-action="inspection-toggle"]')).toHaveCount(
    0,
  );
  await expect(main).toHaveAttribute("data-inspection", "official");
  await page.keyboard.press("KeyI");
  await expect(main).toHaveAttribute("data-inspection", "off");
  await expect(part(page, "notice")).toHaveText("Inspection off");
  await page.keyboard.press("KeyI");
  await expect(main).toHaveAttribute("data-inspection", "official");
});

test("scramble history restores the text and picture, copies, and times the shown scramble", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press("KeyI");
  const scramble = part(page, "scramble");
  const main = page.locator("main");
  await expect(main).toHaveAttribute("data-inspection", "off");
  const stickerColours = () =>
    part(page, "scramble-picture")
      .locator("[data-sticker]")
      .evaluateAll((stickers) =>
        stickers.map((sticker) => sticker.getAttribute("data-sticker")),
      );
  await expect(scramble).toHaveAttribute("data-ready", "true");
  await expect
    .poll(async () => (await stickerColours()).length)
    .toBeGreaterThan(0);
  const first = (await scramble.textContent())?.trim() ?? "";
  const firstPicture = await stickerColours();

  await page.keyboard.press("ArrowRight");
  await expect(scramble).not.toHaveText(first);
  await expect(scramble).toHaveAttribute("data-ready", "true");
  const next = (await scramble.textContent())?.trim() ?? "";
  await expect
    .poll(async () => {
      const colours = await stickerColours();
      return colours.length > 0 && colours.join() !== firstPicture.join();
    })
    .toBe(true);
  const nextPicture = await stickerColours();

  await page.keyboard.press("ArrowLeft");
  await expect(scramble).toHaveText(first);
  await expect.poll(stickerColours).toEqual(firstPicture);

  const swipe = async (from: number, to: number) => {
    const touch = {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientY: 40,
    };
    // A finger moves on its way: the swipe follows it (input/swipe.ts) and acts on
    // letting go past its commit distance.
    await scramble.dispatchEvent("pointerdown", { ...touch, clientX: from });
    for (const step of [0.25, 0.5, 0.75, 1])
      await scramble.dispatchEvent("pointermove", {
        ...touch,
        clientX: from + (to - from) * step,
      });
    await scramble.dispatchEvent("pointerup", { ...touch, clientX: to });
  };
  await swipe(130, 40);
  await expect(scramble).toHaveText(next);
  await expect.poll(stickerColours).toEqual(nextPicture);
  await swipe(40, 130);
  await expect(scramble).toHaveText(first);
  // A pointer's controls: out of sight until the pointer is over the scramble, and drawn by
  // CSS, so the line's text stays the moves alone.
  const nextButton = page.getByRole("button", { name: "Next scramble" });
  await expect(nextButton).toHaveCSS("opacity", "0");
  await scramble.hover();
  await expect(nextButton).toHaveCSS("opacity", "1");
  await nextButton.click();
  await expect(scramble).toHaveText(next);
  await page.getByRole("button", { name: "Previous scramble" }).click();
  await expect(scramble).toHaveText(first);

  const copied = part(page, "notice");
  await scramble.evaluate((element) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          element.setAttribute("data-copied", text);
        },
      },
    });
    window.addEventListener("keydown", (key) => {
      if (key.code === "KeyC" && (key.metaKey || key.ctrlKey))
        element.setAttribute(
          "data-copy-prevented",
          String(key.defaultPrevented),
        );
    });
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.keyboard.press("ControlOrMeta+KeyC");
  await expect(scramble).toHaveAttribute("data-copy-prevented", "false");
  await expect(scramble).not.toHaveAttribute("data-copied", /.+/);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.keyboard.press("ControlOrMeta+KeyC");
  await expect(scramble).toHaveAttribute("data-copied", first);
  await expect(copied).toHaveText("Scramble copied");

  await main.focus();
  await page.keyboard.down("Space");
  await expect(main).toHaveAttribute("data-phase", "ready");
  await page.keyboard.up("Space");
  await expect(main).toHaveAttribute("data-phase", "running");
  await page.waitForTimeout(100);
  await page.keyboard.press("KeyA");
  await expect(solves(page)).toHaveCount(3);
  const id = await solves(page).first().getAttribute("data-solve-id");
  await page.goto("/#/settings/data");
  const [backup] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('[data-action="backup-save"]').click(),
  ]);
  const file = JSON.parse(await readFile(await backup.path(), "utf8")) as {
    tables: { solve: { id: string; scramble: string }[] };
  };
  expect(file.tables.solve.find((solve) => solve.id === id)?.scramble).toBe(
    first,
  );
});

test("rebinds actions, rejects a clash, and recovers an unbound palette", async ({
  page,
}) => {
  const keymap = part(page, "keymap");
  const row = (id: string) => keymap.locator(`[data-binding="${id}"]`);
  const keys = (id: string) => row(id).locator('[data-part="binding-keys"]');
  async function openKeymap() {
    await page.goto("/#/settings/keys");
  }
  async function capture(id: string, code: string, label?: string) {
    await row(id).locator('[data-action="binding-change"]').click();
    await page.keyboard.press(code);
    if (label) await expect(keys(id)).toHaveText(label);
  }
  await openKeymap();
  await capture("solve.dnf", "KeyJ", "J");
  await capture("solve.plus2", "KeyJ");
  await expect(part(page, "keymap-notice")).toContainText("J is used by");
  await expect(keys("solve.plus2")).toHaveText("2");
  await capture("picture.zoom", "KeyY", "Y");
  await capture("timer.start", "KeyG", "G");
  await capture("timer.handLeft", "ShiftLeft", "Left Shift");
  await capture("timer.handRight", "ShiftRight", "Right Shift");
  await capture("progress.close", "KeyX", "X");
  await row("palette").locator('[data-action="binding-remove"]').click();
  await expect(keys("palette")).toHaveText("Unbound");

  await page.reload();
  await expect(keys("solve.dnf")).toHaveText("J");
  await expect(keys("timer.handLeft")).toHaveText("Left Shift");
  await expect(keys("timer.handRight")).toHaveText("Right Shift");
  await keymap.locator('[data-action="commands-open"]').click();
  const palette = part(page, "palette");
  await expect(palette).toBeVisible();
  await part(page, "palette-query").fill("DNF");
  await expect(palette.locator('[data-action-id="solve.dnf"] kbd')).toHaveText(
    "J",
  );
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+KeyK");
  await expect(palette).toHaveCount(0);

  const main = page.locator("main");
  const last = solves(page).first();
  await main.focus();
  await page.keyboard.press("KeyD");
  await expect(last).toHaveAttribute("data-penalty", "ok");
  await page.keyboard.press("KeyJ");
  await expect(last).toHaveAttribute("data-penalty", "dnf");
  await page.keyboard.press("KeyJ");

  const helpButton = page.locator('[data-action="keys"]');
  await helpButton.click();
  const help = part(page, "keys-help");
  await expect(help.locator('[data-action-id="solve.dnf"] kbd')).toHaveText(
    "J",
  );
  await expect(help.locator('[data-action-id="timer.start"] kbd')).toHaveText(
    "G",
  );
  await help.locator('[data-action="commands-open"]').click();
  await expect(palette).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(helpButton).toBeFocused();
  await main.focus();
  await expect(part(page, "scramble-picture")).toBeVisible();
  await page.keyboard.press("KeyF");
  await expect(part(page, "picture-zoom")).toHaveCount(0);
  await page.keyboard.press("KeyY");
  await expect(part(page, "picture-zoom")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(part(page, "picture-zoom")).toHaveCount(0);
  await page.keyboard.press("KeyT");
  await expect(part(page, "progress")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(part(page, "progress")).toBeVisible();
  await page.keyboard.press("KeyX");
  // Progress is a <main> too: wait for it to go, not for any <main>, or the next key
  // reaches Progress before the hash change brings the timer back.
  await expect(part(page, "progress")).toHaveCount(0);
  await expect(page.locator("[data-timer-surface]")).toBeVisible();

  await page.keyboard.press("KeyI");
  await expect(main).toHaveAttribute("data-inspection", "off");
  await expect(part(page, "scramble")).toHaveAttribute("data-ready", "true");
  await main.focus();
  await page.keyboard.press("Space");
  await expect(main).toHaveAttribute("data-phase", "idle");
  await page.keyboard.down("KeyG");
  await expect(main).toHaveAttribute("data-phase", "ready");
  await page.keyboard.up("KeyG");
  await expect(main).toHaveAttribute("data-phase", "running");
  await page.waitForTimeout(100);
  await page.keyboard.press("KeyA");
  await page.keyboard.press("KeyJ");
  await expect(solves(page)).toHaveCount(3);
  await expect(solves(page).first()).toHaveAttribute("data-penalty", "ok");

  await page.goto("/#/settings/timer");
  const start = page.locator("#setting-startMode");
  await start.selectOption("two-hand");
  await expect(start).toHaveValue("two-hand");
  await page.locator('[data-action="settings-close"]').click();
  await expect(part(page, "hand-keys")).toHaveText("Left ShiftRight Shift");
  await expect(part(page, "scramble")).toHaveAttribute("data-ready", "true");
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("ShiftRight");
  await expect(main).toHaveAttribute("data-phase", "ready");
  await page.keyboard.up("ShiftRight");
  await expect(main).toHaveAttribute("data-phase", "ready");
  await page.keyboard.up("ShiftLeft");
  await expect(main).toHaveAttribute("data-phase", "running");
  await page.waitForTimeout(100);
  await page.keyboard.press("KeyA");
  await expect(solves(page)).toHaveCount(4);

  await openKeymap();
  await keymap.locator('[data-action="keyboard-reset"]').click();
  await expect(keys("solve.dnf")).toHaveText("D");
  await expect(keys("timer.start")).toHaveText("Space");
  await expect(keys("palette")).not.toHaveText("Unbound");
});

test("copies an older average with both dropped attempts and a clipboard fallback", async ({
  page,
}) => {
  const slot = page.locator('[data-part="stats-now"] [data-slot="ao5"]');
  const picker = part(page, "stat-picker");
  const inspect = picker.locator('[data-action="average-inspect"]');
  const detail = part(page, "average-detail");
  const copy = detail.locator('[data-action="average-copy"]');
  const expected = [
    "ao5 12.00",
    "1. (10.00)  R",
    "2. 11.00  U",
    "3. 12.00  F",
    "4. 13.00+  L",
    "5. (DNF (15.00))  D",
  ].join("\n");

  await slot.click();
  await expect(inspect).toBeDisabled();
  await page.keyboard.press("Escape");

  await page.goto("/?state=average-window");
  await expect(part(page, "solve-no").first()).toHaveText("6");
  await page.keyboard.press("ArrowUp");
  await expect(part(page, "time-meta")).toHaveText(/^No\. 5 ·/);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.documentElement.setAttribute("data-copied-average", text);
        },
      },
    });
  });

  await slot.click();
  await inspect.click();
  await expect(detail.locator("h1")).toHaveText("ao5 12.00");
  await expect(detail.locator("li")).toHaveCount(5);
  await expect(detail.locator("li[data-dropped]")).toHaveCount(2);
  await copy.click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-copied-average",
    expected,
  );
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  await expect(slot).toBeFocused();

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          Promise.reject(new DOMException("Denied", "NotAllowedError")),
      },
    });
  });
  await page.keyboard.press("KeyA");
  await expect(copy).toBeVisible();
  await page.keyboard.press("ControlOrMeta+KeyC");
  const fallback = part(page, "average-copy-text");
  await expect(fallback).toHaveValue(expected);
  await expect(fallback).toBeFocused();
  expect(
    await fallback.evaluate(
      (element: HTMLTextAreaElement) =>
        element.selectionStart === 0 &&
        element.selectionEnd === element.value.length,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");

  await page.locator('[data-stat="ao5-best"] button').click();
  await expect(detail.locator("h1")).toHaveText("ao5 12.00");
  await expect(detail.locator("li").last()).toHaveAttribute(
    "data-solve-id",
    "average-5",
  );
});

test("Shift+F puts the page in full screen and takes it out, listed in Keys", async ({
  page,
}) => {
  await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
  await page.keyboard.press("Shift+Slash");
  await expect(
    part(page, "keys-help").locator('[data-action-id="view.fullscreen"] kbd'),
  ).toHaveAttribute("data-key", "Shift+KeyF");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+KeyF");
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement !== null))
    .toBe(true);
  await page.keyboard.press("Shift+KeyF");
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement !== null))
    .toBe(false);
});
