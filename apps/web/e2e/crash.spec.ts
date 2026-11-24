import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { keyboardSolve, sessionButton } from "./helpers";

// A browser killed while it writes: the whole process dies at once, as when a phone's
// browser is closed from the app switcher or runs out of memory. The history must open
// cleanly afterwards with every write whole or absent. A persistent profile keeps the
// origin's storage across the kill; the browser is started again on it.
test.skip(({ browserName }) => browserName !== "chromium", "CDP crash");

const launch = (profile: string, baseURL?: string) =>
  chromium.launchPersistentContext(profile, {
    ...(baseURL ? { baseURL } : {}),
    args: ["--use-angle=metal"],
    acceptDownloads: true,
  });

async function crash(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Browser.crash").catch(() => {});
  await page
    .context()
    .close()
    .catch(() => {});
}

/** The browser started again on the profile, the history open and sound. */
async function reopen(context: BrowserContext) {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled({ timeout: 15_000 });
  // An integrity failure would put the failure line here.
  await expect(page.locator('[data-part="db-state"]')).toHaveCount(0);
  return page;
}

/** The history's rows, read from its own backup. */
async function tables(page: Page) {
  await page.goto("/#/settings/data");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('[data-action="backup-save"]').click(),
  ]);
  const backup = JSON.parse(
    await readFile((await download.path()) as string, "utf8"),
  );
  return backup.tables as Record<string, Record<string, unknown>[]>;
}

let profile = "";
test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "cubehaus-crash-"));
});
test.afterEach(async () => {
  await rm(profile, { recursive: true, force: true });
});

test("a solve saved as the browser dies is there once afterwards", async ({
  baseURL,
}) => {
  const page = (await launch(profile, baseURL)).pages()[0] as Page;
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await keyboardSolve(page);
  await crash(page);
  const context = await launch(profile, baseURL);
  const after = await reopen(context);
  await expect(
    after.locator('[data-part="solves"] [data-solve-id]'),
  ).toHaveCount(1);
  expect((await tables(after)).solve).toHaveLength(1);
  await context.close();
});

// Made-up history: three sessions of 2000 solves each.
const big = (() => {
  const file: Record<string, unknown> = {};
  const data: Record<string, unknown> = {};
  for (let s = 1; s <= 3; s++) {
    file[`session${s}`] = Array.from({ length: 2000 }, (_, i) => [
      [i % 50 === 0 ? 2000 : 0, 9000 + ((i * 37) % 6000)],
      "R U R' U'",
      i % 100 === 0 ? "made up" : "",
      1_700_000_000 + s * 10_000 + i,
    ]);
    data[s] = { name: `Crash ${s}`, scrType: "333" };
  }
  file.properties = { sessionData: JSON.stringify(data) };
  return Buffer.from(JSON.stringify(file));
})();

for (const wait of [0, 40, 120, 400]) {
  test(`an import cut ${wait} ms in lands whole or not at all`, async ({
    baseURL,
  }) => {
    const page = (await launch(profile, baseURL)).pages()[0] as Page;
    await page.goto("/");
    await expect(sessionButton(page)).toBeEnabled();
    await page.goto("/#/settings/data");
    const input = page.locator('[data-action="import-file"] input');
    await expect(input).toBeEnabled();
    await input.setInputFiles({
      name: "made-up.txt",
      mimeType: "text/plain",
      buffer: big,
    });
    const confirm = page.locator('[data-action="import-confirm"]');
    await expect(confirm).toHaveText(/^Import 6.?000 solves$/);
    await confirm.click();
    if (wait) await page.waitForTimeout(wait);
    await crash(page);
    const context = await launch(profile, baseURL);
    const rows = await tables(await reopen(context));
    await context.close();
    const solves = rows.solve?.length ?? 0;
    const names = (rows.session ?? []).map((s) => s.name).sort();
    // Whole, or nothing: never a session without its solves.
    if (solves === 0) expect(names).toEqual(["3×3"]);
    else {
      expect(solves).toBe(6000);
      expect(names).toEqual(["Crash 1", "Crash 2", "Crash 3"]);
    }
    test.info().annotations.push({
      type: "outcome",
      description: solves ? "landed" : "rolled back",
    });
  });
}
