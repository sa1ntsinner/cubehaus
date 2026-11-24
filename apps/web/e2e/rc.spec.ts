import type { Page } from "@playwright/test";
import { ACTIONS } from "../src/keys/actions";
import { expect, test } from "./fixtures";

// Release-candidate walk: every action the timer offers at rest, reached the way a
// person would, with real key presses. Bound actions use their first default key;
// unbound ones are found in the palette by their title and run with Enter. Each
// action must run without a page error, Escape must bring the timer back, and the
// solves must still be there (a delete or a split is undone with Mod+Z first).
// The timer's own start keys are walked in timer.spec.ts; the contextual keys of
// the sheet, palette, progress chart, entry and stat list in their own specs.

const part = (page: Page, name: string) =>
  page.locator(`[data-part="${name}"]`);
const solves = (page: Page) => part(page, "solves").locator("[data-solve-id]");

const press = (key: string) => key.replace(/^Mod\+/, "ControlOrMeta+");

const atRest = ACTIONS.filter(
  (action) =>
    !action.input &&
    action.when.includes("idle") &&
    action.id !== "palette" &&
    action.id !== "escape",
);

async function addTypedSolve(page: Page, time: string) {
  await expect(part(page, "scramble")).toHaveAttribute("data-ready", "true");
  const input = part(page, "entry-input");
  await input.fill(time);
  await input.press("Enter");
  await expect(part(page, "solve-time").first()).toHaveText(time);
}

test.beforeEach(async ({ page, context, browserName }) => {
  if (browserName === "chromium")
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const mode = part(page, "entry-mode");
  await mode.selectOption("typing");
  await addTypedSolve(page, "12.34");
  await addTypedSolve(page, "10.00");
  await mode.selectOption("timer");
  await expect(part(page, "entry")).toHaveCount(0);
  await page.locator("main").focus();
});

test("the walk covers every action at rest", () => {
  expect(atRest.length).toBeGreaterThan(40);
});

for (const action of atRest) {
  test(`${action.id} runs from the keyboard and Escape returns`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    const key = action.keys[0];
    if (key) {
      await page.keyboard.press(press(key));
    } else {
      await page.keyboard.press("ControlOrMeta+KeyK");
      const query = part(page, "palette-query");
      await expect(query).toBeFocused();
      await query.pressSequentially(action.title.en);
      const results = part(page, "palette-results").locator("li");
      const ids = await results.evaluateAll((items) =>
        items.map((item) => item.getAttribute("data-action-id")),
      );
      const at = ids.indexOf(action.id);
      expect(at, `${action.id} in the palette`).toBeGreaterThanOrEqual(0);
      for (let i = 0; i < at; i++) await query.press("ArrowDown");
      await query.press("Enter");
      await expect(part(page, "palette")).toHaveCount(0);
    }

    // Undo whatever the action removed, then leave whatever it opened.
    if (action.id === "solve.delete" || action.id === "solve.split") {
      await expect(solves(page)).toHaveCount(1);
      await page.keyboard.press("ControlOrMeta+KeyZ");
    }
    const open = page.locator("dialog[open], [role='dialog']");
    const main = page.locator("main");
    const away = async () =>
      (await open.count()) > 0 ||
      !/^(idle|stopped)$/.test(
        (await main
          .getAttribute("data-phase", { timeout: 500 })
          .catch(() => null)) ?? "",
      );
    // A screen that opens late (Settings, Progress and the drills load their own code)
    // needs time first: its code can be fetched and still not drawn, so an Escape sent
    // before it shows closes nothing and the screen comes up after the walk. Once the
    // network is idle it draws within a few frames; an action that opens nothing waits
    // out the whole poll, so the poll is short.
    await page.waitForLoadState("networkidle");
    await expect
      .poll(away, { timeout: 500 })
      .toBe(true)
      .catch(() => {});
    for (let i = 0; i < 4 && (await away()); i++) {
      await page.keyboard.press("Escape");
      await expect
        .poll(away, { timeout: 1500 })
        .toBe(false)
        .catch(() => {});
    }
    await expect(open).toHaveCount(0);
    await expect(page.locator("main")).toHaveAttribute(
      "data-phase",
      /^(idle|stopped)$/,
    );
    // Focus hides the list; a session key may show another session.
    if (!/^(session|layout)\./.test(action.id)) {
      await expect(solves(page)).toHaveCount(2);
    }
    expect(errors).toEqual([]);
  });
}
