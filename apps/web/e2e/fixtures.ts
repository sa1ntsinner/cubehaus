import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, test as base, webkit } from "@playwright/test";

// WebKit keeps an origin's file system outside the profile directory, so it
// outlives the profile. Empty it from a blank page of the same origin before
// the app opens its database.
async function clearOriginStorage(context: BrowserContext, baseURL?: string) {
  const page = await context.newPage();
  const url = new URL("/__blank", baseURL).href;
  await page.route(url, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
  );
  await page.goto(url);
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    for await (const name of (
      root as unknown as { keys(): AsyncIterable<string> }
    ).keys()) {
      await root.removeEntry(name, { recursive: true });
    }
    localStorage.clear();
  });
  await page.close();
}

// Playwright's WebKit gives ephemeral contexts no origin-private file system
// (getDirectory rejects with UnknownError), while Safari itself has one. A
// persistent profile per test makes WebKit exercise the real storage path.
export const test = base.extend<{ welcome: boolean }>({
  // The first-run pictures cover a touch screen's timer; a spec about them turns this on.
  welcome: [false, { option: true }],
  context: async (
    { browserName, browser, baseURL, hasTouch, welcome },
    use,
    testInfo,
  ) => {
    const options = { ...(baseURL ? { baseURL } : {}), hasTouch };
    // The profile path is ASCII only: test titles carry "§" and "×", and WebKit's
    // launcher on Linux rejects a non-UTF-8-decodable argument under the C locale
    // ("Cannot parse arguments: Invalid byte sequence in conversion input").
    const profile = join(
      tmpdir(),
      `cubehaus-webkit-${testInfo.testId}-${testInfo.retry}`,
    );
    const context =
      browserName === "webkit"
        ? await webkit.launchPersistentContext(profile, options)
        : await browser.newContext(options);
    if (browserName === "webkit") await clearOriginStorage(context, baseURL);
    if (!welcome)
      await context.addInitScript(() => {
        try {
          localStorage.setItem("cubehaus.welcome", "seen");
        } catch {}
      });
    await use(context);
    await context.close();
    if (browserName === "webkit")
      await rm(profile, { recursive: true, force: true });
  },
  page: async ({ context }, use) => {
    await use(context.pages()[0] ?? (await context.newPage()));
  },
});

export { expect } from "@playwright/test";
