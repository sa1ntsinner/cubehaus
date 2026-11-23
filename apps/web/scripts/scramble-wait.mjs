// Measures how long a person waits for a scramble, per event, in the built app.
//
//   VITE_TEST_HOOKS=1 pnpm build && pnpm preview   (in another shell)
//   node scripts/scramble-wait.mjs [events…]
//
// cold: from the click that opens a new session of the event to its first scramble.
// warm: from the key press that stops a solve to the next scramble on screen (Fewest
// Moves and Multi-Blind take no timed solve here: → asks for the next scramble, which
// is the same request a saved result makes). Five warm samples per event, the first
// taken right after the cold one, the rest after a 1.5 s pause, as between solves.
// Then the page is reloaded (the wait for its first scramble) and, once idle, each
// session is opened from the switch (the wait for its scramble).
import { chromium } from "@playwright/test";

const ALL = [
  "333",
  "222",
  "444",
  "555",
  "666",
  "777",
  "333bf",
  "333fm",
  "333oh",
  "clock",
  "minx",
  "pyram",
  "skewb",
  "sq1",
  "444bf",
  "555bf",
  "333mbf",
  "fto",
];
const events = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const base = process.env.BASE ?? "http://127.0.0.1:4173";

const browser = await chromium.launch({ args: ["--use-angle=metal"] });
const page = await browser.newPage();
await page.goto(base);
await page.evaluate(() => (window.__t0 = 0));

// Resolves, in the page, with the ms from `t0` until the scramble differs from `before`.
const waitFor = (before) =>
  page.evaluate(
    (before) =>
      new Promise((resolve) => {
        const t0 = window.__t0;
        const tick = () => {
          const el = document.querySelector('[data-part="scramble"]');
          if (
            el?.getAttribute("data-ready") === "true" &&
            el.textContent !== before
          )
            resolve(performance.now() - t0);
          else requestAnimationFrame(tick);
        };
        tick();
      }),
    before,
  );
const mark = () => page.evaluate(() => (window.__t0 = performance.now()));
const text = () => page.locator('[data-part="scramble"]').textContent();
const main = page.locator("main");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const rows = [];
// 3×3 has the first session: its cold wait is from the page's start.
const firstLoad = await waitFor(null);
for (const id of events) {
  let cold = firstLoad;
  if (id !== "333") {
    await page.locator('[data-action="session-switch"]').click();
    const row = page.locator(
      `[data-part="switch-list"] > li[data-row="event"][data-id="${id}"] [data-action="switch-pick"]`,
    );
    const before = await text();
    await row.evaluate((el) => {
      window.__t0 = performance.now();
      el.click();
    });
    cold = await waitFor(before);
  }
  const timed = !["333fm", "333mbf"].includes(id);
  await page.waitForSelector('[data-action="session-switch"]:enabled');
  await page.evaluate(() => document.activeElement?.blur());
  if (timed && (await main.getAttribute("data-inspection")) !== "off") {
    await pause(250);
    await page.keyboard.press("KeyI");
    await page.waitForSelector('main[data-inspection="off"]', {
      state: "attached",
    });
  }
  const warm = [];
  for (let i = 0; i < 5; i++) {
    if (i > 0) await pause(1500);
    const shown = await text();
    if (timed) {
      await page.keyboard.down("Space");
      await page.waitForSelector('main[data-phase="ready"]', {
        state: "attached",
      });
      await page.keyboard.up("Space");
      await page.waitForSelector('main[data-phase="running"]', {
        state: "attached",
      });
      await pause(100);
      await mark();
      await page.keyboard.down("Space");
      await page.keyboard.up("Space");
    } else {
      await pause(250);
      await mark();
      await page.keyboard.press("ArrowRight");
    }
    warm.push(await waitFor(shown));
  }
  const fmt = (n) => n.toFixed(0).padStart(6);
  const line = `${id.padEnd(7)} cold ${fmt(cold)}  warm ${warm.map(fmt).join("")}  max ${fmt(Math.max(...warm))}`;
  console.log(line);
  rows.push({ id, cold, warm });
}

// Then as a person comes back: the page opened again (the scramble on show from the
// page before, or made fresh), and once it is idle, each session opened from the switch.
// Reloaded on the slowest puzzle there is: 4×4 when it was measured.
const last = events.includes("444") ? "444" : events.at(-1);
await page.locator('[data-action="session-switch"]').click();
await page
  .locator(
    `[data-part="switch-list"] > li[data-row="session"][data-event="${last}"] [data-action="switch-pick"]`,
  )
  .first()
  .click();
await page.waitForSelector('[data-part="scramble"][data-ready="true"]');
await pause(3000);
await page.reload();
await page.evaluate(() => (window.__t0 = 0));
console.log(
  `reload  ${last.padEnd(7)} ${(await waitFor(null)).toFixed(0).padStart(6)}`,
);
await pause(5000);
const switched = [];
for (const id of events) {
  await page.locator('[data-action="session-switch"]').click();
  const row = page.locator(
    `[data-part="switch-list"] > li[data-row="session"][data-event="${id}"] [data-action="switch-pick"]`,
  );
  const before = await text();
  await row.first().evaluate((el) => {
    window.__t0 = performance.now();
    el.click();
  });
  switched.push(`${id} ${(await waitFor(before)).toFixed(0)}`);
}
console.log(`switch  ${switched.join("  ")}`);
await browser.close();
