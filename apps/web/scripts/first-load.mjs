// Measures the production build's first load: the bytes a cold visit fetches before the
// first scramble shows, and the time to that scramble on a cold load and on a repeat load
// (served by the service worker), without and with a 4x CPU throttle.
//
//   pnpm exec vite build --outDir /tmp/cubehaus-pages --emptyOutDir
//   pnpm exec vite preview --outDir /tmp/cubehaus-pages --port 4174 --strictPort &
//   node scripts/first-load.mjs [url] [runs]
//
// Times are from navigation start to the first frame with a move of the scramble in the
// DOM, read in the page (performance.now()), median of the runs.
import { chromium } from "@playwright/test";

const url = process.argv[2] ?? "http://127.0.0.1:4174/";
const runs = Number(process.argv[3] ?? 5);

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

// The first frame with a scramble in the DOM, and the first with it set in its own face
// (Geist Mono loaded, not the fallback).
async function scrambleAt(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        let shown = null;
        const check = () => {
          const now = performance.now();
          if (
            shown === null &&
            document.querySelector('[data-part="scramble"] [data-move]')
          )
            shown = now;
          if (shown !== null && document.fonts.check('500 16px "Geist Mono"'))
            resolve({ shown, face: now });
          else requestAnimationFrame(check);
        };
        check();
      }),
  );
}

async function visit(browser, throttle) {
  const context = await browser.newContext({ serviceWorkers: "allow" });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (throttle > 1)
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  // Every request of the visit, the workers' included, until the scramble shows: what
  // came over the wire (compressed bodies and headers).
  let counting = true;
  const pending = [];
  const sizes = [];
  context.on("requestfinished", (request) => {
    if (!counting) return;
    pending.push(
      request.sizes().then(
        (s) => {
          sizes.push({
            url: request.url(),
            type: request.resourceType(),
            bytes: s.responseBodySize + s.responseHeadersSize,
          });
        },
        () => {},
      ),
    );
  });
  await page.goto(url, { waitUntil: "commit" });
  const cold = await scrambleAt(page);
  counting = false;
  await Promise.all(pending);
  const byType = {};
  let total = 0;
  for (const { type, bytes } of sizes) {
    byType[type] = (byType[type] ?? 0) + bytes;
    total += bytes;
  }
  // The service worker takes control; the repeat load is served by it.
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker?.ready;
    if (reg && !navigator.serviceWorker.controller)
      await new Promise((r) =>
        navigator.serviceWorker.addEventListener("controllerchange", r, {
          once: true,
        }),
      );
  });
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: "commit" });
  const repeat = await scrambleAt(page);
  const controlled = await page.evaluate(
    () => !!navigator.serviceWorker?.controller,
  );
  await context.close();
  return { cold, repeat, total, byType, resources: sizes, controlled };
}

const browser = await chromium.launch({ args: ["--use-angle=metal"] });
for (const throttle of [1, 4]) {
  const results = [];
  for (let i = 0; i < runs; i++) results.push(await visit(browser, throttle));
  const last = results.at(-1);
  console.log(
    JSON.stringify({
      throttle,
      runs,
      coldMs: Math.round(median(results.map((r) => r.cold.shown))),
      coldFaceMs: Math.round(median(results.map((r) => r.cold.face))),
      repeatMs: Math.round(median(results.map((r) => r.repeat.shown))),
      repeatFaceMs: Math.round(median(results.map((r) => r.repeat.face))),
      firstLoadKB: Math.round(median(results.map((r) => r.total)) / 1024),
      byTypeKB: Object.fromEntries(
        Object.entries(last.byType).map(([k, v]) => [k, Math.round(v / 1024)]),
      ),
      repeatControlled: last.controlled,
    }),
  );
  if (throttle === 1 && process.env.LIST === "1")
    for (const r of last.resources
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 15))
      console.log(`  ${Math.round(r.bytes / 1024)} KB  ${r.url}`);
}
await browser.close();
