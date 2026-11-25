import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { keyboardSolve } from "./helpers";

// Task 12: ↑ ↓ and a tap on a row show a past solve in the middle; every edit goes to it.

const moveButton = (page: Page) =>
  page.locator('[data-part="last-actions"] [data-action="solve-move"]');
const part = (page: Page, name: string) =>
  page.locator(`[data-part="${name}"]`);
const solves = (page: Page) => part(page, "solves").locator("[data-solve-id]");
const shownRow = (page: Page) => part(page, "solves").locator("li[data-shown]");

/** A session of `count` synthetic solves, one every two minutes from 1 January 2025. */
async function openHistory(page: Page, count: number) {
  await page.goto(`/?seed=${count}`);
  await expect(part(page, "solve-no").first()).toHaveText(String(count), {
    timeout: 30_000,
  });
  await expect(part(page, "scramble")).toHaveAttribute("data-ready", "true");
  await page.locator("main").focus();
}

async function press(page: Page, key: string, times: number) {
  for (let i = 0; i < times; i++) await page.keyboard.press(key);
}

/** The line under a past solve: its number, then a date that names 2025 (not this year). */
const meta = (no: number) => new RegExp(`^No\\. ${no} · .*\\b202[45]\\b`);

async function addTypedSolve(page: Page, time: string) {
  await expect(part(page, "scramble")).toHaveAttribute("data-ready", "true");
  const input = part(page, "entry-input");
  await input.fill(time);
  await input.press("Enter");
  await expect(part(page, "solve-time").first()).toHaveText(time);
}

test("↑ walks past the newest page; C, 2, D and Backspace edit the solve on show", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // 205 solves: the newest 200 are in memory, the rest come from the database.
  await openHistory(page, 205);
  const time = part(page, "time");
  // The file draws only the rows near its scroll: the newest is found by its ID, the
  // count by the size every row reports.
  const newestId = await solves(page).first().getAttribute("data-solve-id");
  const newest = part(page, "solves").locator(`[data-solve-id="${newestId}"]`);
  const newestTime = await newest
    .locator('[data-part="solve-time"]')
    .textContent();
  const count = solves(page).first();

  await press(page, "ArrowUp", 202);
  await expect(part(page, "time-meta")).toHaveText(meta(3), {
    timeout: 30_000,
  });
  await expect(time).toHaveAttribute("data-browsing", "true");
  // The file follows: the row on show is drawn and marked, its time the one in the middle.
  await expect(shownRow(page).locator('[data-part="solve-no"]')).toHaveText(
    "3",
  );
  await expect(shownRow(page)).toBeInViewport();
  const pastTime = await shownRow(page)
    .locator('[data-part="solve-time"]')
    .textContent();
  await expect(time).toHaveText(pastTime ?? "");

  // C opens the comment in place; Enter keeps it.
  await page.keyboard.press("KeyC");
  const field = part(page, "time-comment-input");
  await expect(field).toBeFocused();
  await field.pressSequentially("Lost the cross");
  await field.press("Enter");
  await expect(field).toHaveCount(0);
  await expect(part(page, "time-comment")).toHaveText("// Lost the cross");
  await expect(
    shownRow(page).locator('[data-part="solve-comment"]'),
  ).toHaveText("// Lost the cross");

  // 2 and D twice each: on and off again, on the past solve only.
  await page.keyboard.press("Digit2");
  await expect(time).toHaveAttribute("data-penalty", "plus2");
  await expect(part(page, "time-note")).toHaveText(/ \+ 2$/);
  await expect(shownRow(page)).toHaveAttribute("data-penalty", "plus2");
  await page.keyboard.press("Digit2");
  await expect(time).toHaveAttribute("data-penalty", "ok");
  await expect(shownRow(page)).toHaveAttribute("data-penalty", "ok");
  await page.keyboard.press("KeyD");
  await expect(time).toHaveText("DNF");
  await expect(part(page, "time-note")).toHaveText(`(${pastTime})`);
  await expect(shownRow(page)).toHaveAttribute("data-penalty", "dnf");
  await page.keyboard.press("KeyD");
  await expect(time).toHaveText(pastTime ?? "");
  await expect(count).toHaveAttribute("aria-setsize", "205");

  // Backspace takes the past solve away and shows the one before; Mod+Z brings it back.
  await page.keyboard.press("Backspace");
  await expect(part(page, "time-meta")).toHaveText(meta(2));
  await expect(count).toHaveAttribute("aria-setsize", "204");
  await page.keyboard.press("ControlOrMeta+KeyZ");
  await expect(part(page, "time-meta")).toHaveText(meta(3));
  await expect(part(page, "time-comment")).toHaveText("// Lost the cross");
  await expect(count).toHaveAttribute("aria-setsize", "205");

  // Past the first solve there is nothing: the time says so and stays.
  await press(page, "ArrowUp", 2);
  await expect(part(page, "time-meta")).toHaveText(meta(1));
  await page.keyboard.press("ArrowUp");
  await expect(time).toHaveAttribute("data-feedback", "unavailable");
  await expect(part(page, "time-status")).toHaveText("No earlier solve");
  await expect(part(page, "time-meta")).toHaveText(meta(1));

  await page.keyboard.press("ArrowDown");
  await expect(part(page, "time-meta")).toHaveText(meta(2));
  await expect(shownRow(page)).toBeInViewport();
  // A scroll by hand stays where the hand left it, though pages load around it.
  const file = part(page, "solves");
  const scrolled = () => file.evaluate((list) => list.scrollTop);
  const before = await scrolled();
  await file.hover();
  await page.mouse.wheel(0, 1500);
  await expect.poll(scrolled).toBeGreaterThan(before + 1000);
  // A smooth scroll may still be settling.
  await page.waitForTimeout(400);
  const after = await scrolled();
  await page.waitForTimeout(400);
  expect(await scrolled()).toBe(after);
  await expect(part(page, "time-meta")).toHaveText(meta(2));
  // Esc is back to now: the newest time, the file at its newest row.
  await page.keyboard.press("Escape");
  await expect(time).not.toHaveAttribute("data-browsing");
  await expect(part(page, "time-meta")).toHaveCount(0);
  await expect(time).toHaveText(newestTime ?? "");
  await expect(newest).toBeInViewport();
  await expect(newest).toHaveAttribute("data-penalty", "ok");
  await page.keyboard.press("ArrowDown");
  await expect(part(page, "time-status")).toHaveText(
    "This is the newest solve",
  );
});

test("a row in the file shows its solve; the newest row, Esc and a start go back to now", async ({
  page,
}) => {
  await page.goto("/");
  await part(page, "entry-mode").selectOption("typing");
  for (const value of ["12.34", "10.00", "11.50"])
    await addTypedSolve(page, value);
  await part(page, "entry-mode").selectOption("timer");
  const time = part(page, "time");
  const show = (no: string) =>
    solves(page)
      .filter({ has: page.locator(`[data-part="solve-no"]:text-is("${no}")`) })
      .locator('[data-action="solve-show"]');

  await show("1").click();
  await expect(time).toHaveText("12.34");
  await expect(time).toHaveAttribute("data-browsing", "true");
  await expect(show("1")).toHaveAttribute("aria-pressed", "true");
  // This year's solve has no year in its date.
  await expect(part(page, "time-meta")).toHaveText(/^No\. 1 · /);
  await expect(part(page, "time-meta")).not.toHaveText(
    new RegExp(`\\b${new Date().getFullYear()}\\b`),
  );

  await show("3").click();
  await expect(time).toHaveText("11.50");
  await expect(part(page, "time-meta")).toHaveCount(0);

  await show("2").click();
  await expect(time).toHaveText("10.00");
  await page.locator("main").focus();
  await page.keyboard.press("Escape");
  await expect(time).toHaveText("11.50");
  await expect(part(page, "time-meta")).toHaveCount(0);

  // Holding Space to start goes back to now first, with the scramble to be timed.
  const scramble = part(page, "scramble");
  const live = await scramble.textContent();
  await show("2").click();
  await expect(time).toHaveText("10.00");
  await expect(scramble).not.toHaveText(live ?? "");
  await page.locator("main").focus();
  await page.keyboard.down("Space");
  await expect(part(page, "time-meta")).toHaveCount(0);
  await expect(time).not.toHaveAttribute("data-browsing");
  await expect(scramble).toHaveText(live ?? "");
  await page.keyboard.up("Space");
  await page.keyboard.press("Escape");
  await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
  await expect(solves(page)).toHaveCount(3);
});

test("a session picked while a deep page of the file loads stays picked", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await part(page, "entry-mode").selectOption("typing");
  await addTypedSolve(page, "9.87");
  const switcher = page.locator('[data-action="session-switch"]');
  const first = await switcher.getAttribute("data-id");
  expect(first).toBeTruthy();

  // The history session opens second in the list; [ goes back to the first.
  await openHistory(page, 205);
  const history = await switcher.getAttribute("data-id");
  expect(history).not.toBe(first);

  for (const wait of [false, true]) {
    // Scroll to the oldest solves, which only the database has, and switch at once:
    // in the same task, or one frame later with the page read in flight.
    await page.evaluate(async (wait) => {
      const list = document.querySelector<HTMLElement>('[data-part="solves"]');
      if (!list) throw new Error("no file");
      list.scrollTop = -list.scrollHeight;
      list.dispatchEvent(new Event("scroll"));
      if (wait) await new Promise(requestAnimationFrame);
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "BracketLeft",
          key: "[",
          bubbles: true,
          cancelable: true,
        }),
      );
    }, wait);
    await expect(switcher).toHaveAttribute("data-id", first ?? "");
    await expect(solves(page)).toHaveCount(1);
    await expect(part(page, "solve-time")).toHaveText("9.87");
    // A late page of the other session changes nothing.
    await page.waitForTimeout(300);
    await expect(switcher).toHaveAttribute("data-id", first ?? "");
    await expect(part(page, "solve-time")).toHaveText("9.87");

    await page.locator("main").focus();
    await page.keyboard.press("BracketRight");
    await expect(switcher).toHaveAttribute("data-id", history ?? "");
    await expect(part(page, "solve-no").first()).toHaveText("205");
  }
});

test.describe("picking lines on a touch screen", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  test("a long press picks a line, a tap picks another, × drops them", async ({
    page,
  }) => {
    await page.goto("/");
    // The phone keeps the entry mode in Settings: three timed solves instead.
    for (let i = 0; i < 3; i++) await keyboardSolve(page);
    await expect(solves(page)).toHaveCount(3);
    const time = (no: string) =>
      solves(page)
        .filter({
          has: page.locator(`[data-part="solve-no"]:text-is("${no}")`),
        })
        .locator('[data-action="solve-show"]');
    const picked = part(page, "solves").locator("li[data-selected]");

    // Held 450 ms without moving: picked; the tap that ends the press shows nothing.
    const held = time("3");
    await held.scrollIntoViewIfNeeded();
    const box = await held.boundingBox();
    if (!box) throw new Error("no line");
    const at = { clientX: box.x + box.width / 2, clientY: box.y + 4 };
    await held.dispatchEvent("pointerdown", {
      pointerType: "touch",
      isPrimary: true,
      ...at,
    });
    await expect(picked).toHaveCount(1);
    await held.dispatchEvent("pointerup", { pointerType: "touch", ...at });
    await held.dispatchEvent("click");
    await expect(part(page, "time-meta")).toHaveCount(0);
    await expect(moveButton(page)).toHaveText("Move 1");
    await expect(picked.first()).toBeInViewport({ ratio: 1 });

    // While any are picked a tap picks another, or drops it again.
    await time("2").tap();
    await expect(picked).toHaveCount(2);
    await expect(moveButton(page)).toHaveText("Move 2");
    await expect(picked.nth(1)).toBeInViewport({ ratio: 1 });
    await time("2").tap();
    await expect(picked).toHaveCount(1);
    await time("2").tap();
    await expect(picked).toHaveCount(2);

    await page.setViewportSize({ width: 852, height: 393 });
    await expect(picked.first()).toBeInViewport({ ratio: 0.98 });
    await page.locator('[data-action="selection-clear"]').tap();
    await expect(picked).toHaveCount(0);
    await expect(part(page, "last-actions")).not.toHaveAttribute(
      "data-selecting",
    );
    // With nothing picked a tap shows the solve again.
    await time("2").tap();
    await expect(part(page, "time-meta")).toHaveText(/^No\. 2 · /);
  });
});

test("R times a past scramble again; its attempts stay with it and out of the averages", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openHistory(page, 12);
  const time = part(page, "time");
  const scramble = part(page, "scramble");
  const attempts = part(page, "attempts").locator("li");
  const ao5 = part(page, "stats-now").locator('[data-stat="ao5"]');
  const sessionAo5 = await ao5.textContent();

  await press(page, "ArrowUp", 3);
  await expect(part(page, "time-meta")).toHaveText(meta(9));
  const rootTime = await time.textContent();
  const rootScramble = await scramble.textContent();
  await page.keyboard.press("KeyR");
  await expect(part(page, "time-meta")).toHaveText(/^No\. 9 again/);
  await expect(time).not.toHaveAttribute("data-browsing");
  await expect(attempts).toHaveCount(1);
  await expect(scramble).toHaveText(rootScramble ?? "");

  // Two attempts by Space, inspection included; the scramble stays for the next one.
  await keyboardSolve(page);
  await expect(attempts).toHaveCount(2);
  await keyboardSolve(page);
  await expect(attempts).toHaveCount(3);
  await expect(scramble).toHaveText(rootScramble ?? "");
  await expect(
    attempts.first().locator('[data-part="attempt-result"]'),
  ).toHaveText(rootTime ?? "");
  await expect(attempts.nth(2)).toHaveAttribute("data-shown", "");
  await expect(ao5).toHaveText(sessionAo5 ?? "");
  await expect(
    solves(page).first().locator('[data-part="solve-no"]'),
  ).toHaveText("12");
  const root = part(page, "solves").locator("li[data-shown]");
  await expect(root.locator('[data-part="solve-no"]')).toHaveText("9");
  await expect(root.locator('[data-part="solve-repeats"]')).toHaveText("×3");

  // Kept over a reload, with the root's line counting them.
  await page.reload();
  await expect(part(page, "solve-no").first()).toHaveText("12", {
    timeout: 30_000,
  });
  await page.locator("main").focus();
  await expect(ao5).toHaveText(sessionAo5 ?? "");
  await press(page, "ArrowUp", 3);
  await expect(part(page, "time-meta")).toHaveText(meta(9));
  // The pointer's way in: the word after the date.
  await page.locator('[data-action="solve-repeat"]').click();
  await expect(attempts).toHaveCount(3);

  // ↑ picks the attempt before; Backspace deletes it, undo puts it back.
  await page.locator("main").focus();
  await page.keyboard.press("ArrowUp");
  await expect(attempts.nth(1)).toHaveAttribute("data-shown", "");
  const second = await attempts
    .nth(1)
    .locator('[data-part="attempt-result"]')
    .textContent();
  await page.keyboard.press("Backspace");
  await expect(attempts).toHaveCount(2);
  await expect(attempts.nth(0)).toHaveAttribute("data-shown", "");
  await page.keyboard.press("ControlOrMeta+KeyZ");
  await expect(attempts).toHaveCount(3);
  await expect(
    attempts.nth(1).locator('[data-part="attempt-result"]'),
  ).toHaveText(second ?? "");
  await expect(ao5).toHaveText(sessionAo5 ?? "");

  // Esc brings the waiting scramble back; the next solve is an ordinary one.
  await page.keyboard.press("Escape");
  await expect(attempts).toHaveCount(0);
  await expect(part(page, "time-meta")).toHaveCount(0);
  await expect(scramble).not.toHaveText(rootScramble ?? "");
  await keyboardSolve(page);
  await expect(
    solves(page).first().locator('[data-part="solve-no"]'),
  ).toHaveText("13");
});
