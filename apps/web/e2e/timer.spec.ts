import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { inspectionOff } from "./helpers";

// The plain timer flow: inspection is switched off for the session.
// official.spec.ts covers the flow with inspection.
test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
  await inspectionOff(page);
});

test("loads at least 15 scramble moves within three seconds", async ({
  page,
}) => {
  await expect
    .poll(
      async () => {
        const text = await page.locator('[data-part="scramble"]').textContent();
        return (
          text
            ?.trim()
            .split(/\s+/)
            .filter((move) => /^[URFDLB](?:2|')?$/.test(move)).length ?? 0
        );
      },
      { timeout: 3000 },
    )
    .toBeGreaterThanOrEqual(15);
});

test("the scramble line stays empty until the first scramble arrives", async ({
  page,
}) => {
  // Every text the line shows from the first paint on.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    new MutationObserver(() => {
      const line = document.querySelector('main > [data-part="scramble"]');
      const text = line?.textContent?.trim() ?? "";
      if (seen.at(-1) !== text) seen.push(text);
    }).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  await page.reload();
  await expect(page.locator('[data-part="scramble"]')).toHaveAttribute(
    "data-ready",
    "true",
  );
  const seen = await page.evaluate(
    () => (window as unknown as { seen: string[] }).seen,
  );
  expect(seen.filter((text) => /No scramble|Retry/.test(text))).toEqual([]);
});

test("holds, readies, runs and stops using Space", async ({ page }) => {
  const timer = page.locator("main");
  await page.keyboard.down("Space");
  await expect(timer).toHaveAttribute("data-phase", "holding");
  await page.waitForTimeout(400);
  await expect(timer).toHaveAttribute("data-phase", "ready");
  await page.keyboard.up("Space");
  await expect(timer).toHaveAttribute("data-phase", "running");
  await page.waitForTimeout(500);
  await page.keyboard.down("Space");
  await expect(timer).toHaveAttribute("data-phase", "stopped");
  const time = page.locator('[data-part="time"]');
  await expect(time).toHaveText(/^0\.\d\d$/);
  const seconds = Number(await time.textContent());
  expect(seconds).toBeGreaterThanOrEqual(0.45);
  expect(seconds).toBeLessThanOrEqual(0.75);
  await page.keyboard.up("Space");
});

test("a short hold leaves the time unchanged", async ({ page }) => {
  const time = page.locator('[data-part="time"]');
  await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
  const previous = await time.textContent();
  await page.keyboard.down("Space");
  await page.waitForTimeout(100);
  await page.keyboard.up("Space");
  await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
  await expect(time).toHaveText(previous ?? "");
});

for (const modifier of ["Meta", "Control"]) {
  test(`${modifier}+Space leaves the timer idle`, async ({ page }) => {
    await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
    await page.keyboard.press(`${modifier}+Space`);
    await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
  });
}

test("the release after a stop does not arm another solve", async ({
  page,
}) => {
  const timer = page.locator("main");
  await expect(timer).toHaveAttribute("data-phase", "idle");
  await page.keyboard.down("Space");
  await page.waitForTimeout(400);
  await page.keyboard.up("Space");
  await expect(timer).toHaveAttribute("data-phase", "running");
  await page.waitForTimeout(500);
  await page.keyboard.down("Space");
  await expect(timer).toHaveAttribute("data-phase", "stopped");
  const result = await page.locator('[data-part="time"]').textContent();
  await page.keyboard.up("Space");
  await page.waitForTimeout(500);
  await expect(timer).toHaveAttribute("data-phase", "idle");
  await expect(page.locator('[data-part="time"]')).toHaveText(result ?? "");
});

// Records every data-phase the page shows, so a brief unwanted start is seen.
async function recordPhases(page: Page) {
  await page.evaluate(() => {
    const main = document.querySelector("main");
    const seen: string[] = [];
    (window as unknown as { phases: string[] }).phases = seen;
    if (!main) return;
    new MutationObserver(() => {
      seen.push(main.getAttribute("data-phase") ?? "");
    }).observe(main, { attributes: true, attributeFilter: ["data-phase"] });
  });
  return () =>
    page.evaluate(() => (window as unknown as { phases: string[] }).phases);
}

test("an empty session says how to start until its first solve", async ({
  page,
}) => {
  const hint = page.locator('[data-part="solves-empty"]');
  // Both wordings are in the markup; CSS shows the one for the input at hand.
  const keys = hint.locator('[data-input="keys"]');
  await expect(keys).toBeVisible();
  await expect(hint.locator('[data-input="touch"]')).toBeHidden();
  await expect(keys).toHaveText(
    "// No solves yet. Hold Space, let go to start.",
  );
  const timer = page.locator("main");
  await page.keyboard.down("Space");
  await expect(timer).toHaveAttribute("data-phase", "ready");
  await page.keyboard.up("Space");
  await expect(timer).toHaveAttribute("data-phase", "running");
  await page.waitForTimeout(100);
  await page.keyboard.down("Space");
  await expect(timer).toHaveAttribute("data-phase", "stopped");
  await page.keyboard.up("Space");
  await expect(hint).toHaveCount(0);
});

test.describe("an empty session on a touch screen", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  test("says to hold the screen", async ({ page }) => {
    const touch = page.locator(
      '[data-part="solves-empty"] [data-input="touch"]',
    );
    await expect(touch).toBeVisible();
    await expect(
      page.locator('[data-part="solves-empty"] [data-input="keys"]'),
    ).toBeHidden();
    await expect(touch).toHaveText(
      "// No solves yet. Hold the screen, let go to start.",
    );
  });
});

test.describe("touch", () => {
  test.use({ hasTouch: true });

  test("holds, runs and stops using a finger", async ({
    page,
    browserName,
  }) => {
    const timer = page.locator("main");
    // The finger goes on the time: the scramble picture (no timer) may sit in
    // the middle of the surface.
    const box = await page.locator('[data-part="time"]').boundingBox();
    if (!box) throw new Error("the time has no box");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    let touch: (type: "down" | "up") => Promise<void>;
    if (browserName === "chromium") {
      // A real touch through the browser's input pipeline.
      const cdp = await page.context().newCDPSession(page);
      touch = async (type) => {
        await cdp.send("Input.dispatchTouchEvent", {
          type: type === "down" ? "touchStart" : "touchEnd",
          touchPoints: type === "down" ? [{ x, y }] : [],
        });
      };
    } else {
      // Playwright has no touch hold for WebKit; dispatch the pointer events
      // a finger produces. This checks the binding and timing, not gestures.
      touch = (type) =>
        page.evaluate(
          ([kind, px, py]) => {
            const target = document.elementFromPoint(px, py) ?? document.body;
            target.dispatchEvent(
              new PointerEvent(kind === "down" ? "pointerdown" : "pointerup", {
                bubbles: true,
                cancelable: true,
                pointerId: 7,
                pointerType: "touch",
                isPrimary: true,
                button: kind === "down" ? 0 : -1,
                clientX: px,
                clientY: py,
              }),
            );
          },
          [type, x, y] as const,
        );
    }
    await touch("down");
    await expect(timer).toHaveAttribute("data-phase", "holding");
    await page.waitForTimeout(400);
    await touch("up");
    await expect(timer).toHaveAttribute("data-phase", "running");
    await page.waitForTimeout(500);
    await touch("down");
    await expect(timer).toHaveAttribute("data-phase", "stopped");
    const seconds = Number(
      await page.locator('[data-part="time"]').textContent(),
    );
    expect(seconds).toBeGreaterThanOrEqual(0.45);
    expect(seconds).toBeLessThanOrEqual(0.75);
    await touch("up");
    await expect(timer).toHaveAttribute("data-phase", "idle");
  });
});

test("dragging the mouse across the scramble does not start a solve", async ({
  page,
}) => {
  const scramble = page.locator('[data-part="scramble"]');
  await expect(scramble).toHaveAttribute("data-ready", "true");
  const box = await scramble.boundingBox();
  if (!box) throw new Error("scramble has no box");
  const phases = await recordPhases(page);
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    await page.waitForTimeout(50);
    await page.mouse.move(
      box.x + 2 + ((box.width - 4) * step) / 10,
      box.y + box.height / 2,
    );
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
  await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
  expect(await phases()).toEqual([]);
});

test("a short Space tap delayed by a blocked main thread does not start a solve", async ({
  page,
}) => {
  const phases = await recordPhases(page);
  // Playwright cannot queue a real keyup with an early hardware timestamp:
  // its injected events are stamped when the page dispatches them. So the
  // page builds the keyup itself, 100 ms after the keydown, while its main
  // thread is blocked until 400 ms. The keyup is dispatched in the first
  // animation frame after the block, after the timer's own frame callback has
  // seen a frame time past the 300 ms hold.
  await page.evaluate(() => {
    window.addEventListener(
      "keydown",
      (down) => {
        const start = down.timeStamp;
        setTimeout(() => {
          while (performance.now() < start + 100) {}
          const up = new KeyboardEvent("keyup", {
            code: "Space",
            key: " ",
            bubbles: true,
            cancelable: true,
          });
          while (performance.now() < start + 400) {}
          requestAnimationFrame(() => window.dispatchEvent(up));
        }, 0);
      },
      { once: true },
    );
  });
  await page.keyboard.down("Space");
  await page.waitForTimeout(800);
  await expect(page.locator("main")).toHaveAttribute("data-phase", "idle");
  const seen = await phases();
  expect(seen).toContain("holding");
  expect(seen).not.toContain("running");
  await page.keyboard.up("Space");
});

test("both physical hand keys start on the last release and an unrelated key stops", async ({
  page,
}) => {
  await page.goto("/#/settings");
  const choice = page.locator("#setting-startMode");
  await choice.selectOption("two-hand");
  await expect(choice).toHaveValue("two-hand");
  await page.reload();
  await expect(choice).toHaveValue("two-hand");
  await page.locator('[data-action="settings-close"]').click();

  const timer = page.locator("main");
  const keys = page.locator('[data-part="hand-keys"]');
  const [left, right] = ["ControlLeft", "ControlRight"] as const;
  await expect(page.locator('[data-part="scramble"]')).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page.keyboard.press("Space");
  await expect(timer).toHaveAttribute("data-phase", "idle");
  await page.keyboard.down(left);
  await expect(keys.locator("kbd").first()).toHaveAttribute(
    "data-held",
    "true",
  );
  await expect(timer).toHaveAttribute("data-phase", "idle");
  await page.keyboard.down(right);
  await expect(keys).toHaveAttribute("data-armed", "true");
  await page.keyboard.up(left);
  await expect(timer).toHaveAttribute("data-phase", "ready");
  await page.keyboard.up(right);
  await expect(timer).toHaveAttribute("data-phase", "running");

  await page.waitForTimeout(170);
  await page.keyboard.press("KeyA");
  await page.keyboard.press("KeyD");
  const rows = page.locator("[data-solve-id]");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).not.toHaveAttribute("data-penalty", "dnf");
});
