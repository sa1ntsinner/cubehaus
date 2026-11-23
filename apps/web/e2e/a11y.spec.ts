import { createRequire } from "node:module";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { inspectionOff } from "./helpers";

// axe-core (MPL-2.0), injected as its own script: every screen, both built-in themes.
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

type Violation = {
  id: string;
  help: string;
  nodes: { target: string[]; failureSummary?: string }[];
};

async function audit(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: axePath });
  // Let fades and the landing finish: contrast is read from what rests on screen.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== "running"),
  );
  const violations = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run(
            context: unknown,
            options: unknown,
          ): Promise<{ violations: Violation[] }>;
        };
      }
    ).axe;
    const result = await axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
      },
    });
    return result.violations;
  });
  return violations.flatMap((v) =>
    v.nodes.map(
      (n) => `${v.id}: ${n.target.join(" ")} (${n.failureSummary ?? v.help})`,
    ),
  );
}

const ready = (page: Page) =>
  page
    .locator('[data-part="scramble"] [data-move]')
    .first()
    .waitFor({ timeout: 15_000 });

type Screen = { name: string; open(page: Page): Promise<void> };

const screens: Screen[] = [
  {
    name: "empty timer",
    open: async (page) => {
      await page.goto("/?state=empty&lang=en&theme=THEME");
      await ready(page);
    },
  },
  {
    name: "timer with solves",
    open: async (page) => {
      await page.goto("/?state=session&lang=en&theme=THEME");
      await ready(page);
    },
  },
  {
    name: "a past solve on show",
    open: async (page) => {
      await page.goto("/?state=session&lang=en&theme=THEME");
      await ready(page);
      await page.keyboard.press("ArrowUp");
      await expect(page.locator('[data-part="time-meta"]')).toBeVisible();
    },
  },
  {
    name: "session switch",
    open: async (page) => {
      await page.goto("/?state=session&lang=en&theme=THEME");
      await ready(page);
      await page.keyboard.press("s");
      await expect(page.locator('dialog[data-part="switch"]')).toBeVisible();
    },
  },
  {
    name: "keys",
    open: async (page) => {
      await page.goto("/?state=session&lang=en&theme=THEME");
      await ready(page);
      await page.keyboard.press("Shift+Slash");
      await expect(page.locator('[data-part="keys-help"]')).toBeVisible();
    },
  },
  {
    name: "settings",
    open: async (page) => {
      await page.goto("/?state=settings&lang=en&theme=THEME#/settings");
      await expect(page.locator("h1")).toBeVisible();
    },
  },
  {
    name: "progress",
    open: async (page) => {
      await page.goto(
        "/?state=progress&lang=en&theme=THEME&now=2026-11-22T12:00#/progress",
      );
      await expect(
        page.locator('[data-part="progress-average"]'),
      ).toBeVisible();
    },
  },
  {
    name: "algorithms, learn",
    open: async (page) => {
      await page.goto(
        "/?state=train-case&lang=en&theme=THEME&now=2026-11-22T12:00#/train/pll/learn",
      );
      await expect(
        page.locator('[data-part="train-case-list"] li').first(),
      ).toBeVisible();
    },
  },
  {
    name: "algorithms, drill",
    open: async (page) => {
      await page.goto(
        "/?state=train-drill&lang=en&theme=THEME&now=2026-11-22T12:00&test-turn=0#/train/pll/drill",
      );
      await expect(
        page.locator('[data-part="train-picture"] svg'),
      ).toBeVisible();
    },
  },
];

for (const theme of ["dark", "light"] as const)
  for (const screen of screens)
    test(`${screen.name} passes axe in the ${theme} theme`, async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== "chromium", "one engine is enough for axe");
      const goto = page.goto.bind(page);
      page.goto = (url, options) => goto(url.replace("THEME", theme), options);
      await screen.open(page);
      expect(await audit(page)).toEqual([]);
    });

/** The focused element, and whether a ring or outline is drawn for it. */
const focusState = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { tag: "body", ring: false };
    const style = getComputedStyle(el);
    const drawn = (s: CSSStyleDeclaration) =>
      s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
    // A ring may be drawn round the glyph's own target (the scramble's chevrons).
    const ring =
      drawn(style) ||
      drawn(getComputedStyle(el, "::before")) ||
      style.boxShadow !== "none" ||
      style.textDecorationLine.includes("underline");
    const box = el.getBoundingClientRect();
    return {
      tag: `${el.tagName.toLowerCase()}[${el.getAttribute("data-action") ?? el.getAttribute("data-part") ?? el.textContent?.trim().slice(0, 20)}]`,
      ring,
      // A zero-width box may draw its glyph beside it (the scramble's ›).
      visible: box.height > 0,
    };
  });

test("Tab walks the timer's controls with a visible ring on each", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "one engine is enough");
  await page.goto("/?state=session&lang=en&theme=dark");
  await ready(page);
  const seen: string[] = [];
  for (let i = 0; i < 300; i++) {
    await page.keyboard.press("Tab");
    const state = await focusState(page);
    if (state.tag === "body") continue;
    seen.push(state.tag);
    expect(state, state.tag).toMatchObject({ ring: true, visible: true });
    if (state.tag.includes("settings")) break;
  }
  // The file is one stop: its lines' times and comment words are walked with arrows.
  expect(seen.filter((tag) => tag.includes("solve-show"))).toHaveLength(1);
  expect(seen.filter((tag) => tag.includes("comment-edit"))).toHaveLength(0);
  // The status line's links and the session are among them.
  expect(seen.join(" ")).toContain("session-switch");
  expect(seen.join(" ")).toContain("progress");
  expect(seen.join(" ")).toContain("settings");
});

test("inside the file the arrows walk the lines and each line's comment word", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "one engine is enough");
  await page.goto("/?state=session&lang=en&theme=dark");
  await ready(page);
  const rows = page.locator('[data-part="solves"] [data-solve-id]');
  const time = (n: number) => rows.nth(n).locator('[data-action="solve-show"]');
  const comment = (n: number) =>
    rows.nth(n).locator('[data-action="comment-edit"]');
  // The stop is the line on show: the newest while nothing is scrubbed.
  for (let i = 0; i < 300; i++) {
    await page.keyboard.press("Tab");
    if ((await focusState(page)).tag.includes("solve-show")) break;
  }
  await expect(time(0)).toBeFocused();
  // Right and left move between the line's time and its comment word.
  await page.keyboard.press("ArrowRight");
  await expect(comment(0)).toBeFocused();
  expect(await focusState(page)).toMatchObject({ ring: true, visible: true });
  await page.keyboard.press("ArrowLeft");
  await expect(time(0)).toBeFocused();
  // Up shows the line before, and the keyboard goes with it.
  await page.keyboard.press("ArrowUp");
  await expect(rows.nth(1)).toHaveAttribute("data-shown", "true");
  await expect(time(1)).toBeFocused();
  // A comment is reached and opened from the keyboard.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-part="comment-input"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-part="comment-input"]')).toHaveCount(0);
  await expect(comment(1)).toBeFocused();
  await expect(rows.nth(1)).toHaveAttribute("data-shown", "true");
  // Tab leaves the file at once, past every other line.
  await time(1).focus();
  await page.keyboard.press("Tab");
  const next = (await focusState(page)).tag;
  expect(next).not.toContain("solve-show");
  expect(next).not.toContain("comment-edit");
  // Shift+Tab comes back to the same line.
  await page.keyboard.press("Shift+Tab");
  await expect(time(1)).toBeFocused();
});

for (const [name, opener, sheet] of [
  [
    "session switch",
    '[data-action="session-switch"]',
    'dialog[data-part="switch"]',
  ],
  ["key list", '[data-action="keys"]', '[data-part="keys-help"]'],
] as const)
  test(`Escape closes the ${name} and focus returns to what opened it`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "one engine is enough");
    await page.goto("/?state=session&lang=en&theme=dark");
    await ready(page);
    await page.locator(opener).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(sheet)).toBeVisible();
    // Focus is inside the sheet while it is open.
    expect(
      await page.evaluate(
        (s) => document.querySelector(s)?.contains(document.activeElement),
        sheet,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator(sheet)).toHaveCount(0);
    const focused = await page.evaluate(
      () =>
        document.activeElement?.getAttribute("data-action") ??
        document.activeElement?.tagName,
    );
    expect(focused).toBe(opener.match(/"(.+)"/)?.[1]);
  });

test("the stat picker closes on Escape and gives focus back to its slot", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "one engine is enough");
  await page.goto("/?state=session&lang=en&theme=dark");
  await ready(page);
  const slot = page.locator('[data-part="stats-now"] button').first();
  await slot.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-part="stat-picker"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-part="stat-picker"]')).toHaveCount(0);
  await expect(slot).toBeFocused();
});

test("a finished solve and a penalty are heard once each, the running time never", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "one engine is enough");
  await page.goto("/?state=session&lang=en&theme=dark");
  await ready(page);
  const time = page.locator('[data-part="time"]');
  const said = page.locator('[data-part="time-said"]');
  await expect(time).toHaveAttribute("aria-live", "off");
  await expect(said).toHaveAttribute("aria-live", "polite");
  await expect(said).toHaveText("");
  // Inspection off, so one hold and release starts the clock.
  await inspectionOff(page);
  await page.keyboard.down("Space");
  await page.waitForTimeout(400);
  await page.keyboard.up("Space");
  await expect(page.locator("[data-timer-surface]")).toHaveAttribute(
    "data-phase",
    "running",
  );
  await page.waitForTimeout(1200);
  await expect(said).toHaveText("");
  await page.keyboard.press("Space");
  await expect(said).toHaveText(/^\d+\.\d\d$/);
  const result = await said.textContent();
  // Keys rest for 200 ms after a stop, so a bounce cannot act.
  await page.waitForTimeout(250);
  await page.keyboard.press("2");
  await expect(said).toHaveText(/, \+2$/);
  await page.keyboard.press("d");
  await expect(said).toHaveText(`DNF, ${result}`);
});

test("with reduced motion nothing animates longer than a frame", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "one engine is enough");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const long = () =>
    page.evaluate(() =>
      document.getAnimations().flatMap((a) => {
        const timing = a.effect?.getComputedTiming();
        const duration = Number(timing?.duration ?? 0);
        return duration > 1
          ? [
              `${(a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? "script"} ${duration}`,
            ]
          : [];
      }),
    );
  await page.goto("/?state=session&lang=en&theme=dark");
  await ready(page);
  const found: string[] = [];
  await inspectionOff(page);
  await page.keyboard.down("Space");
  found.push(...(await long()));
  await page.waitForTimeout(400);
  await page.keyboard.up("Space");
  await page.waitForTimeout(300);
  await page.keyboard.press("Space");
  found.push(...(await long()));
  await page.keyboard.press("ArrowRight");
  found.push(...(await long()));
  await page.keyboard.press("s");
  found.push(...(await long()));
  await page.keyboard.press("Escape");
  await page.keyboard.press("f");
  found.push(...(await long()));
  await page.keyboard.press("Escape");
  await page.goto(
    "/?state=progress&lang=en&theme=dark&now=2026-11-22T12:00#/progress",
  );
  await expect(page.locator('[data-part="progress-average"]')).toBeVisible();
  found.push(...(await long()));
  await page.goto(
    "/?state=train-drill&lang=en&theme=dark&now=2026-11-22T12:00&test-turn=0#/train/pll/drill",
  );
  await expect(page.locator('[data-part="train-picture"] svg')).toBeVisible();
  await page.keyboard.down("Space");
  await page.waitForTimeout(400);
  await page.keyboard.up("Space");
  await page.waitForTimeout(200);
  await page.keyboard.press("Space");
  found.push(...(await long()));
  expect(found).toEqual([]);
});

for (const [name, link, heading] of [
  ["Progress", "progress", "Progress"],
  ["Settings", "settings", "Settings"],
  ["Algorithms", "train", "Algorithms"],
] as const)
  test(`Escape leaves ${name} and the timer takes the keyboard back`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "one engine is enough");
    await page.goto("/?state=session&lang=en&theme=dark");
    await ready(page);
    await page.locator(`[data-action="${link}"]`).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("h1")).toHaveText(heading);
    // The keyboard is on the new screen, not left on the page's body.
    await page.keyboard.press("Tab");
    expect((await focusState(page)).tag).not.toBe("body");
    await page.keyboard.press("Escape");
    await ready(page);
    // On the timer itself, so Space times the next solve at once.
    await expect(page.locator("[data-timer-surface]")).toBeFocused();
  });

test("a case opened from the keyboard closes on Escape onto its tile", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "one engine is enough");
  await page.goto("/#/train/pll/learn");
  // The list is drawn again once the stored cases arrive: wait for them.
  await expect(page.locator('[data-part="train-case-list"] li')).toHaveCount(
    21,
  );
  await expect(
    page
      .locator('[data-part="train-case-list"] [data-action="train-pick"]')
      .first(),
  ).toBeEnabled();
  const tile = page
    .locator('[data-part="train-case-list"] li button[aria-label="T"]')
    .first();
  await tile.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-part="train-case"] h2')).toHaveText("T");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-part="train-case"]')).toHaveCount(0);
  await expect(tile).toBeFocused();
  // A second Escape leaves Algorithms.
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#\/$/);
});
