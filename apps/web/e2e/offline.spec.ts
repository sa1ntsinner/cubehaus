import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";
import { build } from "vite";
import { inspectionOff, keyboardSolve, sessionButton } from "./helpers";
import { pngFixture } from "./png";

const contentTypes: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};
const firstRelease = fileURLToPath(new URL("../dist/", import.meta.url));

const test = base.extend<{
  releases: { url: string; publish(): void };
}>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
  releases: async ({}, use) => {
    const nextRelease = await mkdtemp(join(tmpdir(), "cubehaus-offline-"));
    let current = firstRelease;
    const server = createServer(async (request, response) => {
      const { pathname } = new URL(request.url ?? "/", "http://localhost");
      const file = join(current, pathname === "/" ? "index.html" : pathname);
      try {
        const bytes = await readFile(file);
        response
          .writeHead(200, {
            "Cache-Control": "no-store",
            "Content-Type":
              contentTypes[extname(file)] ?? "application/octet-stream",
          })
          .end(bytes);
      } catch {
        response.writeHead(404).end();
      }
    });

    try {
      await build({
        root: fileURLToPath(new URL("../", import.meta.url)),
        build: { outDir: nextRelease },
        define: { "import.meta.env.VITE_TEST_HOOKS": '"1"' },
        plugins: [
          {
            name: "offline-test-release",
            transformIndexHtml: {
              order: "post",
              handler: () => [
                {
                  tag: "meta",
                  attrs: { name: "offline-test-release", content: "2" },
                },
              ],
            },
          },
        ],
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      await use({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/?test-offline=1`,
        publish: () => {
          current = nextRelease;
        },
      });
    } finally {
      if (server.listening)
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        });
      await rm(nextRelease, { recursive: true, force: true });
    }
  },
});

// Playwright documents service worker support for Chromium only; these pass in its
// Firefox as well and stay off in WebKit, as before.
test.skip(
  ({ browserName }) => browserName === "webkit",
  "Playwright documents service worker support for Chromium only.",
);

test("the built app generates a 3×3 scramble and stores a solve offline", async ({
  page,
  context,
}) => {
  await page.goto("/?test-offline=1");
  await expect(page.locator("html")).toHaveAttribute("data-offline", "ready");
  await inspectionOff(page);

  await context.setOffline(true);
  await page.reload();
  const scramble = page.locator('[data-part="scramble"]');
  await expect(scramble).toHaveAttribute("data-event", "333");
  await expect(scramble).toHaveAttribute("data-ready", "true");
  await expect(scramble).toContainText(/[URFDLB]/);
  await expect(sessionButton(page)).toBeEnabled();
  await expect(page.locator('[data-part="db-state"]')).toHaveCount(0);
  await keyboardSolve(page);
  const row = page.locator('[data-part="solve-time"]');
  await expect(row).toHaveCount(1);
  const result = (await row.textContent())?.trim() ?? "";
  expect(result).not.toBe("");
  await page.reload();
  await expect(row).toHaveText(result);
});

test("a custom theme and its picture come back after an offline reload", async ({
  page,
  context,
}) => {
  await page.goto("/?test-offline=1#/settings/look");
  await expect(page.locator("html")).toHaveAttribute("data-offline", "ready");
  // Based on dark: the custom theme starts from the theme in view.
  await page.locator("#setting-theme").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator("#setting-theme").selectOption("custom");
  await expect(page.locator("#theme-base")).toHaveValue("dark");
  await page.locator("#theme-ink").fill("#f0f0f0");
  const picture = Buffer.from(pngFixture(32, 20, [10, 20, 30]));
  await page.locator('[data-action="theme-picture"] input').setInputFiles({
    name: "ground.png",
    mimeType: "image/png",
    buffer: picture,
  });
  await expect(page.locator("html")).toHaveAttribute("data-image", "");

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#theme-ink")).toHaveValue("#f0f0f0");
  await expect(page.locator("html")).toHaveAttribute("data-image", "");
  const ink = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--ink"),
  );
  expect(ink.trim()).toBe("#f0f0f0");
  // The stored bytes are the chosen file's.
  const shown = await page.evaluate(async () => {
    const url = getComputedStyle(document.documentElement)
      .getPropertyValue("--ground-image")
      .match(/url\("?([^")]+)"?\)/)?.[1];
    if (!url) return null;
    return Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer()));
  });
  expect(shown).toEqual(Array.from(picture));
  await page.locator('[data-action="theme-picture-remove"]').click();
  await expect(page.locator("html")).not.toHaveAttribute("data-image", "");
  await page.reload();
  await expect(page.locator("#theme-ink")).toHaveValue("#f0f0f0");
  await expect(
    page.locator('[data-action="theme-picture-remove"]'),
  ).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-image", "");
});

test("a drill works offline before any drill was ever asked for", async ({
  page,
  context,
}) => {
  await page.goto("/?test-offline=1");
  await expect(page.locator("html")).toHaveAttribute("data-offline", "ready");
  await inspectionOff(page);

  // The drill worker, its chunks and cubing's search inside it all come from the cache.
  await context.setOffline(true);
  await page.reload();
  const scramble = page.locator('[data-part="scramble"]');
  await expect(scramble).toHaveAttribute("data-ready", "true");
  // A scramble made ahead by the page before shows at once; the drills wait for the store.
  await expect(sessionButton(page)).toBeEnabled();
  await page.keyboard.press("KeyL");
  const sheet = page.locator('dialog[data-part="training"]');
  await sheet.locator('input[value="easy-xcross"]').check();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('[data-part="drill"]')).toContainText(
    "Drill: white xcross in 3 turns",
  );
  await expect(scramble).toHaveAttribute("data-ready", "true", {
    timeout: 15_000,
  });
  await page.keyboard.press("KeyV");
  const solution = page.locator('[data-part="drill-solution"]');
  await expect(solution).toHaveAttribute("data-state", "found");
  await expect(solution).toHaveText(/ \(3\) · [UDFBRL]{2} slot$/);
  await keyboardSolve(page);
  await expect(page.locator('[data-part="solve-time"]')).toHaveCount(1);
});

test("a new build waits through a running solve and reloads when accepted", async ({
  releases,
  page,
}) => {
  await page.goto(releases.url);
  const html = page.locator("html");
  const timer = page.locator("main");
  const update = page.locator('[data-part="update"]');
  const marker = page.locator('meta[name="offline-test-release"]');
  await expect(html).toHaveAttribute("data-offline", "ready");
  await inspectionOff(page);
  await expect(page.locator('[data-part="scramble"]')).toHaveAttribute(
    "data-ready",
    "true",
  );

  await page.keyboard.down("Space");
  await expect(timer).toHaveAttribute("data-phase", "ready");
  await page.keyboard.up("Space");
  await expect(timer).toHaveAttribute("data-phase", "running");

  const navigations: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });
  releases.publish();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(html).toHaveAttribute("data-offline", "update-waiting");
  await expect(update).toHaveCount(0);
  await expect(timer).toHaveAttribute("data-phase", "running");
  expect(navigations).toEqual([]);

  await page.waitForTimeout(100);
  await page.keyboard.down("Space");
  await expect(timer).toHaveAttribute("data-phase", "stopped");
  await expect(update).toHaveCount(0);
  await page.keyboard.up("Space");
  await expect(update).toContainText("A new version is ready.");
  await expect(marker).toHaveCount(0);

  await update.getByRole("button", { name: "Update" }).click();
  await expect(marker).toHaveAttribute("content", "2");
  await expect(html).toHaveAttribute("data-offline", "ready");
  await expect(page.locator('[data-part="solve-time"]')).toHaveCount(1);
  expect(navigations).toEqual([releases.url]);
});
