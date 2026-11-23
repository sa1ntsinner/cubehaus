import { expect, type Page } from "@playwright/test";

export const action = (page: Page, name: string) =>
  page.locator(`[data-action="${name}"]`);

/** The open session's name on the status line; it opens the switch. */
export const sessionButton = (page: Page) => action(page, "session-switch");

const switchSheet = (page: Page) => page.locator('[data-part="switch"]');

export async function openSwitch(page: Page) {
  await expect(sessionButton(page)).toBeEnabled();
  await sessionButton(page).click();
  await expect(switchSheet(page)).toBeVisible();
}

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A session's tile in the open switch, by its name. */
export function switchRow(page: Page, name: string) {
  return page
    .locator('[data-part="switch-grid"] li[data-tile="session"]')
    .filter({
      has: page.locator('[data-part="switch-label"]', {
        hasText: new RegExp(`^${escapeRegExp(name)}$`),
      }),
    });
}

/** The sessions' names in their order, read from the switch, which closes again. */
export async function sessionNames(page: Page): Promise<string[]> {
  await openSwitch(page);
  const names = await page
    .locator(
      '[data-part="switch-grid"] li[data-tile="session"] [data-part="switch-label"]',
    )
    .allTextContents();
  await page.keyboard.press("Escape");
  await expect(switchSheet(page)).toHaveCount(0);
  return names;
}

/** Opens the session called `name` through the switch. */
export async function switchSession(page: Page, name: string) {
  await openSwitch(page);
  await switchRow(page, name).locator('[data-action="switch-pick"]').click();
  await expect(switchSheet(page)).toHaveCount(0);
  await expect(sessionButton(page)).toHaveText(name);
}

/** The find line of the open switch: typed into with keys, or `Find` on a touch screen. */
export async function findInSwitch(page: Page, text: string) {
  const query = page.locator('[data-part="switch-query"]');
  if (!(await query.isVisible())) {
    const find = page.locator('[data-action="switch-find"]');
    if (await find.isVisible()) await find.click();
    else await page.keyboard.type(text.slice(0, 1));
  }
  await query.fill(text);
}

/** Creates a session called `name` in `event`: typed, then the event stepped to. */
export async function createSession(page: Page, name: string, event: string) {
  await openSwitch(page);
  await findInSwitch(page, name);
  const create = page.locator(
    '[data-part="switch-grid"] li[data-tile="create"]',
  );
  await expect(create).toHaveCount(1);
  for (let step = 0; step < 18; step++) {
    if ((await create.getAttribute("data-event")) === event) break;
    await create.locator('[data-action="switch-event"]').click();
  }
  await expect(create).toHaveAttribute("data-event", event);
  await create.locator('[data-action="switch-pick"]').click();
  await expect(switchSheet(page)).toHaveCount(0);
  await expect(sessionButton(page)).toHaveText(name);
  await expect(sessionButton(page)).toHaveAttribute("data-event", event);
}

/** The open session's tile menu in the switch (a right click): Rename or Delete. */
export async function currentSessionAction(
  page: Page,
  name: "switch-rename" | "switch-delete",
) {
  await openSwitch(page);
  const tile = page.locator(
    '[data-part="switch-grid"] li[data-tile="session"][data-current]',
  );
  await tile.locator('[data-action="switch-pick"]').click({ button: "right" });
  await tile.locator(`[data-action="${name}"]`).click();
}

export async function renameCurrentSession(page: Page, name: string) {
  await currentSessionAction(page, "switch-rename");
  const field = page.locator('[data-part="switch-rename"]');
  await expect(field).toBeFocused();
  await field.fill(name);
  await field.press("Enter");
  await expect(
    page.locator(
      '[data-part="switch-grid"] li[data-current] [data-part="switch-label"]',
    ),
  ).toHaveText(name);
  await page.keyboard.press("Escape");
  await expect(switchSheet(page)).toHaveCount(0);
  await expect(sessionButton(page)).toHaveText(name);
}

export async function deleteCurrentSession(page: Page) {
  const before = await sessionButton(page).getAttribute("data-id");
  await currentSessionAction(page, "switch-delete");
  await expect(
    page.locator(`[data-part="switch-grid"] li[data-id="${before}"]`),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(switchSheet(page)).toHaveCount(0);
}

// Inspection is on by default (as at a competition). Specs about the plain
// timer flow switch it off for the session with the I key, as a person would.
// The database must be open, since the choice is stored with the session.
export async function inspectionOff(page: Page) {
  const main = page.locator("main");
  await expect(sessionButton(page)).toBeEnabled();
  if ((await main.getAttribute("data-inspection")) === "off") return;
  // Keys are ignored for 200 ms after a stop, so a bounce cannot act.
  await page.waitForTimeout(250);
  await page.keyboard.press("KeyI");
  await expect(main).toHaveAttribute("data-inspection", "off");
}

// One keyboard solve in whatever flow the session has: with inspection, a
// press and release starts it first. A real 100 ms passes between start and
// stop, since a stop under 0.06 s is not a solve (A6b1).
export async function keyboardSolve(page: Page) {
  const timer = page.locator("main");
  await expect(timer).toHaveAttribute("data-phase", /^(idle|stopped)$/);
  // No attempt starts without a scramble on screen.
  await expect(page.locator('[data-part="scramble"]')).toHaveAttribute(
    "data-ready",
    "true",
  );
  if ((await timer.getAttribute("data-inspection")) !== "off") {
    await page.keyboard.down("Space");
    await page.keyboard.up("Space");
    await expect(timer).toHaveAttribute("data-phase", "inspecting");
  }
  await page.keyboard.down("Space");
  await expect(timer).toHaveAttribute("data-phase", "ready");
  await page.keyboard.up("Space");
  await expect(timer).toHaveAttribute("data-phase", "running");
  await page.waitForTimeout(100);
  await page.keyboard.down("Space");
  await expect(timer).toHaveAttribute("data-phase", "stopped");
  await page.keyboard.up("Space");
}
