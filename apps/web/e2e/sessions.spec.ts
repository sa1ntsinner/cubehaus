import { readFile } from "node:fs/promises";
import { formatAverage, resultValue } from "@cubehaus/core";
import type { Locator, Page } from "@playwright/test";
import { performanceSolve } from "../src/testing/performance-data";
import { expect, test } from "./fixtures";
import {
  action,
  createSession,
  deleteCurrentSession,
  inspectionOff,
  openSwitch,
  renameCurrentSession,
  sessionButton,
  sessionNames,
  switchRow,
  switchSession,
} from "./helpers";

const timer = (page: Page) => page.locator("[data-timer-surface]");
const moveButton = (page: Page) =>
  page.locator('[data-part="last-actions"] [data-action="solve-move"]');
const part = (page: Page, name: string) =>
  page.locator(`[data-part="${name}"]`);
const stat = (page: Page, name: string) =>
  page.locator(`[data-stat="${name}"]`);
const rows = (page: Page) => part(page, "solves").locator("[data-solve-id]");

async function solveId(row: Locator) {
  const id = await row.getAttribute("data-solve-id");
  if (!id) throw new Error("Missing solve ID");
  return id;
}

async function ready(page: Page, event: string) {
  await expect(sessionButton(page)).toBeEnabled();
  await expect(part(page, "scramble")).toHaveAttribute("data-event", event);
  await expect(part(page, "scramble")).toHaveAttribute("data-ready", "true");
  // These specs time solves with exact timestamps, without inspection.
  await inspectionOff(page);
}

async function solve(page: Page, attempt: number, ms: number) {
  // Keys are ignored for 200 ms after a stop, so a bounce cannot act.
  await page.waitForTimeout(250);
  // Supply event timestamps so exact result and stat assertions are
  // independent of the browser's scheduling and animation frames.
  await page.evaluate(
    ({ attempt, ms }) => {
      const send = (type: "keydown" | "keyup", at: number) => {
        const key = new KeyboardEvent(type, {
          code: "Space",
          key: " ",
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(key, "timeStamp", { value: at });
        window.dispatchEvent(key);
      };
      const start = -200_000 + 20_000 * attempt;
      send("keydown", start - 300);
      send("keyup", start);
      send("keydown", start + ms);
      send("keyup", start + ms + 1);
    },
    { attempt, ms },
  );
}

test("first run names the session 3×3 and lists official event names", async ({
  page,
}) => {
  await page.goto("/");
  await expect(sessionButton(page)).toHaveText("3×3");
  await openSwitch(page);
  const list = part(page, "switch-list");
  const current = list.locator("> li[data-current]");
  await expect(current).toHaveCount(1);
  await expect(current.locator('[data-part="switch-label"]')).toHaveText("3×3");
  // Every other event is a row under its official name, in WCA order.
  const events = list.locator('> li[data-row="event"]');
  await expect(events).toHaveCount(17);
  await expect(events.first().locator('[data-part="switch-label"]')).toHaveText(
    "2x2x2 Cube",
  );
  const event = (id: string) => events.and(page.locator(`[data-id="${id}"]`));
  await expect(event("fto").locator('[data-part="switch-label"]')).toHaveText(
    "Face Turning Octahedron",
  );
  // FTO is official from 2 January 2027 (draft 12f), Clock until WC2027; the notes go then.
  const fto = event("fto").locator('[data-part="switch-note"]');
  if (Date.now() < Date.UTC(2027, 0, 2))
    await expect(fto).toHaveText("official from 2 January 2027");
  else await expect(fto).toHaveCount(0);
  const clock = event("clock").locator('[data-part="switch-note"]');
  if (Date.now() < Date.UTC(2027, 6, 19))
    await expect(clock).toHaveText("official until 18 July 2027");
  else await expect(clock).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(part(page, "switch")).toHaveCount(0);
});

test("sessions keep their event and solves across reload", async ({ page }) => {
  await page.goto("/");
  await ready(page, "333");
  const first = await sessionButton(page).getAttribute("data-id");
  await solve(page, 1, 3100);
  await expect(rows(page)).toHaveCount(1);
  const firstSolve = await solveId(rows(page).first());

  await createSession(page, "Two", "222");
  await ready(page, "222");
  await expect(part(page, "scramble")).toHaveText(
    /^(?:[URFDLB][2']?\s+){10}[URFDLB][2']?$/,
  );
  const second = await sessionButton(page).getAttribute("data-id");
  expect(second).not.toBe(first);
  await expect(rows(page)).toHaveCount(0);
  await solve(page, 2, 2200);
  await expect(rows(page)).toHaveCount(1);
  const secondSolve = await solveId(rows(page).first());
  expect(secondSolve).not.toBe(firstSolve);

  await renameCurrentSession(page, "Two practice");

  await page.reload();
  await ready(page, "222");
  await expect(sessionButton(page)).toHaveAttribute("data-id", second ?? "");
  await expect(sessionButton(page)).toHaveText("Two practice");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveAttribute(
    "data-solve-id",
    secondSolve,
  );

  await switchSession(page, "3×3");
  await ready(page, "333");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveAttribute("data-solve-id", firstSolve);

  await switchSession(page, "Two practice");
  await ready(page, "222");
  await deleteCurrentSession(page);
  await expect(sessionButton(page)).toHaveAttribute("data-id", first ?? "");
  await action(page, "undo").click();
  await expect(sessionButton(page)).toHaveAttribute("data-id", second ?? "");
  await expect(rows(page).first()).toHaveAttribute(
    "data-solve-id",
    secondSolve,
  );
});

test("S and Enter go back and forth, aliases open events once, Tab picks a new session's event", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page, "333");
  const sheet = part(page, "switch");
  const query = part(page, "switch-query");
  const timerPage = page.locator("main");

  // A name nothing matches: Create in the open session's event; Tab steps to the next.
  await page.keyboard.press("KeyS");
  await expect(query).toBeFocused();
  await query.fill("Friday");
  const create = part(page, "switch-list").locator('> li[data-row="create"]');
  await expect(create).toHaveAttribute("data-event", "333");
  await expect(create).toHaveAttribute("data-selected");
  await page.keyboard.press("Tab");
  await expect(create).toHaveAttribute("data-event", "222");
  await expect(query).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(sheet).toHaveCount(0);
  await expect(sessionButton(page)).toHaveText("Friday");
  await expect(sessionButton(page)).toHaveAttribute("data-event", "222");

  // With no query Enter takes the session open before this one.
  await page.keyboard.press("KeyS");
  await page.keyboard.press("Enter");
  await expect(sessionButton(page)).toHaveText("3×3");
  await page.keyboard.press("KeyS");
  await page.keyboard.press("Enter");
  await expect(sessionButton(page)).toHaveText("Friday");

  // An alias opens its event as a session named by its label, and the second time the
  // same session, never a copy.
  for (let time = 0; time < 2; time++) {
    await page.keyboard.press("KeyS");
    await query.fill("oh");
    await page.keyboard.press("Enter");
    await expect(sessionButton(page)).toHaveText("OH");
    await expect(sessionButton(page)).toHaveAttribute("data-event", "333oh");
  }
  await page.keyboard.press("KeyS");
  await query.fill("скьюб");
  await page.keyboard.press("Enter");
  await expect(sessionButton(page)).toHaveAttribute("data-event", "skewb");
  expect(await sessionNames(page)).toEqual(["3×3", "Friday", "OH", "Skewb"]);

  // F2 renames the open session in place; Esc leaves the name as it was.
  await page.keyboard.press("F2");
  const field = part(page, "switch-rename");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("Skewb");
  await field.fill("Skewb practice");
  await field.press("Enter");
  await expect(sheet).toHaveCount(0);
  await expect(sessionButton(page)).toHaveText("Skewb practice");
  await page.keyboard.press("F2");
  await field.fill("Lost");
  await field.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(sessionButton(page)).toHaveText("Skewb practice");

  // Esc and a click on the empty ground close it, and the keys go back to the timer.
  await page.keyboard.press("KeyS");
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await page.keyboard.press("KeyS");
  const size = page.viewportSize();
  await page.mouse.click((size?.width ?? 800) - 8, (size?.height ?? 600) - 8);
  await expect(sheet).toHaveCount(0);
  await expect(timerPage).toHaveAttribute("data-phase", /^(idle|stopped)$/);

  // The open session survives a restart.
  await page.reload();
  await expect(sessionButton(page)).toHaveText("Skewb practice");
});

test("holding Space in the switch types a space and starts no solve", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page, "333");
  await page.keyboard.press("KeyS");
  const query = part(page, "switch-query");
  await expect(query).toBeFocused();
  await page.keyboard.down("Space");
  await page.waitForTimeout(800);
  await page.keyboard.up("Space");
  await expect(query).toHaveValue(" ");
  await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
  // Focus on a row's button: Space is that button's, not the timer's.
  await page
    .locator(
      '[data-part="switch-list"] > li[data-current] [data-action="switch-pick"]',
    )
    .focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(800);
  await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
  await page.keyboard.up("Space");
  await expect(part(page, "switch")).toHaveCount(0);
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
});

test("an event's inspection choice follows its sessions and stays when switching", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page, "333");
  const main = page.locator("main");
  await expect(main).toHaveAttribute("data-inspection", "off");
  await createSession(page, "Two", "222");
  await expect(main).not.toHaveAttribute("data-inspection", "off");
  await switchSession(page, "3×3");
  await expect(main).toHaveAttribute("data-inspection", "off");
  // A new 3×3 session starts with the choice made for 3×3.
  await createSession(page, "Second", "333");
  await expect(main).toHaveAttribute("data-inspection", "off");
  await switchSession(page, "Two");
  await expect(main).not.toHaveAttribute("data-inspection", "off");
});

/** The switch's folder and session rows as shown: `▾ name` or `▸ name`, `  name` inside. */
async function layoutRows(page: Page) {
  return part(page, "switch-list")
    .locator('> li:is([data-row="folder"], [data-row="session"])')
    .evaluateAll((items) =>
      items.map((item) => {
        const label =
          item.querySelector('[data-part="switch-label"]')?.textContent ?? "";
        if (item.getAttribute("data-row") === "folder")
          return `${item.getAttribute("data-collapsed") === "true" ? "▸" : "▾"} ${label}`;
        return item.getAttribute("data-depth") === "1" ? `  ${label}` : label;
      }),
    );
}

const switchRowNamed = (page: Page, name: string) =>
  part(page, "switch-list")
    .locator("> li")
    .filter({
      has: page.locator('[data-part="switch-label"]', {
        hasText: new RegExp(`^${name}$`),
      }),
    });

test("a drag groups two sessions, keys move and close rows, undo puts them back, and reload keeps it", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page, "333");
  await createSession(page, "B", "222");
  await createSession(page, "C", "444");
  await openSwitch(page);
  await expect.poll(() => layoutRows(page)).toEqual(["3×3", "B", "C"]);

  // The mouse drags 3×3 onto the middle of B: a folder of the two, its name ready.
  const pick = (name: string) =>
    switchRowNamed(page, name).locator('[data-action="switch-pick"]');
  const from = await pick("3×3").boundingBox();
  const to = await pick("B").boundingBox();
  if (!from || !to) throw new Error("No rows");
  await page.mouse.move(from.x + 60, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 60, to.y + to.height / 2, { steps: 8 });
  await expect(switchRowNamed(page, "B")).toHaveAttribute("data-drop", "on");
  await page.mouse.up();
  const field = part(page, "switch-rename");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("Folder");
  await field.fill("Cubes");
  await field.press("Enter");
  await expect
    .poll(() => layoutRows(page))
    .toEqual(["▾ Cubes", "  B", "  3×3", "C"]);
  await expect(part(page, "switch-query")).toBeFocused();

  // Keys: C up into the open folder, then back out; Mod+Z undoes the last move.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(switchRowNamed(page, "C")).toHaveAttribute("data-selected");
  await page.keyboard.press("Alt+ArrowUp");
  await expect
    .poll(() => layoutRows(page))
    .toEqual(["▾ Cubes", "  B", "  3×3", "  C"]);
  await page.keyboard.press("Alt+ArrowDown");
  await expect
    .poll(() => layoutRows(page))
    .toEqual(["▾ Cubes", "  B", "  3×3", "C"]);
  await expect(part(page, "switch-undo")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(() => layoutRows(page))
    .toEqual(["▾ Cubes", "  B", "  3×3", "  C"]);
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(() => layoutRows(page))
    .toEqual(["▾ Cubes", "  B", "  3×3", "C"]);

  // Left closes the folder from its row, Right opens it; closed is stored.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(switchRowNamed(page, "Cubes")).toHaveAttribute("data-selected");
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => layoutRows(page)).toEqual(["▸ Cubes", "C"]);

  // A drag that Esc cancels changes nothing and starts no solve.
  const c = await pick("C").boundingBox();
  const cubes = await pick("Cubes").boundingBox();
  if (!c || !cubes) throw new Error("No rows");
  await page.mouse.move(c.x + 60, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(cubes.x + 60, cubes.y + 4, { steps: 6 });
  await expect(switchRowNamed(page, "Cubes")).toHaveAttribute(
    "data-drop",
    "before",
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(part(page, "switch")).toBeVisible();
  await expect.poll(() => layoutRows(page)).toEqual(["▸ Cubes", "C"]);
  await page.keyboard.press("Escape");
  await expect(part(page, "switch")).toHaveCount(0);
  await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");

  // [ ] walk the list as shown, folders opened.
  await page.reload();
  await ready(page, "444");
  await expect(sessionButton(page)).toHaveText("C");
  await page.keyboard.press("BracketLeft");
  await expect(sessionButton(page)).toHaveText("3×3");
  await page.keyboard.press("BracketLeft");
  await expect(sessionButton(page)).toHaveText("B");
  // The open session's closed folder shows open, and the order survived.
  await openSwitch(page);
  await expect
    .poll(() => layoutRows(page))
    .toEqual(["▾ Cubes", "  B", "  3×3", "C"]);
});

test("Mod+Backspace archives a session out of the list; search, the archive and the menu bring it back", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page, "333");
  await createSession(page, "B", "222");
  await createSession(page, "C", "444");
  await openSwitch(page);
  // The highlight starts on the session open before: B.
  await expect(switchRowNamed(page, "B")).toHaveAttribute("data-selected");
  await page.keyboard.press("ControlOrMeta+Backspace");
  await expect(part(page, "switch-undo")).toContainText("Archived.");
  await expect.poll(() => layoutRows(page)).toEqual(["3×3", "C"]);
  const archive = part(page, "switch-list").locator(
    '> li[data-row="view"][data-id="archive"]',
  );
  await expect(archive.locator('[data-part="switch-count"]')).toHaveText("1");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => layoutRows(page)).toEqual(["3×3", "B", "C"]);
  await expect(archive).toHaveCount(0);

  // The menu archives too; the archive lists it, Esc comes back.
  const b = switchRowNamed(page, "B");
  await b.hover();
  await b.locator('[data-action="switch-more"]').click();
  await b.locator('[data-action="switch-archive"]').click();
  await expect.poll(() => layoutRows(page)).toEqual(["3×3", "C"]);
  await archive.locator('[data-action="switch-pick"]').click();
  await expect(part(page, "switch")).toHaveAttribute("data-view", "archive");
  await expect.poll(() => layoutRows(page)).toEqual(["B"]);
  await page.keyboard.press("Escape");
  await expect(part(page, "switch")).not.toHaveAttribute("data-view");
  await expect(part(page, "switch-query")).toBeFocused();

  // [ and ] go past it.
  await page.keyboard.press("Escape");
  await expect(part(page, "switch")).toHaveCount(0);
  await page.keyboard.press("BracketLeft");
  await expect(sessionButton(page)).toHaveText("3×3");
  await page.keyboard.press("BracketRight");
  await expect(sessionButton(page)).toHaveText("C");

  // Search finds it, marked, and opens it; open, it shows in the list where it stands.
  await openSwitch(page);
  await part(page, "switch-query").fill("B");
  await expect(switchRowNamed(page, "B")).toHaveAttribute("data-archived");
  await expect(
    switchRowNamed(page, "B").locator('[data-part="switch-note"]'),
  ).toHaveText("archived");
  await page.keyboard.press("Enter");
  await expect(sessionButton(page)).toHaveText("B");
  await openSwitch(page);
  await expect.poll(() => layoutRows(page)).toEqual(["3×3", "B", "C"]);
  await expect(switchRowNamed(page, "B")).toHaveAttribute("data-archived");
  const open = switchRowNamed(page, "B");
  await open.locator('[data-action="switch-more"]').click();
  await open.locator('[data-action="switch-unarchive"]').click();
  await expect(part(page, "switch-undo")).toContainText("Back in the list.");
  await expect(switchRowNamed(page, "B")).not.toHaveAttribute("data-archived");
  await page.keyboard.press("Escape");

  // It holds after a reload.
  await page.reload();
  await ready(page, "222");
  expect(await sessionNames(page)).toEqual(["3×3", "B", "C"]);
});

test("the trash keeps a session and a solve 30 days by the clock, then lets them go; an import brings nothing back", async ({
  page,
}) => {
  const day = 86_400_000;
  const start = Date.UTC(2026, 10, 1, 10);
  await page.clock.install({ time: start });
  await page.goto("/");
  await ready(page, "333");
  for (const attempt of [1, 2]) await solve(page, attempt, 9000 + attempt);
  await expect(rows(page)).toHaveCount(2);
  await createSession(page, "B", "222");
  await ready(page, "222");
  for (const attempt of [1, 2, 3]) await solve(page, attempt, 3000 + attempt);
  await expect(rows(page)).toHaveCount(3);

  // The history as a csTimer file, to import again once the trash has let go.
  await page.evaluate(() => {
    location.hash = "#/settings";
  });
  const button = page.locator('[data-action="export-cstimer"]');
  await expect(button).toBeEnabled();
  await button.focus();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.keyboard.press("Enter"),
  ]);
  const exported = {
    name: "cstimer.txt",
    mimeType: "text/plain",
    buffer: await readFile((await download.path()) as string),
  };
  await page.evaluate(() => {
    location.hash = "#/";
  });

  // One 3×3 solve deleted on its own, then B into the trash from its menu.
  await switchSession(page, "3×3");
  await expect(rows(page)).toHaveCount(2);
  await page.waitForTimeout(250);
  await page.keyboard.press("Backspace");
  await expect(rows(page)).toHaveCount(1);
  await openSwitch(page);
  const b = switchRowNamed(page, "B");
  await b.hover();
  await b.locator('[data-action="switch-more"]').click();
  await b.locator('[data-action="switch-delete"]').click();
  await expect(part(page, "switch-undo")).toContainText(
    "In the trash for 30 days.",
  );
  await expect.poll(() => layoutRows(page)).toEqual(["3×3"]);
  await page.keyboard.press("Escape");

  // After a reload the trash holds both, each with its time left.
  await page.reload();
  await ready(page, "333");
  const trashRows = part(page, "switch-list").locator(
    '> li[data-row="trashed"]',
  );
  const openTrash = async () => {
    await openSwitch(page);
    await part(page, "switch-list")
      .locator(
        '> li[data-row="view"][data-id="trash"] [data-action="switch-pick"]',
      )
      .click();
    await expect(part(page, "switch")).toHaveAttribute("data-view", "trash");
  };
  await openTrash();
  await expect(trashRows).toHaveCount(2);
  await expect(trashRows.filter({ hasText: "B" })).toContainText("3 solves");
  await expect(trashRows.first()).toContainText("30 days left");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // Two and a half hours before the deadline (B went a little after the start): still
  // there; the solve goes back by a pick.
  await page.clock.setSystemTime(start + 30 * day - 2.5 * 3_600_000);
  await openTrash();
  await expect(trashRows.filter({ hasText: "B" })).toContainText(
    "3 hours left",
  );
  await trashRows.filter({ hasText: "3×3" }).locator("button").click();
  await expect(trashRows).toHaveCount(1);
  await expect(part(page, "switch-undo")).toContainText("Restored:");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(rows(page)).toHaveCount(2);

  // Past it the trash empties itself a while after the start.
  await page.clock.setSystemTime(start + 30 * day + 15 * 60_000);
  await page.reload();
  await ready(page, "333");
  await page.clock.runFor(5_000);
  await page.waitForTimeout(500);
  // Back to a day earlier: had B only been hidden, the trash would show it again.
  await page.clock.setSystemTime(start + 29 * day);
  await page.reload();
  await ready(page, "333");
  await openSwitch(page);
  await expect(
    part(page, "switch-list").locator('> li[data-row="view"]'),
  ).toHaveCount(0);
  await expect.poll(() => layoutRows(page)).toEqual(["3×3"]);
  await page.keyboard.press("Escape");
  await expect(rows(page)).toHaveCount(2);

  // The file exported before: every solve is already here, and no session comes back.
  await page.evaluate(() => {
    location.hash = "#/settings";
  });
  const input = page.locator('[data-action="import-file"] input');
  await expect(input).toBeEnabled();
  await input.setInputFiles(exported);
  await expect(page.locator('[data-part="import-here"]')).toHaveText(
    "All 5 solves are already here.",
  );
  await expect(page.locator('[data-action="import-confirm"]')).toHaveCount(0);
});

test("M moves the solve on show to another session of its puzzle; undo and a repeat import bring nothing twice", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page, "333");
  for (const attempt of [1, 2, 3])
    await solve(page, attempt, 9000 + 100 * attempt);
  await expect(rows(page)).toHaveCount(3);
  await createSession(page, "B", "333");
  await ready(page, "333");
  await solve(page, 4, 9400);
  await expect(rows(page)).toHaveCount(1);
  await switchSession(page, "3×3");

  // The history as a csTimer file, to import again at the end.
  await page.evaluate(() => {
    location.hash = "#/settings";
  });
  const button = page.locator('[data-action="export-cstimer"]');
  await expect(button).toBeEnabled();
  await button.focus();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.keyboard.press("Enter"),
  ]);
  const exported = {
    name: "cstimer.txt",
    mimeType: "text/plain",
    buffer: await readFile((await download.path()) as string),
  };
  await page.evaluate(() => {
    location.hash = "#/";
  });
  await expect(rows(page)).toHaveCount(3);

  // ↑ to the middle solve, M, the destination typed, Enter.
  await page.locator("main").focus();
  await page.keyboard.press("ArrowUp");
  await expect(part(page, "time")).toHaveText("9.20");
  const scramble = await part(page, "scramble").textContent();
  await page.keyboard.press("KeyM");
  const query = part(page, "switch-query");
  await expect(query).toBeFocused();
  await expect(query).toHaveAttribute("placeholder", "Move this solve to…");
  // Only the other session of the puzzle is offered.
  await expect(part(page, "switch-list").locator("> li")).toHaveText([/^B/]);
  await query.fill("B");
  await query.press("Enter");
  await expect(part(page, "switch")).toHaveCount(0);
  await expect(part(page, "notice")).toHaveText("Moved to B");
  await expect(rows(page)).toHaveCount(2);
  // The one before it is on show now.
  await expect(part(page, "time")).toHaveText("9.10");

  // In B it is the same solve: its time and its scramble.
  await switchSession(page, "B");
  await expect(rows(page)).toHaveCount(2);
  await page.locator("main").focus();
  await page.keyboard.press("ArrowUp");
  await expect(part(page, "time")).toHaveText("9.20");
  await expect(part(page, "scramble")).toHaveText(scramble ?? "");

  // Undo moves it back by its ID.
  await page.keyboard.press("ControlOrMeta+KeyZ");
  await expect(rows(page)).toHaveCount(1);
  await switchSession(page, "3×3");
  await expect(rows(page)).toHaveCount(3);

  // Shift+↑ picks two; the status line's Move takes both.
  await page.locator("main").focus();
  await page.keyboard.press("Shift+ArrowUp");
  await expect(moveButton(page)).toHaveText("Move 2");
  await expect(rows(page).and(page.locator("[data-selected]"))).toHaveCount(2);
  await moveButton(page).click();
  await expect(query).toHaveAttribute("placeholder", "Move 2 solves to…");
  await switchRow(page, "B").locator('[data-action="switch-pick"]').click();
  await expect(part(page, "notice")).toHaveText("2 solves moved to B");
  await expect(rows(page)).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+KeyZ");
  await expect(rows(page)).toHaveCount(3);
  // Esc drops a pick before anything else.
  await page.locator("main").focus();
  await page.keyboard.press("Shift+ArrowUp");
  await expect(part(page, "last-actions")).toHaveAttribute(
    "data-selecting",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(part(page, "last-actions")).not.toHaveAttribute(
    "data-selecting",
  );
  await expect(part(page, "time-meta")).toHaveCount(1);

  // The file from before the moves: every solve is already here.
  await page.evaluate(() => {
    location.hash = "#/settings";
  });
  const input = page.locator('[data-action="import-file"] input');
  await expect(input).toBeEnabled();
  await input.setInputFiles(exported);
  await expect(page.locator('[data-part="import-here"]')).toHaveText(
    "All 4 solves are already here.",
  );
});

test.describe("moving rows on a touch screen", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  test("a long press lifts a row to drag, or opens its menu; a sideways swipe renames", async ({
    page,
  }) => {
    await page.goto("/");
    await ready(page, "333");
    await createSession(page, "B", "222");
    await createSession(page, "C", "444");
    await openSwitch(page);
    const pick = (name: string) =>
      switchRowNamed(page, name).locator('[data-action="switch-pick"]');
    const touch = async (
      name: string,
      steps: { x: number; y: number; wait?: number }[],
    ) => {
      const box = await pick(name).boundingBox();
      if (!box) throw new Error(`No row ${name}`);
      const start = { x: box.x + 60, y: box.y + box.height / 2 };
      await pick(name).evaluate(
        async (element, { start, steps }) => {
          const send = (type: string, x: number, y: number) =>
            element.dispatchEvent(
              new PointerEvent(type, {
                pointerId: 7,
                pointerType: "touch",
                isPrimary: true,
                button: 0,
                clientX: x,
                clientY: y,
                bubbles: true,
                cancelable: true,
              }),
            );
          send("pointerdown", start.x, start.y);
          let at = start;
          for (const step of steps) {
            await new Promise((done) => setTimeout(done, step.wait ?? 16));
            at = { x: step.x, y: step.y };
            send("pointermove", at.x, at.y);
          }
          await new Promise((done) => setTimeout(done, 16));
          send("pointerup", at.x, at.y);
        },
        { start, steps },
      );
    };

    // Hold 3×3, then drag it below C's middle: it goes last.
    const c = await pick("C").boundingBox();
    if (!c) throw new Error("No row C");
    const from = await pick("3×3").boundingBox();
    if (!from) throw new Error("No row 3×3");
    await touch("3×3", [
      { x: from.x + 60, y: from.y + from.height / 2 + 1, wait: 600 },
      { x: c.x + 60, y: c.y + c.height / 2 },
      { x: c.x + 60, y: c.y + c.height - 3 },
    ]);
    await expect.poll(() => layoutRows(page)).toEqual(["B", "C", "3×3"]);
    await expect(part(page, "switch-undo")).toBeVisible();

    // A hold without a drag opens the row's menu.
    const b = await pick("B").boundingBox();
    if (!b) throw new Error("No row B");
    await touch("B", [{ x: b.x + 60, y: b.y + b.height / 2, wait: 600 }]);
    await expect(switchRowNamed(page, "B")).toHaveAttribute("data-menu");
    await expect(page.locator('[data-action="switch-group"]')).toBeVisible();
    // New folder from the menu, its name ready to type.
    await page.locator('[data-action="switch-group"]').tap();
    await expect(part(page, "switch-rename")).toHaveValue("Folder");
    await part(page, "switch-rename").fill("Small");
    await part(page, "switch-rename").press("Enter");
    await expect
      .poll(() => layoutRows(page))
      .toEqual(["▾ Small", "  B", "C", "3×3"]);

    // A sideways swipe on C renames it in place.
    const cNow = await pick("C").boundingBox();
    if (!cNow) throw new Error("No row C");
    await touch("C", [
      { x: cNow.x + 100, y: cNow.y + cNow.height / 2 },
      { x: cNow.x + 160, y: cNow.y + cNow.height / 2 },
    ]);
    await expect(part(page, "switch-rename")).toHaveValue("C");
    await part(page, "switch-rename").fill("Four");
    await part(page, "switch-rename").press("Enter");
    await expect
      .poll(() => layoutRows(page))
      .toEqual(["▾ Small", "  B", "Four", "3×3"]);

    // A swipe to the left archives: B goes, and its folder with it.
    const bNow = await pick("B").boundingBox();
    if (!bNow) throw new Error("No row B");
    await touch("B", [
      { x: bNow.x + 20, y: bNow.y + bNow.height / 2 },
      { x: bNow.x - 40, y: bNow.y + bNow.height / 2 },
    ]);
    await expect(part(page, "switch-undo")).toContainText("Archived.");
    await expect.poll(() => layoutRows(page)).toEqual(["Four", "3×3"]);
    await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
  });
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test.describe(`the switch on a touch screen ${viewport.width}×${viewport.height}`, () => {
    test.use({ hasTouch: true, isMobile: true, viewport });

    test("a tap opens it without the keyboard, a row picks, a swipe on the name steps", async ({
      page,
    }) => {
      await page.goto("/");
      await ready(page, "333");
      await sessionButton(page).tap();
      const sheet = part(page, "switch");
      await expect(sheet).toBeVisible();
      await expect(part(page, "switch-query")).not.toBeFocused();
      const two = part(page, "switch-list").locator(
        '> li[data-row="event"][data-id="222"]',
      );
      const box = await two.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      await two.locator('[data-action="switch-pick"]').tap();
      await expect(sheet).toHaveCount(0);
      await expect(sessionButton(page)).toHaveText("2×2");

      // A sideways swipe on the name: right goes back a session, left forward.
      const swipe = async (dx: number) => {
        const name = await sessionButton(page).boundingBox();
        if (!name) throw new Error("No session name");
        const x = name.x + name.width / 2;
        const y = name.y + name.height / 2;
        await sessionButton(page).evaluate(
          (element, { x, y, dx }) => {
            const send = (type: string, clientX: number) =>
              element.dispatchEvent(
                new PointerEvent(type, {
                  pointerId: 9,
                  pointerType: "touch",
                  isPrimary: true,
                  clientX,
                  clientY: y,
                  bubbles: true,
                  cancelable: true,
                }),
              );
            send("pointerdown", x);
            send("pointermove", x + dx / 2);
            send("pointerup", x + dx);
          },
          { x, y, dx },
        );
      };
      await swipe(80);
      await expect(sessionButton(page)).toHaveText("3×3");
      await expect(sheet).toHaveCount(0);
      await swipe(-80);
      await expect(sessionButton(page)).toHaveText("2×2");
      // A short or upright move is not a swipe.
      await swipe(20);
      await expect(sessionButton(page)).toHaveText("2×2");
    });
  });
}

test.describe("solve actions and input", () => {
  test.use({ hasTouch: true });

  test("touch actions update rows and stats, and only pointer activation returns focus", async ({
    page,
  }) => {
    await page.goto("/");
    await ready(page, "333");
    for (const [index, ms] of [1000, 2000, 3000, 8000, 4000].entries()) {
      await solve(page, index + 1, ms);
      await expect(rows(page)).toHaveCount(index + 1);
    }
    const latest = rows(page).first();
    const plus2 = action(page, "penalty-plus2");
    const dnf = action(page, "penalty-dnf");
    const undo = action(page, "undo");
    await expect(rows(page)).toHaveCount(5);
    await expect(stat(page, "ao5")).toHaveText("3.00");

    await plus2.tap();
    await expect(timer(page)).toHaveAttribute("data-phase", "idle");
    await expect(timer(page)).toBeFocused();
    await expect(latest).toHaveAttribute("data-plus2", "1");
    await expect(stat(page, "ao5")).toHaveText("3.67");
    await expect(latest.locator('[data-part="solve-ao5"]')).toHaveText("3.67");

    await dnf.tap();
    await expect(timer(page)).toHaveAttribute("data-phase", "idle");
    await expect(latest).toHaveAttribute("data-penalty", "dnf");
    await expect(latest).toHaveAttribute("data-plus2", "1");
    await expect(stat(page, "ao5")).toHaveText("4.33");

    const id = await solveId(latest);
    await action(page, "solve-delete").tap();
    await expect(timer(page)).toHaveAttribute("data-phase", "idle");
    await expect(rows(page)).toHaveCount(4);
    await expect(stat(page, "ao5")).toBeEmpty();
    await undo.tap();
    await expect(timer(page)).toHaveAttribute("data-phase", "idle");
    await expect(rows(page)).toHaveCount(5);
    await expect(stat(page, "ao5")).toHaveText("4.33");
    await expect(latest).toHaveAttribute("data-solve-id", id);
    await undo.tap();
    await expect(latest).toHaveAttribute("data-penalty", "plus2");
    await expect(stat(page, "ao5")).toHaveText("3.67");

    await latest.locator('[data-action="comment-edit"]').tap();
    await part(page, "comment-input").fill("Practice");
    await action(page, "comment-save").tap();
    await expect(part(page, "solve-comment")).toHaveText("// Practice");
    await undo.tap();
    await expect(part(page, "solve-comment")).toHaveCount(0);

    await expect(timer(page)).toBeFocused();
    await page.keyboard.down("Space");
    await expect(timer(page)).toHaveAttribute("data-phase", "ready");
    await page.keyboard.up("Space");
    await expect(timer(page)).toHaveAttribute("data-phase", "running");
    // A stop under 0.06 s is not a solve (A6b1): let a real 100 ms pass.
    await page.waitForTimeout(100);
    await plus2.tap();
    await expect(timer(page)).toHaveAttribute("data-phase", "idle");
    await expect(rows(page)).toHaveCount(6);

    // Safari's Tab skips buttons unless the person turned that on, so focus
    // the button directly: what matters is Space on a focused button.
    await plus2.focus();
    await expect(plus2).toBeFocused();
    await page.keyboard.press("Space");
    await expect(plus2).toBeFocused();
    await expect(timer(page)).toHaveAttribute("data-phase", "idle");
    await expect(latest).toHaveAttribute("data-plus2", "1");
  });

  test("the solve list is its own touch-scroll container", async ({ page }) => {
    await page.goto("/");
    await ready(page, "333");
    await expect(part(page, "solves")).toHaveCSS("overflow-y", "auto");
    await expect(part(page, "solves")).toHaveCSS("touch-action", "pan-y");
    await expect(page.locator("body")).toHaveCSS("margin", "0px");
  });
});

test("sessions picked with Shift merge into another of their puzzle by keyboard; another puzzle is refused and undo splits them", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page, "333");
  await solve(page, 1, 9100);
  for (const [attempt, name, event, ms] of [
    [2, "B", "333", 9200],
    [3, "C", "333", 9300],
    [4, "Two", "222", 3000],
  ] as const) {
    await createSession(page, name, event);
    await ready(page, event);
    await solve(page, attempt, ms);
    await expect(rows(page)).toHaveCount(1);
  }
  await switchSession(page, "3×3");
  await expect(rows(page)).toHaveCount(1);

  await openSwitch(page);
  const query = part(page, "switch-query");
  await expect(query).toBeFocused();
  const picked = page.locator(
    '[data-part="switch-list"] > li[data-picked] [data-part="switch-label"]',
  );
  // To the top, one down to B, then Shift+↓ picks B and C.
  for (let step = 0; step < 6; step++) await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(picked).toHaveText(["B", "C"]);
  await expect(part(page, "switch-picked")).toContainText("Merge 2 into…");

  // With Two picked too the merge is refused and the pick stays. Two's own menu offers
  // no Merge: there is no other 2×2 session.
  await page.keyboard.press("Shift+ArrowDown");
  await expect(picked).toHaveText(["B", "C", "Two"]);
  await page.keyboard.press("Shift+F10");
  await expect(action(page, "switch-rename")).toBeFocused();
  await expect(action(page, "switch-merge")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(query).toBeFocused();
  await action(page, "switch-merge-picked").click();
  await expect(part(page, "switch-undo")).toHaveText(
    "Only sessions of one puzzle merge.",
  );
  await expect(picked).toHaveText(["B", "C", "Two"]);

  // Back to B and C; the menu from the keyboard, → to Merge, Enter.
  await query.focus();
  await page.keyboard.press("Shift+ArrowUp");
  await expect(picked).toHaveText(["B", "C"]);
  await page.keyboard.press("Shift+F10");
  await expect(action(page, "switch-rename")).toBeFocused();
  for (let step = 0; step < 3; step++) await page.keyboard.press("ArrowRight");
  await expect(action(page, "switch-merge")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(query).toBeFocused();
  await expect(query).toHaveAttribute("placeholder", "Merge 2 sessions into…");
  // Only the other 3×3 session takes them.
  await expect(
    part(page, "switch-list").locator("> li [data-part='switch-label']"),
  ).toHaveText(["3×3"]);
  await page.keyboard.press("Enter");
  await expect(part(page, "switch-undo")).toContainText("Merged into “3×3”.");
  await expect(switchRow(page, "B")).toHaveCount(0);
  await expect(switchRow(page, "C")).toHaveCount(0);
  await expect(picked).toHaveCount(0);
  // Nothing was deleted: the trash has no row to show.
  await expect(
    page.locator('[data-part="switch-list"] > li[data-row="view"]'),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(part(page, "switch")).toHaveCount(0);
  await expect(sessionButton(page)).toHaveText("3×3");
  await expect(rows(page)).toHaveCount(3);
  expect(await sessionNames(page)).toEqual(["3×3", "Two"]);

  // A new solve, then Mod+Z: B and C come back with their solves; the new one stays.
  await ready(page, "333");
  await solve(page, 5, 9500);
  await expect(rows(page)).toHaveCount(4);
  await page.locator("main").focus();
  // Keys rest for 200 ms after a stop.
  await page.waitForTimeout(250);
  await page.keyboard.press("ControlOrMeta+KeyZ");
  await expect(rows(page)).toHaveCount(2);
  await expect(part(page, "time")).toHaveText("9.50");
  expect(await sessionNames(page)).toEqual(["3×3", "B", "C", "Two"]);
  await switchSession(page, "C");
  await expect(rows(page)).toHaveCount(1);
  await expect(part(page, "time")).toHaveText("9.30");
});

test("Shift+S splits the session before the solve on show; undo joins it, and a renamed part survives reload", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page, "333");
  for (const [attempt, ms] of [
    [1, 12_000],
    [2, 10_000],
    [3, 14_000],
    [4, 16_000],
  ] as const)
    await solve(page, attempt, ms);
  await expect(rows(page)).toHaveCount(4);
  await expect(stat(page, "mean")).toHaveText("13.00");

  // Before the first solve there is nothing to part. Keys rest 200 ms after a stop.
  await page.waitForTimeout(250);
  await page.locator("main").focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowUp");
  await expect(part(page, "time")).toHaveText("12.00");
  await page.keyboard.press("Shift+KeyS");
  await expect(part(page, "time-status")).toHaveText("No earlier solve");
  await expect(rows(page)).toHaveCount(4);

  // ↓ ↓ to the third solve: the two before it go, it and the last one stay, on show.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(part(page, "time")).toHaveText("14.00");
  await page.keyboard.press("Shift+KeyS");
  const notice = part(page, "notice");
  await expect(notice).toHaveText(
    /^2 earlier solves are now in 3×3 until \d{1,2} [A-Z][a-z]{2}$/,
  );
  const earlier = ((await notice.textContent()) ?? "").replace(
    /^2 earlier solves are now in /,
    "",
  );
  await expect(sessionButton(page)).toHaveText("3×3");
  await expect(rows(page)).toHaveCount(2);
  await expect(part(page, "time")).toHaveText("14.00");
  await expect(stat(page, "mean")).toHaveText("15.00");
  // The earlier part stands just above, with its own numbers.
  expect(await sessionNames(page)).toEqual([earlier, "3×3"]);
  await switchSession(page, earlier);
  await expect(rows(page)).toHaveCount(2);
  await expect(stat(page, "mean")).toHaveText("11.00");

  // Undo from the earlier part puts every solve back and opens the session again.
  await page.locator("main").focus();
  await page.keyboard.press("ControlOrMeta+KeyZ");
  await expect(sessionButton(page)).toHaveText("3×3");
  await expect(rows(page)).toHaveCount(4);
  await expect(stat(page, "mean")).toHaveText("13.00");
  expect(await sessionNames(page)).toEqual(["3×3"]);

  // Split again from the last solve, rename the earlier part, reload: both stay.
  await page.locator("main").focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowDown");
  await expect(part(page, "time")).toHaveText("16.00");
  await page.keyboard.press("Shift+KeyS");
  await expect(rows(page)).toHaveCount(1);
  await switchSession(page, earlier);
  await renameCurrentSession(page, "Before the camp");
  await page.reload();
  await ready(page, "333");
  await expect(sessionButton(page)).toHaveText("Before the camp");
  await expect(rows(page)).toHaveCount(3);
  expect(await sessionNames(page)).toEqual(["Before the camp", "3×3"]);
});

test("totals wait for two results and omit the newest best single", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page, "333");
  const totals = part(page, "stats-totals");
  await expect(totals).toHaveCount(0);
  await solve(page, 1, 12_000);
  await expect(part(page, "time")).toHaveText("12.00");
  await expect(totals).toHaveCount(0);
  await ready(page, "333");
  await solve(page, 2, 10_000);
  await expect(part(page, "time")).toHaveText("10.00");
  await expect(stat(page, "mean")).toHaveText("11.00");
  await expect(stat(page, "best")).toHaveCount(0);
  await ready(page, "333");
  await solve(page, 3, 14_000);
  await expect(part(page, "time")).toHaveText("14.00");
  await expect(stat(page, "best")).toHaveText("10.00");
  await expect(stat(page, "mean")).toHaveText("12.00");
});

test("3×3 Blindfolded shows the best slot after a slower solve", async ({
  page,
}) => {
  await page.goto("/");
  await createSession(page, "Blindfolded", "333bf");
  const scramble = part(page, "scramble");
  await expect(scramble).toHaveAttribute("data-event", "333bf");
  await expect(scramble).toHaveAttribute("data-ready", "true");

  const slots = part(page, "stats-now");
  const best = slots.locator('[data-slot="best"]');
  await solve(page, 1, 1_200);
  await expect(part(page, "time")).toHaveText("1.20");
  await expect(slots.locator('[data-slot="ao5"]')).toHaveCount(1);
  await expect(best).toHaveCount(0);

  await expect(scramble).toHaveAttribute("data-ready", "true");
  await solve(page, 2, 2_000);
  await expect(part(page, "time")).toHaveText("2.00");
  await expect(best.locator('[data-stat="best"]')).toHaveText("1.20");
});

test.describe("splitting on a touch screen", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  test("a long-pressed line splits the session there, and undo joins it", async ({
    page,
  }) => {
    await page.goto("/");
    await ready(page, "333");
    for (const attempt of [1, 2, 3]) await solve(page, attempt, 9000 + attempt);
    await expect(rows(page)).toHaveCount(3);
    const line = rows(page)
      .filter({ has: page.locator('[data-part="solve-no"]:text-is("2")') })
      .locator('[data-action="solve-show"]');
    await line.scrollIntoViewIfNeeded();
    const box = await line.boundingBox();
    if (!box) throw new Error("no line");
    const at = { clientX: box.x + box.width / 2, clientY: box.y + 4 };
    await line.dispatchEvent("pointerdown", {
      pointerType: "touch",
      isPrimary: true,
      ...at,
    });
    const split = action(page, "solve-split");
    await expect(split).toHaveText("Split here");
    await line.dispatchEvent("pointerup", { pointerType: "touch", ...at });
    await line.dispatchEvent("click");
    // Two picked lines are no single place: the action goes.
    const first = rows(page)
      .filter({ has: page.locator('[data-part="solve-no"]:text-is("1")') })
      .locator('[data-action="solve-show"]');
    await first.tap();
    await expect(split).toHaveCount(0);
    await first.tap();
    await split.tap();
    await expect(part(page, "notice")).toHaveText(
      /^1 earlier solve is now in 3×3 until /,
    );
    await expect(rows(page)).toHaveCount(2);
    await expect(part(page, "last-actions")).not.toHaveAttribute(
      "data-selecting",
    );
    await action(page, "undo").tap();
    await expect(rows(page)).toHaveCount(3);
    expect(await sessionNames(page)).toEqual(["3×3"]);
  });
});

test("standard and custom rolling averages follow the shown solve and persist", async ({
  page,
}) => {
  await page.goto("/?seed=60");
  const main = page.locator("main");
  const slot = (id: string) => page.locator(`[data-slot="${id}"]`);
  const picker = page.locator('[data-part="stat-picker"]');
  const displayed = (id: string) => slot(id).locator(`[data-stat="${id}"]`);
  await expect(
    page.locator("[data-solve-id]").first().locator('[data-part="solve-no"]'),
  ).toHaveText("60");
  await slot("ao5").focus();
  await page.keyboard.press("Enter");
  await expect(picker).toBeVisible();
  const custom = picker.locator('[data-part="custom-stat"] input');
  await custom.focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(350);
  await expect(main).toHaveAttribute("data-phase", "idle");
  await page.keyboard.up("Space");
  await picker.locator('[data-stat-choice="ao50"]').click();
  await expect(displayed("ao50")).toHaveText(averageAt(50, 59));
  await slot("ao12").click();
  await custom.fill("20");
  await custom.press("Enter");
  await expect(displayed("ao20")).not.toHaveText("");
  await expect(displayed("ao50")).not.toHaveText("");
  await slot("ao20").click();
  await picker.locator('[data-stat-choice="ao50"]').click();
  await expect(
    page.locator('[data-part="stats-now"] [data-slot]').first(),
  ).toHaveAttribute("data-slot", "ao20");

  await page.reload();
  await expect(displayed("ao20")).toHaveText(averageAt(20, 59));
  await expect(displayed("ao50")).toHaveText(averageAt(50, 59));
  await main.focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(displayed("ao20")).toHaveText(averageAt(20, 57));
  await expect(displayed("ao50")).toHaveText(averageAt(50, 57));
});

function averageAt(size: number, end: number): string {
  const values = Array.from({ length: size }, (_, i) =>
    resultValue(performanceSolve(end + i + 1 - size, "synthetic", 1)),
  ).sort((a, b) => a - b);
  const trim = Math.ceil(size * 0.05);
  const middle = values.slice(trim, size - trim);
  return formatAverage(
    middle.reduce((sum, value) => sum + value, 0) / middle.length,
  );
}

test("timer layouts keep solve identity, display precision and quiet records", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page, "333");
  const time = part(page, "time");
  const layout = (value: string) =>
    expect(timer(page)).toHaveAttribute("data-layout", value);
  const settings = () => action(page, "settings").click();
  const closeSettings = () => action(page, "settings-close").click();
  const settingLayout = page.locator("#setting-layout");
  const fileTimes = rows(page).locator('[data-part="solve-time"]');

  await layout("lift");
  await solve(page, 1, 16000);
  await expect(fileTimes.first()).toHaveText("16.00");
  await solve(page, 2, 12349);
  await expect(time).toHaveText("12.34");
  await expect(time).toHaveAttribute("data-record", "true");
  await expect(fileTimes.first()).toHaveText("12.34");
  const fast = await solveId(rows(page).first());

  await settings();
  await settingLayout.selectOption("times");
  await expect(settingLayout).toHaveValue("times");
  await page.locator("#setting-precision").selectOption("3");
  await expect(page.locator("#setting-precision")).toHaveValue("3");
  await page.locator("#setting-recordCue").selectOption("off");
  await expect(page.locator("#setting-recordCue")).toHaveValue("off");
  await closeSettings();
  await layout("times");
  await expect(time).toHaveText("12.349");
  await expect(fileTimes.first()).toHaveText("12.349");
  await expect(rows(page).locator('[data-part="solve-ao5"]')).toHaveCount(0);
  await expect(timer(page).locator("[data-record]")).toHaveCount(0);

  await settings();
  await settingLayout.selectOption("focus");
  await expect(settingLayout).toHaveValue("focus");
  await closeSettings();
  await layout("focus");
  await expect(part(page, "file")).toHaveCount(0);
  await ready(page, "333");
  for (let attempt = 3; attempt <= 7; attempt++) {
    await solve(page, attempt, 600990);
    await expect(time).toHaveText("10:00");
  }
  await expect(stat(page, "ao5")).toHaveText("10:01");
  await expect(stat(page, "best")).toHaveText("12.349");
  // The post-stop key guard also applies to the first history key.
  await page.waitForTimeout(250);
  await timer(page).focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowUp");
  await expect(timer(page)).toHaveAttribute("data-shown-solve", fast);
  await expect(time).toHaveText("12.349");
  await action(page, "solve-later").click();
  await expect(time).toHaveText("10:00");

  await page.reload();
  await layout("focus");
  await expect(time).toHaveText("10:00");
  await expect(timer(page).locator("[data-record]")).toHaveCount(0);
  await expect(stat(page, "best")).toHaveText("12.349");
  await settings();
  await settingLayout.selectOption("lift");
  await expect(settingLayout).toHaveValue("lift");
  await closeSettings();
  await layout("lift");
  await expect(fileTimes.first()).toHaveText("10:00");
  await expect(rows(page)).toHaveCount(7);
});
