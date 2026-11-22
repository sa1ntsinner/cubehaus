import { writeFile } from "node:fs/promises";
import { formatAverage, resultValue } from "@cubehaus/core";
import { statOf } from "@cubehaus/stats";
import {
  type BrowserContext,
  expect,
  type Page,
  type TestInfo,
  test,
} from "@playwright/test";
import { performanceSolve } from "../src/testing/performance-data";
import { keyboardSolve } from "./helpers";

const count = 100_000;
const listSelector = '[data-part="solves"]';
const rowSelector = `${listSelector} [data-solve-id]`;
const numberSelector = `${rowSelector} [data-part="solve-no"]`;
const slotSelector = '[data-part="stats-now"] [data-stat]';
const mark = (name: string) => `cubehaus:${name}`;

const budget = {
  timer: 1000,
  list: 1500,
  solve: 100,
  progress: 1000,
  max: 50,
  p95: 20,
};
type Metric = keyof typeof budget;

function busyLoop() {
  function sample() {
    let checksum = 1;
    const start = performance.now();
    for (let i = 0; i < 20_000_000; i++)
      checksum = Math.imul(checksum ^ i, 0x01000193);
    return { elapsed: performance.now() - start, checksum };
  }

  sample(); // Warm up the loop before collecting samples.
  const runs = Array.from({ length: 5 }, sample);
  runs.sort((a, b) => a.elapsed - b.elapsed);
  const median = runs[2];
  if (!median) throw new Error("Missing CPU probe sample");
  return median;
}

async function probeCPU(page: Page) {
  const database = page
    .workers()
    .find((worker) => /\/assets\/worker-[^/]+\.js$/.test(worker.url()));
  if (!database)
    throw new Error("Could not find the SQLite worker for the CPU probe");
  const main = await page.evaluate(busyLoop);
  const sqlite = await database.evaluate(busyLoop);
  return { main: main.elapsed, sqlite: sqlite.elapsed };
}

function expectedStats(firstWindow: number, added?: number) {
  const length = Math.max(12, firstWindow);
  const tail = Array.from({ length }, (_, i) =>
    resultValue(performanceSolve(count - length + i, "synthetic", 1)),
  );
  if (added !== undefined) tail.push(added);
  return [firstWindow, 12].map((n) =>
    formatAverage(statOf(tail, { kind: "ao", n })),
  );
}

function waitForMark(page: Page, name: string) {
  return page.waitForFunction(
    (name) => performance.getEntriesByName(name, "mark").length > 0,
    mark(name),
  );
}

async function scrollList(page: Page) {
  const list = page.locator(listSelector);
  const firstNumber = page.locator(numberSelector).first();
  await list.evaluate((element) => {
    element.scrollTop = -element.scrollHeight / 2;
  });
  const first = async () => Number(await firstNumber.textContent());
  await expect
    .poll(async () => Math.abs((await first()) - count / 2))
    .toBeLessThan(100);
  const before = await first();
  const elapsed = await list.evaluate(
    (element) =>
      new Promise<number[]>((resolve) => {
        const frames: number[] = [];
        const from = element.scrollTop;
        requestAnimationFrame((start) => {
          let previous = start;
          function frame(now: number) {
            frames.push(now - previous);
            previous = now;
            element.scrollTop = from - (now - start) * 1.5;
            if (now - start >= 5000) resolve(frames);
            else requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        });
      }),
  );
  await expect.poll(first).toBeLessThan(before - 100);
  expect(await page.locator(rowSelector).count()).toBeLessThan(200);
  await list.evaluate((element) => {
    element.scrollTop = -element.scrollHeight;
  });
  await expect(page.locator(numberSelector).last()).toHaveText("1");
  await list.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(firstNumber).toHaveText(String(count));
  return elapsed.sort((a, b) => a - b);
}

// The budgets in docs/performance.md are set for the reference machine (an M2 Max) and
// gate a release there. A shared CI runner is several times slower and varies run to
// run, so a CI failure would say nothing about the product.
test.skip(
  !!process.env.CI,
  "performance budgets are measured on the reference machine, not on CI runners",
);

for (const firstWindow of [5, 10_000]) {
  test(`100,000 solves with ao${firstWindow} stay within the timer, list, progress, and scrolling budgets`, ({
    page,
    context,
    browserName,
  }, testInfo) =>
    benchmark(firstWindow, { page, context, browserName }, testInfo));
}

async function benchmark(
  firstWindow: number,
  {
    page,
    context,
    browserName,
  }: {
    page: Page;
    context: BrowserContext;
    browserName: string;
  },
  testInfo: TestInfo,
) {
  test.skip(browserName !== "chromium", "CPU throttling uses Chromium CDP");
  test.setTimeout(120_000);
  await page.goto("/?seed=100000");
  await expect(page.locator(numberSelector).first()).toHaveText(String(count), {
    timeout: 60_000,
  });
  await expect(page.locator('[data-part="scramble"]')).toHaveAttribute(
    "data-ready",
    "true",
  );

  if (firstWindow > 5) {
    await page.locator('button[data-slot="ao5"]').click();
    const custom = page.locator('[data-part="custom-stat"] input');
    await custom.fill(String(firstWindow));
    await custom.press("Enter");
    await expect(
      page.locator(`button[data-slot="ao${firstWindow}"]`),
    ).toBeVisible();
  }

  await page.addInitScript(
    ({ count, numberSelector, slotSelector }) => {
      const marked = (name: string) =>
        performance.getEntriesByName(`cubehaus:${name}`, "mark").length > 0;
      function record(name: string, startTime?: number) {
        if (!marked(name))
          performance.mark(
            `cubehaus:${name}`,
            startTime === undefined ? undefined : { startTime },
          );
      }

      const key = (type: string, code: string) =>
        new KeyboardEvent(type, { code, bubbles: true, cancelable: true });
      function tryHold() {
        if (
          document.querySelector('[data-part="scramble"][data-ready="true"]') &&
          !window.dispatchEvent(key("keydown", "Space"))
        ) {
          record("timer-ready");
          window.dispatchEvent(key("keyup", "Space"));
          window.dispatchEvent(key("keydown", "Escape"));
        } else requestAnimationFrame(tryHold);
      }
      requestAnimationFrame(tryHold);

      window.addEventListener(
        "keyup",
        (event) => {
          if (
            event.code === "Space" &&
            document.querySelector('main[data-phase="ready"]')
          )
            record("solve-start", event.timeStamp);
        },
        true,
      );
      window.addEventListener(
        "keydown",
        (event) => {
          if (
            document.querySelector('main[data-phase="running"]') &&
            !event.repeat
          )
            record("solve-stop", event.timeStamp);
        },
        true,
      );
      window.addEventListener(
        "click",
        (event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('[data-action="progress"]')
          )
            record("progress-open", event.timeStamp);
        },
        true,
      );

      const observer = new MutationObserver(() => {
        const newest = document.querySelector(numberSelector)?.textContent;
        const slots = [...document.querySelectorAll(slotSelector)];
        if (slots.length === 2 && slots.every((slot) => slot.textContent)) {
          if (newest === String(count) && marked("db-open"))
            record("list-ready");
          if (newest === String(count + 1) && marked("solve-stop"))
            record("solve-shown");
        }
        if (
          marked("progress-open") &&
          document.querySelector('[data-part="progress-line"]') &&
          document.querySelector('[data-part="progress-pbs"] [data-name]')
        )
          record("progress-ready");
      });
      observer.observe(document, {
        attributes: true,
        childList: true,
        subtree: true,
        characterData: true,
      });
    },
    { count, numberSelector, slotSelector },
  );

  const cdp = await context.newCDPSession(page);
  const measurements: (Record<Metric, number> & { rate: number })[] = [];
  const profiles = [];
  for (const rate of [1, 4]) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    const beforeReload = await probeCPU(page);
    await page.reload({ waitUntil: "commit" });
    await waitForMark(page, "timer-ready");
    await waitForMark(page, "list-ready");
    await expect(page.locator(slotSelector)).toHaveText(
      expectedStats(firstWindow),
    );
    // Check whether the rate survived the reload without delaying startup.
    const afterReload = await probeCPU(page);

    const frames = await scrollList(page);

    await page.locator('[data-action="progress"]').click();
    await waitForMark(page, "progress-ready");
    await expect(page.locator('[data-part="progress-event"]')).toHaveCount(1);
    await expect(page.locator('[data-part="progress-event-count"]')).toHaveText(
      new Intl.NumberFormat("en-GB").format(count),
    );
    // The spread of 100,000 results stays a handful of bars.
    await page.locator('[data-part="progress-more"] summary').click();
    const bars = page.locator('[data-part="progress-distribution"] rect');
    await expect(bars.first()).toBeAttached();
    expect(await bars.count()).toBeLessThanOrEqual(40);
    await page.locator('main nav a[href="#/"]').click();
    await expect(page.locator(numberSelector).first()).toHaveText(
      String(count),
    );

    await keyboardSolve(page);
    await waitForMark(page, "solve-shown");
    const times = await page.evaluate(
      () =>
        Object.fromEntries(
          performance
            .getEntriesByType("mark")
            .filter(({ name }) => name.startsWith("cubehaus:"))
            .map(({ name, startTime }) => [
              name.slice("cubehaus:".length),
              startTime,
            ]),
        ) as Record<string, number>,
    );
    const at = (name: string) => {
      const value = times[name];
      if (value === undefined)
        throw new Error(`Missing performance mark ${mark(name)}`);
      return value;
    };
    await expect(page.locator(slotSelector)).toHaveText(
      expectedStats(
        firstWindow,
        Math.floor(at("solve-stop") - at("solve-start")),
      ),
    );
    measurements.push({
      rate,
      timer: at("timer-ready"),
      list: at("list-ready") - at("db-open"),
      solve: at("solve-shown") - at("solve-stop"),
      progress: at("progress-ready") - at("progress-open"),
      max: frames.at(-1) ?? Infinity,
      p95: frames[Math.ceil(frames.length * 0.95) - 1] ?? Infinity,
    });
    profiles.push({ rate, beforeReload, afterReload, marks: times, frames });

    if (rate === 1) {
      await page.locator('[data-action="solve-delete"]').click();
      await expect(page.locator(numberSelector).first()).toHaveText(
        String(count),
      );
    }
  }

  const labels = {
    timer: "Warm navigation to usable timer",
    list: "Database open to newest rows and stats",
    solve: "Stop to saved solve and updated stats",
    progress: "Open progress",
    max: "Scroll for 5 s — worst frame",
    p95: "Scroll for 5 s — 95th percentile",
  };
  const keys = Object.keys(budget) as Metric[];
  const [normal, slowed] = profiles;
  if (!normal || !slowed) throw new Error("Missing CPU probe results");
  const probes = [
    {
      label: "Main thread busy loop before reload",
      before: normal.beforeReload.main,
      after: slowed.beforeReload.main,
    },
    {
      label: "Main thread busy loop after reload",
      before: normal.afterReload.main,
      after: slowed.afterReload.main,
    },
    {
      label: "SQLite worker busy loop before reload",
      before: normal.beforeReload.sqlite,
      after: slowed.beforeReload.sqlite,
    },
    {
      label: "SQLite worker busy loop after reload",
      before: normal.afterReload.sqlite,
      after: slowed.afterReload.sqlite,
    },
  ];
  console.table([
    ...probes.map(({ label, before, after }) => ({
      measurement: label,
      "1× (ms)": before.toFixed(2),
      "1× limit": "—",
      "4× (ms)": after.toFixed(2),
      "4× limit": "—",
      "4× / 1×": (after / before).toFixed(2),
    })),
    ...keys.map((key) => ({
      measurement: labels[key],
      "1× (ms)": measurements[0]?.[key].toFixed(2),
      "1× limit": budget[key],
      "4× (ms)": measurements[1]?.[key].toFixed(2),
      "4× limit": 4 * budget[key],
    })),
  ]);
  const receipt = testInfo.outputPath("performance-marks-and-frames.json");
  await writeFile(receipt, JSON.stringify(profiles, null, 2));
  await testInfo.attach("performance-marks-and-frames", {
    path: receipt,
    contentType: "application/json",
  });
  // Chromium's CPU emulation reaches the page's main thread only: the SQLite and
  // scramble workers run at full speed in the 4× pass (measured 1.03–1.05× on
  // 2026-11-18). The worker probes stay in the table so the report says so; only
  // the main-thread probes must prove the rate took effect.
  for (const { label, before, after } of probes.filter(({ label }) =>
    label.startsWith("Main thread"),
  )) {
    const ratio = after / before;
    expect
      .soft(
        ratio >= 3 && ratio <= 5,
        `CPU throttle did not take effect for ${label}: expected 3×–5×, measured ${ratio.toFixed(2)}×`,
      )
      .toBe(true);
  }
  for (const measurement of measurements)
    for (const key of keys) {
      const limit = budget[key] * measurement.rate;
      const result = expect.soft(
        measurement[key],
        `${labels[key]} at ${measurement.rate}×`,
      );
      if (key === "p95") result.toBeLessThan(limit);
      else result.toBeLessThanOrEqual(limit);
    }
}

test("100,000 interleaved solves load cold and warm folder progress", async ({
  page,
  context,
  browserName,
}, testInfo) => {
  test.skip(browserName !== "chromium", "CPU throttling uses Chromium CDP");
  test.setTimeout(90_000);
  await page.goto("/?seed=100000&history=grouped#/progress");
  const sessions = page.locator('[data-part="progress-event"]');
  const chart = page.locator('[data-part="progress-line"]');
  const totals = page.locator('[data-part="progress-scope-count"]');
  const stat = page.locator('[data-part="progress-average"]');
  const scope = page.locator('[data-action="progress-scope"]');
  await expect(sessions).toHaveCount(50, { timeout: 60_000 });
  await expect(chart).toBeAttached();
  const cdp = await context.newCDPSession(page);

  async function measure() {
    await page.evaluate(() => {
      const select = document.querySelector('[data-action="progress-scope"]');
      if (!select) throw new Error("Missing scope selector");
      delete document.documentElement.dataset.folderReady;
      select.addEventListener(
        "change",
        () => {
          const start = performance.now();
          const observer = new MutationObserver(() => {
            if (
              document.querySelector('[data-part="progress-scope-count"]')
                ?.textContent === "100,000 solves" &&
              document.querySelector('[data-part="progress-line"]') &&
              document.querySelector('[data-part="progress-pbs"]') &&
              document.querySelector('[data-part="progress-practice"]')
            ) {
              document.documentElement.dataset.folderReady = String(
                performance.now() - start,
              );
              observer.disconnect();
            }
          });
          observer.observe(document.body, {
            attributes: true,
            childList: true,
            subtree: true,
          });
        },
        { once: true, capture: true },
      );
    });
    await scope.selectOption("folder");
    await expect(totals).toHaveText("100,000 solves");
    await expect(page.locator("html")).toHaveAttribute(
      "data-folder-ready",
      /\d/,
    );
    const ms = Number(
      await page.locator("html").getAttribute("data-folder-ready"),
    );
    const values = Float64Array.from({ length: 100 }, (_, index) =>
      resultValue(performanceSolve(count - 100 + index, "synthetic", 1)),
    );
    await expect(stat).toHaveText(
      formatAverage(statOf(values, { kind: "ao", n: 100 })),
    );
    const path = await chart.getAttribute("d");
    expect(path?.match(/[ML]/g)?.length ?? Infinity).toBeLessThan(2000);
    return ms;
  }

  const timings: { rate: number; cold: number; warm: number }[] = [];
  for (const rate of [1, 4]) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    await page.reload();
    await expect(sessions).toHaveCount(50);
    await expect(chart).toBeAttached();
    await page.locator('[data-part="progress-scope"] summary').click();
    const cold = await measure();
    await scope.selectOption("session");
    await expect(totals).toHaveCount(0);
    await expect(chart).toBeAttached();
    const warm = await measure();
    timings.push({ rate, cold, warm });
    expect(cold).toBeLessThan(budget.progress * rate);
    expect(warm).toBeLessThan(budget.progress * rate);
  }
  console.table(timings);
  const receipt = testInfo.outputPath("folder-progress.json");
  await writeFile(receipt, JSON.stringify(timings, null, 2));
  await testInfo.attach("folder-progress", {
    path: receipt,
    contentType: "application/json",
  });
});
