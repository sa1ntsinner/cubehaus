import { expect, type Page, test } from "@playwright/test";
import { test as stored } from "./fixtures";
import { sessionButton } from "./helpers";

const scrambleSelector = 'main > [data-part="scramble"]';
const solveListSelector = '[data-part="solves"]';
const mobile = { hasTouch: true, isMobile: true };
const desktop = { width: 1440, height: 900 };
const events = ["333", "333bf", "pyram", "fto", "sq1", "444bf", "555bf", "666"];
const scrambleTimeout = 15_000;

for (const { name, viewport, touch } of [
  {
    name: "phone 390×844",
    viewport: { width: 390, height: 844 },
    touch: mobile,
  },
  { name: "desktop 1440×900", viewport: desktop, touch: {} },
]) {
  test.describe(name, () => {
    test.describe.configure({ mode: "default", timeout: 120_000 });
    // The scramble's line breaks are the font's: WebKit's own check is the phone.
    test.skip(
      ({ browserName }) => browserName === "webkit" && !("hasTouch" in touch),
      "WebKit checks the phone",
    );
    let page: Page;

    // Seeded states use an in-memory database, including on WebKit.
    test.beforeAll(async ({ browser }, testInfo) => {
      const { baseURL } = testInfo.project.use;
      if (!baseURL) throw new Error("The layout tests require a base URL");
      page = await browser.newPage({
        baseURL,
        viewport,
        ...touch,
      });
    });

    test.afterAll(async () => {
      await page?.close();
    });

    for (const event of events) {
      test(`${event} scramble stays at its reserved height`, async () => {
        await page.goto(`/?state=event-${event}`);
        const scramble = page.locator(scrambleSelector);
        await expect(scramble.locator("[data-move]").first()).toBeVisible({
          timeout: scrambleTimeout,
        });
        await expect(scramble).toHaveAttribute("data-event", event);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));

        for (let sample = 1; sample <= 3; sample++) {
          const { height, minHeight, previousText } = await scramble.evaluate(
            (element) => ({
              height: element.getBoundingClientRect().height,
              minHeight: getComputedStyle(element).minHeight,
              previousText: element.textContent,
            }),
          );
          expect(
            Math.abs(height - Number.parseFloat(minHeight)),
            `Scramble ${sample} measured ${height}px with min-height ${minHeight}`,
          ).toBeLessThanOrEqual(1);

          await page.keyboard.press("ArrowRight");
          await expect
            .poll(
              () =>
                scramble.evaluate(
                  (element, previous) =>
                    element.dataset.ready === "true" &&
                    element.textContent !== previous,
                  previousText,
                ),
              {
                message: "Wait for a different scramble",
                timeout: scrambleTimeout,
              },
            )
            .toBe(true);
        }
      });
    }
  });
}

// + and − resize the part under the pointer; Settings does the same; the
// sizes are kept per device.
stored.describe("sizes", () => {
  stored.use({ viewport: desktop });

  stored(
    "the scramble and the time resize by key and by setting and stay after a reload",
    async ({ page }) => {
      await page.goto("/");
      await expect(sessionButton(page)).toBeEnabled();
      const scramble = page.locator(scrambleSelector);
      await expect(scramble).toHaveAttribute("data-ready", "true", {
        timeout: scrambleTimeout,
      });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const fontSize = async () =>
        Number.parseFloat(
          await scramble.evaluate(
            (element) => getComputedStyle(element).fontSize,
          ),
        );
      const before = await fontSize();
      await scramble.hover();
      await page.keyboard.press("Shift+Equal");
      await page.keyboard.press("Equal");
      await expect(scramble).toHaveAttribute("data-size", "120");
      await expect(page.locator('[data-part="notice"]')).toHaveText(
        "Scramble 120 %",
      );
      await expect(page.locator('[data-size-part="picture"]')).toHaveAttribute(
        "data-size",
        "100",
      );
      expect(await fontSize()).toBeGreaterThan(before * 1.1);

      await page.goto("/#/settings/look");
      await page.locator('[data-size-control="time"]').selectOption("130");
      await expect(page.locator('[data-action="reset-sizes"]')).toBeVisible();
      await page.goto("/#/");
      await expect(page.locator('output[data-part="time"]')).toHaveAttribute(
        "data-size",
        "130",
      );

      await page.reload();
      await expect(scramble).toHaveAttribute("data-size", "120");
      await expect(page.locator('output[data-part="time"]')).toHaveAttribute(
        "data-size",
        "130",
      );
      await page.goto("/#/settings/look");
      await page.locator('[data-action="reset-sizes"]').click();
      await page.goto("/#/");
      await expect(scramble).toHaveAttribute("data-size", "100");
    },
  );

  stored(
    "a larger list still scrolls to the first of 100,000 solves",
    async ({ page, browserName }) => {
      stored.skip(
        browserName !== "chromium",
        "The 100k fixture runs in Chromium",
      );
      stored.setTimeout(120_000);
      await page.goto("/?seed=100000");
      const list = page.locator(solveListSelector);
      await expect(list.locator('[data-part="solve-no"]').first()).toHaveText(
        "100000",
        { timeout: 60_000 },
      );
      const rowHeight = () =>
        list
          .locator("li[data-solve-id]")
          .first()
          .evaluate((row) => row.getBoundingClientRect().height);
      const small = await rowHeight();
      await list.hover();
      for (let step = 0; step < 6; step++) await page.keyboard.press("Equal");
      await expect(page.locator('[data-part="file"]')).toHaveAttribute(
        "data-size",
        "150",
      );
      await expect.poll(rowHeight).toBeGreaterThan(small * 1.3);

      // Scroll to the oldest line: it shows, and only the lines near the view are built.
      await expect
        .poll(
          async () => {
            await list.evaluate((element) => {
              element.scrollTop = -element.scrollHeight;
            });
            return list
              .locator('[data-part="solve-no"]', { hasText: /^1$/ })
              .count();
          },
          { timeout: 30_000 },
        )
        .toBe(1);
      const built = await list.locator("li[data-solve-id]").count();
      const lines = await list.evaluate(
        (element, height) => Math.ceil(element.clientHeight / height),
        await rowHeight(),
      );
      expect(built).toBeLessThanOrEqual(lines + 24 + 2);

      // Nothing in the larger list is cut off at the window's edge.
      const width = page.viewportSize()?.width ?? 0;
      for (const control of await page
        .locator('[data-part="file"] button:visible')
        .all()) {
        const box = await control.boundingBox();
        if (!box) continue;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
    },
  );
});

// Every size from 70 to 150 % on the narrow phones: nothing overlaps, nothing is cut, and the
// actions and the status line stay on the screen. Each part takes either end of the scale, so
// the 32 combinations hold every extreme a person can reach (the steps between change
// sizes monotonically).
test.describe("sizes on a phone", () => {
  test.describe.configure({ timeout: 240_000 });
  const parts = ["scramble", "picture", "time", "averages", "times"] as const;
  const combinations = Array.from({ length: 2 ** parts.length }, (_, mask) =>
    parts.map((_, bit) => ((mask >> bit) & 1 ? 150 : 70)),
  );

  // The smallest phone, and a common Android size whose height lets the file show; WebKit
  // takes the smallest only. 360×640 and 390×844 fall between the two.
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 360, height: 800 },
  ]) {
    test(`${viewport.width}×${viewport.height} fits every combination of extremes`, async ({
      browser,
      browserName,
    }, testInfo) => {
      test.skip(
        browserName === "webkit" && viewport.width !== 320,
        "WebKit checks the smallest phone",
      );
      const { baseURL } = testInfo.project.use;
      if (!baseURL) throw new Error("The layout tests require a base URL");
      const page = await browser.newPage({
        baseURL,
        viewport,
        ...mobile,
      });
      const problems: string[] = [];
      for (const lang of ["ru", "en"]) {
        for (const sizes of combinations) {
          await page.goto(
            `/?state=sizes-large&lang=${lang}&sizes=${sizes.join(",")}`,
          );
          await expect(page.locator(scrambleSelector)).toHaveAttribute(
            "data-ready",
            "true",
            { timeout: scrambleTimeout },
          );
          await expect(
            page.locator('main > [data-part="file"]'),
          ).toHaveAttribute("data-size", String(sizes[4]));
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          // The file fits itself to its room after a frame.
          await page.evaluate(
            () =>
              new Promise((done) =>
                requestAnimationFrame(() => requestAnimationFrame(done)),
              ),
          );
          const found = await page.evaluate(() => {
            const out: string[] = [];
            const width = window.innerWidth;
            const height = window.innerHeight;
            const shown = (element: Element | null): element is HTMLElement => {
              if (!(element instanceof HTMLElement)) return false;
              for (
                let at: Element | null = element;
                at;
                at = at.parentElement
              ) {
                const style = getComputedStyle(at);
                if (
                  style.display === "none" ||
                  (at.matches('[data-part="last-actions"]') &&
                    style.clipPath !== "none") ||
                  style.visibility === "hidden" ||
                  style.opacity === "0"
                )
                  return false;
              }
              const box = element.getBoundingClientRect();
              return box.width > 0 && box.height > 0;
            };
            const box = (element: Element) => element.getBoundingClientRect();
            const q = (selector: string) => document.querySelector(selector);
            const all = (selector: string) =>
              [...document.querySelectorAll(selector)].filter(shown);

            if (document.documentElement.scrollWidth > width)
              out.push(
                `the page scrolls sideways (${document.documentElement.scrollWidth})`,
              );

            // Every word on the screen and in the actions stays whole on the screen.
            for (const selector of [
              'main > [data-part="scramble"] [data-move]',
              'main > output[data-part="time"]',
              '[data-part="stats-now"] [data-slot]',
              'main > [data-part="last-actions"] button',
              'footer[data-part="status-line"] button',
            ])
              for (const element of all(selector)) {
                const rect = box(element);
                if (
                  rect.left < -0.5 ||
                  rect.right > width + 0.5 ||
                  rect.top < -0.5 ||
                  rect.bottom > height + 0.5
                )
                  out.push(
                    `${selector} leaves the screen (${Math.round(rect.top)}–${Math.round(rect.bottom)}, ${Math.round(rect.left)}–${Math.round(rect.right)})`,
                  );
              }
            const actions = all('main > [data-part="last-actions"] button');
            for (const button of actions)
              if (box(button).height < 44)
                out.push(`${button.textContent} is under 44 px tall`);
            if (
              all(
                'footer[data-part="status-line"] [data-action="session-switch"]',
              ).length === 0
            )
              out.push("no session name in the status line");

            // The parts follow one another down the screen without touching.
            const order = [
              q('main > output[data-part="time"]'),
              ...all('[data-part="stats-now"] [data-slot]'),
              q('main > [data-part="scramble-picture"]'),
              q('main > [data-part="scramble"]'),
            ].filter(shown);
            const slotsBottom = Math.max(
              ...all('[data-part="stats-now"] [data-slot]').map(
                (slot) => box(slot).bottom,
              ),
            );
            for (let index = 1; index < order.length; index++) {
              const above = order[index - 1] as HTMLElement;
              const below = order[index] as HTMLElement;
              if (below.matches("[data-slot]") && above.matches("[data-slot]"))
                continue;
              if (box(below).top < box(above).bottom - 0.5)
                out.push(
                  `${below.dataset.part ?? below.dataset.slot} runs into ${above.dataset.part ?? above.dataset.slot} by ${(box(above).bottom - box(below).top).toFixed(1)} px`,
                );
            }
            const file = q('main > [data-part="file"]');
            const status = q('footer[data-part="status-line"]');
            const controlsTop = Math.min(
              ...actions.map((button) => box(button).top),
              status ? box(status).top : Number.POSITIVE_INFINITY,
            );
            if (shown(file)) {
              const fileBox = box(file);
              if (fileBox.top < slotsBottom - 0.5)
                out.push(
                  `the file runs into the averages by ${(slotsBottom - fileBox.top).toFixed(1)} px`,
                );
              // The newest line, when the list shows, is whole inside it.
              const list = q('[data-part="solves"]');
              if (shown(list)) {
                const listBox = box(list);
                const newest = list.querySelector('li[aria-posinset="1"]');
                if (newest) {
                  const rect = box(newest);
                  if (
                    rect.top < listBox.top - 0.5 ||
                    rect.bottom > listBox.bottom + 0.5
                  )
                    out.push(
                      `the newest line is cut (${Math.round(rect.top)}–${Math.round(rect.bottom)} in ${Math.round(listBox.top)}–${Math.round(listBox.bottom)})`,
                    );
                }
              }
              for (const total of all('[data-part="stats-totals"] > div')) {
                const rect = box(total);
                if (
                  rect.top < fileBox.top - 0.5 ||
                  rect.bottom > fileBox.bottom + 0.5
                )
                  out.push(
                    `a total leaves the file (${Math.round(rect.top)}–${Math.round(rect.bottom)} in ${Math.round(fileBox.top)}–${Math.round(fileBox.bottom)})`,
                  );
              }
              if (fileBox.bottom > controlsTop + 0.5)
                out.push(
                  `the file runs into the footer controls by ${(fileBox.bottom - controlsTop).toFixed(1)} px`,
                );
            } else if (slotsBottom > controlsTop + 0.5)
              out.push("the averages run into the footer controls");
            return out;
          });
          for (const problem of found)
            problems.push(`${lang} sizes ${sizes.join(",")}: ${problem}`);
        }
      }
      await page.close();
      expect(problems, problems.slice(0, 40).join("\n")).toEqual([]);
    });
  }
});

// No text is drawn under 11 px, whatever the sizes: at 70 % the small words (line numbers,
// stat names, totals, notes) stop at the floor.
test.describe("smallest sizes on a phone", () => {
  test.describe.configure({ timeout: 180_000 });
  // A computed font size: the same in every engine.
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "one engine is enough",
  );
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    test(`${viewport.width}×${viewport.height} draws no text under 11 px at 70 %`, async ({
      browser,
    }, testInfo) => {
      const { baseURL } = testInfo.project.use;
      if (!baseURL) throw new Error("The layout tests require a base URL");
      const page = await browser.newPage({ baseURL, viewport, ...mobile });
      const problems: string[] = [];
      for (const state of [
        "sizes-small",
        "stopped-dnf",
        "stopped-plus2",
        "browsing",
        "comment",
        "repeat",
        "selection",
        "today",
        "layout-times",
        "empty",
        "event-333mbf",
        "event-777",
        "mbld",
      ]) {
        for (const lang of ["en", "ru"]) {
          await page.goto(`/?state=${state}&lang=${lang}&sizes=70,70,70,70,70`);
          await expect(page.locator(scrambleSelector)).toHaveAttribute(
            "data-ready",
            "true",
            { timeout: scrambleTimeout },
          );
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          const small = await page.evaluate(() => {
            const out: string[] = [];
            const walker = document.createTreeWalker(
              document.body,
              NodeFilter.SHOW_TEXT,
            );
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              if (!node.textContent?.trim()) continue;
              const element = node.parentElement;
              if (!element || element.closest("[hidden], [aria-hidden='true']"))
                continue;
              const range = document.createRange();
              range.selectNodeContents(node);
              const rect = range.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) continue;
              let seen = true;
              for (
                let at: Element | null = element;
                at;
                at = at.parentElement
              ) {
                const style = getComputedStyle(at);
                if (
                  style.display === "none" ||
                  style.visibility === "hidden" ||
                  style.opacity === "0"
                )
                  seen = false;
              }
              if (!seen) continue;
              const size = Number.parseFloat(
                getComputedStyle(element).fontSize,
              );
              if (size < 10.95)
                out.push(
                  `${element.dataset.part ?? element.tagName.toLowerCase()} “${node.textContent.trim().slice(0, 16)}” ${size.toFixed(1)} px`,
                );
            }
            return out;
          });
          for (const line of small) problems.push(`${state} ${lang}: ${line}`);
        }
      }
      await page.close();
      expect(problems, problems.slice(0, 40).join("\n")).toEqual([]);
    });
  }
});

test.describe("touch phone timer controls", () => {
  test.use({ ...mobile, viewport: { width: 393, height: 852 } });

  test("keeps two scramble lines clear of the timer and navigation", async ({
    page,
  }) => {
    const fixture = new URLSearchParams({
      state: "event-333",
      lang: "en",
      "test-scramble": "R U2 F' D R2 B U' L F2 D' R B' L2 U F' R2 D2 B2 L U'",
    });
    await page.goto(`/?${fixture}`);
    const scramble = page.locator(scrambleSelector);
    await expect(scramble.locator("[data-move]").first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    test.skip(
      !(await page.evaluate(
        () => matchMedia("(hover: none) and (pointer: coarse)").matches,
      )),
      "this browser does not report a touch screen",
    );
    const lines = await scramble
      .locator("[data-move]")
      .evaluateAll((moves) =>
        Array.from(
          new Set(moves.map((move) => move.getBoundingClientRect().top)),
          (top) =>
            moves.filter((move) => move.getBoundingClientRect().top === top)
              .length,
        ),
      );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(10);
    const time = await page.locator('output[data-part="time"]').boundingBox();
    const moves = await scramble.boundingBox();
    if (!time || !moves) throw new Error("Timer or scramble has no box");
    expect(time.y + time.height).toBeLessThan(moves.y);
    for (const name of ["Algorithms", "Progress", "Settings"]) {
      const link = page.getByRole("link", { name, exact: true });
      await expect(link.locator("svg")).toBeVisible();
      const box = await link.boundingBox();
      if (!box) throw new Error("Phone action has no box");
      expect(box.width).toBe(44);
      expect(box.height).toBe(44);
      for (const other of [time, moves])
        expect(
          box.x + box.width <= other.x ||
            other.x + other.width <= box.x ||
            box.y + box.height <= other.y ||
            other.y + other.height <= box.y,
        ).toBe(true);
    }
  });
});
