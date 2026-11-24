import { createRequire } from "node:module";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// axe-core (MPL-2.0) over every screen but the timer: Algorithms, Settings, Progress and
// the sheets. One size per screen, the light theme; serious and critical findings fail.
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

async function serious(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: axePath });
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== "running"),
  );
  return page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run(
            context: unknown,
            options: unknown,
          ): Promise<{
            violations: {
              id: string;
              impact: string | null;
              nodes: { target: string[] }[];
            }[];
          }>;
        };
      }
    ).axe;
    const { violations } = await axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    });
    return violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(" ")}`));
  });
}

const at = (state: string, hash = "") =>
  `/?state=${state}&lang=en&theme=light&now=2026-11-22T12:00${hash}`;
const part = (page: Page, name: string) =>
  page.locator(`[data-part="${name}"]`).first();
const phone = { width: 390, height: 844 };
const narrowest = { width: 340, height: 740 };

const csTimerFile = JSON.stringify({
  session1: [
    [[0, 12345], "R U R' U'", "", 1767225600],
    [[2000, 13345], "F R U", "", 1767225700],
  ],
  properties: {
    sessionData: JSON.stringify({ 1: { name: "Practice", opt: {} } }),
  },
});

type Screen = {
  name: string;
  size?: { width: number; height: number } | undefined;
  open(page: Page): Promise<void>;
};

const screens: Screen[] = [
  {
    name: "algorithms, a case open",
    open: async (page) => {
      await page.goto(at("train-learn", "#/train/pll/learn"));
      await page
        .locator('[data-part="train-case-list"] li button[aria-label="T"]')
        .click();
      await expect(page.locator('[data-part="train-case"] h2')).toHaveText("T");
    },
  },
  {
    name: "algorithms, a drill's result",
    size: phone,
    open: async (page) => {
      await page.goto(at("train-drill", "&test-turn=0#/train/pll/drill"));
      await expect(part(page, "train-picture").locator("svg")).toBeVisible();
      await page.keyboard.down("Space");
      await page.waitForTimeout(400);
      await page.keyboard.up("Space");
      await page.waitForTimeout(200);
      await page.keyboard.press("Space");
      await expect(part(page, "train-result")).toBeVisible();
    },
  },
  {
    name: "algorithms, review",
    open: async (page) => {
      await page.goto(at("train-review", "#/train/pll/review"));
      await expect(page.locator("h1")).toHaveText("Algorithms");
    },
  },
  {
    name: "algorithms, the set sheet",
    size: narrowest,
    open: async (page) => {
      await page.goto(at("train-learn", "#/train/pll/learn"));
      await page.locator('[data-action="train-set-open"]').click();
      await expect(part(page, "train-set-sheet")).toBeVisible();
    },
  },
  ...(["session", "timer", "look", "keys", "data", "more"] as const).map(
    (section): Screen => ({
      name: `settings, ${section}`,
      size: section === "more" ? phone : undefined,
      open: async (page) => {
        await page.goto(at("settings", `#/settings/${section}`));
        await expect(page.locator("h1")).toHaveText("Settings");
      },
    }),
  ),
  {
    name: "settings, the theme editor",
    open: async (page) => {
      await page.goto(at("settings-theme", "#/settings/look"));
      await expect(page.locator("#theme-base")).toBeVisible();
    },
  },
  {
    name: "settings, a shortcut clash",
    open: async (page) => {
      await page.goto(at("keymap-conflict", "#/settings/keys"));
      await expect(part(page, "bindings")).toBeVisible();
    },
  },
  {
    name: "settings, an import's preview",
    size: phone,
    open: async (page) => {
      await page.goto(at("session", "#/settings/data"));
      await page.locator('[data-action="import-file"] input').setInputFiles({
        name: "cstimer.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(csTimerFile),
      });
      await expect(part(page, "import-preview")).toBeVisible();
    },
  },
  {
    name: "progress",
    open: async (page) => {
      await page.goto(at("progress", "#/progress"));
      await expect(part(page, "progress-average")).toBeVisible();
    },
  },
  {
    name: "progress, days on a phone",
    size: phone,
    open: async (page) => {
      await page.goto(at("progress", "#/progress"));
      const days = page.locator('[data-part="progress-views"] [data-view]');
      if ((await days.count()) > 2) await days.nth(2).click();
      await expect(page.locator("h1")).toHaveText("Progress");
    },
  },
  {
    name: "progress, a target",
    open: async (page) => {
      await page.goto(at("progress-target", "#/progress"));
      await expect(part(page, "progress-target")).toBeVisible();
    },
  },
  {
    name: "the session grid",
    size: phone,
    open: async (page) => {
      await page.goto(at("switch"));
      await expect(part(page, "switch")).toBeVisible();
    },
  },
  {
    name: "the move sheet",
    open: async (page) => {
      await page.goto(at("move"));
      await expect(part(page, "switch")).toBeVisible();
    },
  },
  {
    name: "an average's detail",
    open: async (page) => {
      await page.goto(at("average-window"));
      await expect(part(page, "solve-no")).toHaveText("6");
      await page.keyboard.press("ArrowUp");
      await page.locator('[data-part="stats-now"] [data-slot="ao5"]').click();
      await page.locator('[data-action="average-inspect"]').click();
      await expect(part(page, "average-detail")).toBeVisible();
    },
  },
  {
    name: "the command palette",
    open: async (page) => {
      await page.goto(at("palette"));
      await expect(part(page, "palette")).toBeVisible();
    },
  },
  {
    name: "the gesture list",
    size: phone,
    open: async (page) => {
      await page.goto(at("keys"));
      await expect(part(page, "keys-help")).toBeVisible();
    },
  },
];

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "one engine is enough",
);

test("the screens beside the timer have no serious axe findings", async ({
  page,
}) => {
  test.setTimeout(120_000);
  for (const screen of screens) {
    await page.setViewportSize(screen.size ?? { width: 1280, height: 800 });
    await screen.open(page);
    expect(await serious(page), screen.name).toEqual([]);
  }
});

test("the keyboard stays on the page after controls change or go", async ({
  page,
}) => {
  const focused = (selector: string) =>
    expect(page.locator(selector)).toBeFocused();
  // A drill's result: Enter on Missed marks it missed instead of going on.
  await page.goto(at("train-drill", "&test-turn=0#/train/pll/drill"));
  await expect(part(page, "train-picture").locator("svg")).toBeVisible();
  await page.keyboard.down("Space");
  await page.waitForTimeout(400);
  await page.keyboard.up("Space");
  await page.waitForTimeout(200);
  await page.keyboard.press("Space");
  const missed = page.locator('[data-action="train-missed"]');
  await missed.focus();
  await page.keyboard.press("Enter");
  await expect(missed).toHaveAttribute("aria-pressed", "true");
  await focused('[data-action="train-missed"]');
  // Next goes with the result: the keyboard is on the next case.
  await page.locator('[data-action="train-next"]').focus();
  await page.keyboard.press("Enter");
  await focused('[data-part="train-stage"]');

  // Unbind leaves the keys beside it; Reset keeps the keyboard.
  await page.goto(at("keymap", "#/settings/keys"));
  const row = page.locator('[data-part="bindings"] li').filter({
    has: page.locator('[data-action="binding-remove"]:not([disabled])'),
  });
  const id = await row.first().getAttribute("data-binding");
  await row.first().locator('[data-action="binding-remove"]').focus();
  await page.keyboard.press("Enter");
  await focused(`[data-binding="${id}"] [data-action="binding-change"]`);
  await page.locator('[data-action="keyboard-reset"]').focus();
  await page.keyboard.press("Enter");
  await focused('[data-action="keyboard-reset"]');

  // Resetting a custom theme's colours takes the word away: focus goes to Based on.
  await page.goto(at("settings-theme", "#/settings/look"));
  await page.locator('[data-action="theme-reset-colours"]').focus();
  await page.keyboard.press("Enter");
  await focused("#theme-base");
});
