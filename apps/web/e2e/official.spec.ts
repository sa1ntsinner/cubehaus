import { EVENTS, type EventId } from "@cubehaus/core";
import type { Page } from "@playwright/test";
import { officialShape } from "../../../packages/scramble/src/shapes";
import { expect, test } from "./fixtures";
import { openSwitch, sessionButton, switchSession } from "./helpers";

const part = (page: Page, name: string) =>
  page.locator(`[data-part="${name}"]`);
const inspection = (page: Page) =>
  page.locator('[data-part="time"][data-phase="inspecting"]');

async function openTimer(page: Page) {
  const time = new Date("2026-11-18T12:00:00Z");
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 60_000));
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await expect(part(page, "scramble")).toHaveAttribute("data-ready", "true");
}

async function space(page: Page, type: "keydown" | "keyup") {
  // The reducer uses the event timestamp. Native keyboard input's timestamp
  // is independent of Playwright's mocked performance clock.
  await page.evaluate((type) => {
    const event = new KeyboardEvent(type, {
      key: " ",
      code: "Space",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "timeStamp", { value: performance.now() });
    (document.activeElement ?? document.body).dispatchEvent(event);
  }, type);
}

async function startInspection(page: Page) {
  await space(page, "keydown");
  await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
  await space(page, "keyup");
  await expect(inspection(page)).toBeVisible();
}

test("A3b2 A3b3 A3b4: release starts inspection; 7.9 s is clean, 8.0 s warn, 12.0 s late", async ({
  page,
}) => {
  await openTimer(page);
  await startInspection(page);

  // fastForward delivers the pending frame at each boundary.
  await page.clock.fastForward(7900);
  await expect(inspection(page)).toHaveText("7");
  await expect(inspection(page)).toHaveAttribute("data-band", "clean");
  await page.clock.fastForward(100);
  await expect(inspection(page)).toHaveAttribute("data-band", "warn");
  await page.clock.fastForward(4000);
  await expect(inspection(page)).toHaveAttribute("data-band", "late");
});

test("A3a1, A4d1+, A4d2+: a start at 14.99 s is clean, at 15.00 s a +2, at 17.00 s a DNF", async ({
  page,
}) => {
  await openTimer(page);
  const solve = part(page, "solves").locator("[data-solve-id]").first();
  for (const { at, penalty, plus2 } of [
    { at: 14990, penalty: "ok", plus2: "0" },
    { at: 15000, penalty: "plus2", plus2: "1" },
    { at: 17000, penalty: "dnf", plus2: "0" },
  ]) {
    await startInspection(page);
    await page.clock.fastForward(at - 400);
    await space(page, "keydown");
    await expect(page.locator("main")).toHaveAttribute("data-phase", "holding");
    await page.clock.fastForward(400);
    await expect(page.locator("main")).toHaveAttribute("data-phase", "ready");
    await expect(inspection(page)).toHaveAttribute("data-penalty", penalty);
    await space(page, "keyup");
    await expect(page.locator("main")).toHaveAttribute("data-phase", "running");

    await page.clock.fastForward(100);
    await space(page, "keydown");
    await expect(page.locator("main")).toHaveAttribute("data-phase", "stopped");
    await space(page, "keyup");
    await expect(solve, `${at}`).toHaveAttribute("data-penalty", penalty);
    await expect(solve).toHaveAttribute("data-plus2", plus2);
    // Keys rest for 200 ms after a stop, so a bounce cannot act.
    await page.clock.fastForward(300);
    await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
  }
});

test("Review Focus 2: Escape and a window blur cancel inspection without a solve", async ({
  page,
}) => {
  await openTimer(page);
  const scramble = await part(page, "scramble").textContent();
  for (const reason of ["Escape", "window blur"] as const) {
    await startInspection(page);
    if (reason === "Escape") await page.keyboard.press("Escape");
    else await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(page.locator("main"), reason).toHaveAttribute(
      "data-phase",
      "idle",
    );
    await expect(inspection(page)).toHaveCount(0);
    await expect(part(page, "scramble")).toHaveText(scramble ?? "");
    await expect(part(page, "solve-time")).toHaveCount(0);
  }
});

test.describe("phone inspection", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 393, height: 852 },
  });

  test("Cancel requires an uninterrupted 600 ms hold", async ({ page }) => {
    await openTimer(page);
    await startInspection(page);
    const button = page.getByRole("button", { name: "Cancel", exact: true });
    await expect(button).toBeVisible();
    await button.tap();
    await expect(inspection(page)).toBeVisible();

    const pointer = { pointerId: 1, pointerType: "touch", button: 0 };
    await button.dispatchEvent("pointerdown", pointer);
    await page.clock.runFor(300);
    await button.dispatchEvent("pointercancel", pointer);
    await page.clock.runFor(600);
    await expect(inspection(page)).toBeVisible();

    await button.dispatchEvent("pointerdown", pointer);
    await page.clock.runFor(599);
    await expect(inspection(page)).toBeVisible();
    await page.clock.runFor(1);
    await expect(button).toHaveCount(0);
    await expect(part(page, "notice")).toHaveText("Inspection cancelled");
    await expect(part(page, "solve-time")).toHaveCount(0);
  });
});

test("9b, 4b3, 4b3a–f, 12c2, 12f (draft), E2 and H1: all 18 events show official notation or their entry form", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/");
  const scramble = part(page, "scramble");
  await expect(sessionButton(page)).toBeEnabled();

  // Each event opens from the switch's picker, as a new session named by its label.
  for (const { id, kind, label } of EVENTS) {
    if (id === "333") continue;
    await test.step(id, async () => {
      // + and the picker make the session in place, named; Enter keeps the name and
      // Enter again opens it.
      await openSwitch(page);
      await part(page, "switch-grid")
        .locator('li[data-tile="add"] [data-action="switch-pick"]')
        .click();
      await part(page, "switch-grid")
        .locator(`li[data-tile="event"][data-event="${id}"]`)
        .locator('[data-action="switch-pick"]')
        .click();
      await expect(part(page, "switch-rename")).toHaveValue(label);
      await part(page, "switch-rename").press("Enter");
      await page.keyboard.press("Enter");
      await expect(scramble).toHaveAttribute("data-event", id);
      await expect(sessionButton(page)).toHaveText(label);
      if (kind === "time") {
        // A puzzle's first scramble in a page builds its search first (4×4, Square-1:
        // a second or two, many on a busy machine); the app shows it is preparing one.
        await expect(scramble).toHaveAttribute("data-ready", "true", {
          timeout: 30_000,
        });
        await expect(scramble).toHaveText(officialShape[id]);
      } else {
        await expect(part(page, "entry")).toBeVisible();
        await expect(
          part(page, kind === "moves" ? "fm-clock" : "cubes-attempted"),
        ).toBeVisible();
      }
    });
  }

  await switchSession(page, "3×3");
  await expect(scramble).toHaveAttribute("data-event", "333");
  await expect(scramble).toHaveAttribute("data-ready", "true");
  await expect(scramble).toHaveText(officialShape["333"]);
});

// WCA Russian locale names, research A2. FTO uses the app's abbreviation.
const russianNames: Record<EventId, string> = {
  "333": "Кубик 3x3x3",
  "222": "Кубик 2x2x2",
  "444": "Кубик 4x4x4",
  "555": "Кубик 5x5x5",
  "666": "Кубик 6x6x6",
  "777": "Кубик 7x7x7",
  "333bf": "3x3x3 вслепую",
  "333fm": "Сборка 3x3x3 на количество ходов",
  "333oh": "3x3x3 одной рукой",
  clock: "Clock",
  minx: "Мегаминкс",
  pyram: "Пираминкс",
  skewb: "Скьюб",
  sq1: "Square-1",
  "444bf": "4x4x4 вслепую",
  "555bf": "5x5x5 вслепую",
  "333mbf": "Мульти-блайнд",
  fto: "FTO",
};

test("9b, WCA Russian locale (research A2): the event chooser shows Russian names", async ({
  page,
}) => {
  await page.goto("/#/settings/look");
  await page.locator("#setting-language").selectOption("ru");
  await expect(
    part(page, "settings").getByRole("heading", { level: 1 }),
  ).toHaveText("Настройки");
  await page.goto("/");
  await openSwitch(page);

  // The picker names every puzzle by its WCA name for a screen reader, beside the short
  // label on screen.
  await part(page, "switch-grid")
    .locator('li[data-tile="add"] [data-action="switch-pick"]')
    .click();
  const tiles = part(page, "switch-grid").locator('li[data-tile="event"]');
  await expect(tiles).toHaveCount(18);
  for (const [id, name] of Object.entries(russianNames))
    await expect(
      tiles
        .and(page.locator(`[data-event="${id}"]`))
        .locator('[data-action="switch-pick"]'),
    ).toHaveAttribute(
      "aria-label",
      new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  await page.keyboard.press("Escape");
  // A search names a puzzle with no session by its WCA name, the matched letters marked.
  await page.keyboard.type("m");
  await part(page, "switch-query").fill("мульти");
  const multi = part(page, "switch-grid").locator(
    'li[data-tile="event"][data-event="333mbf"]',
  );
  await expect(multi).toHaveAttribute("data-selected");
  await expect(multi.locator('[data-part="switch-label"]')).toHaveText(
    "Мульти-блайнд",
  );
  await expect(multi.locator("mark")).toHaveText("Мульти");
});
