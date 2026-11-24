import { expect, test } from "./fixtures";
import { sessionButton, switchSession } from "./helpers";

test("progress compares stored solves and shows DNF-only days", async ({
  page,
}) => {
  await page.goto("/");
  const dates = await page.evaluate(() => ({
    now: new Date(2026, 3, 1, 9).getTime(),
    baseline: new Date(2026, 2, 2, 18).getTime() / 1000,
    improved: new Date(2026, 2, 3, 18).getTime() / 1000,
    dnf: new Date(2026, 2, 4, 18).getTime() / 1000,
  }));
  await page.clock.setFixedTime(dates.now);

  await expect(sessionButton(page)).toBeEnabled();
  await page.goto("/#/settings/data");
  const input = page.locator('[data-action="import-file"] input');
  await expect(input).toBeEnabled();
  await input.setInputFiles({
    name: "progress.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        session1: [
          ...Array.from({ length: 12 }, (_, i) => [
            [0, 12000],
            "R U",
            "",
            dates.baseline + i,
          ]),
          ...Array.from({ length: 4 }, (_, i) => [
            [0, 6000],
            "R U",
            "",
            dates.improved + i,
          ]),
        ],
        session2: [[[-1, 15000], "R U", "", dates.dnf]],
        properties: {
          sessionData: {
            1: { name: "Practice", scrType: "333" },
            2: { name: "DNF practice", scrType: "222so" },
          },
        },
      }),
    ),
  });
  await page.locator('[data-action="import-confirm"]').click();
  await expect(page.locator('[data-part="data-result"]')).toHaveText(
    "Added 17 solves.",
  );
  await page.goto("/#/");
  await switchSession(page, "Practice");
  const solves = page.locator('[data-part="solves"] [data-solve-id]');
  await expect(solves).toHaveCount(16);
  await page.locator('[data-action="progress"]').click();

  const part = (name: string) => page.locator(`[data-part="progress-${name}"]`);
  await expect(page).toHaveURL(/#\/progress$/);
  await expect(
    page.locator('main[data-no-timer][data-part="progress"]'),
  ).toBeVisible();

  const events = part("event");
  await expect(events).toHaveCount(2);
  await expect(part("event-name")).toHaveText(["Practice", "DNF practice"]);
  await expect(events.first()).toHaveAttribute("aria-pressed", "true");
  await expect(
    events.first().locator('[data-part="progress-event-count"]'),
  ).toHaveText("16");
  await expect(part("average-name")).toHaveText("ao12");
  await expect(part("average")).toHaveText("10.20");
  const delta = (key: string) => part("deltas").locator(`[data-key="${key}"]`);
  await expect(delta("30")).toHaveAttribute("data-sign", "faster");
  await expect(delta("30").locator("dd")).toHaveText("−1.80");
  await expect(delta("365")).toHaveCount(0);
  await expect(delta("best")).toHaveAttribute("data-sign", "same");
  await expect(delta("best").locator("dd")).toHaveText("0.00");

  for (const [name, value] of [
    ["single", "6.00"],
    ["ao12", "10.20"],
  ] as const) {
    const best = part("pbs").locator(`[data-name="${name}"]`);
    await expect(best.locator("data")).toHaveText(value);
    await expect(best.locator("time")).toHaveText("3 Mar 2026");
    await expect(best.locator("time")).toHaveAttribute(
      "datetime",
      "2026-03-03",
    );
  }
  const practice = (key: string) =>
    part("practice-numbers").locator(`[data-key="${key}"] dd`);
  await expect(practice("days")).toHaveText("2");
  await expect(practice("run")).toHaveText("2");
  await expect(
    part("calendar").locator('rect:not([data-level="0"])'),
  ).toHaveCount(2);
  await expect(practice("today")).toHaveText("0");

  // A click on a day says what it held; the arrow keys walk the days.
  const day = part("day");
  await part("calendar").locator('rect[data-day="2026-03-03"]').click();
  await expect(day.locator("span").first()).toHaveText("3 Mar 2026");
  await expect(day.locator('[data-key="count"]')).toHaveText("4 solves");
  await expect(day.locator('[data-key="mean"]')).toHaveText("6.00 mean");
  await expect(day.locator('[data-key="dnf"]')).toHaveCount(0);
  await expect(
    part("calendar").locator('rect[data-day="2026-03-03"]'),
  ).toHaveAttribute("data-picked", "true");
  await part("calendar").press("ArrowUp");
  await expect(day).toHaveAttribute("data-day", "2026-03-02");
  await expect(day.locator('[data-key="count"]')).toHaveText("12 solves");
  await expect(day.locator('[data-key="mean"]')).toHaveText("12.00 mean");
  await part("calendar").press("ArrowLeft");
  await expect(day).toHaveAttribute("data-day", "2026-03-02");
  await part("calendar").press("ArrowRight");
  await expect(day).toHaveAttribute("data-day", "2026-03-09");
  await expect(day.locator("span").nth(1)).toHaveText("no solves");
  await part("calendar").press("Escape");
  await expect(day).toHaveCount(0);
  await expect(page).toHaveURL(/#\/progress$/);

  // The spread, asked for: whole seconds from 6 to 12, the 12s tallest.
  const more = part("more");
  await expect(part("distribution")).toHaveCount(0);
  await more.locator("summary").click();
  const bars = part("distribution").locator("rect");
  await expect(bars).toHaveCount(7);
  await expect(bars.first()).toHaveAttribute("data-count", "4");
  await expect(bars.last()).toHaveAttribute("data-count", "12");
  await expect(part("distribution-axis").locator("span")).toHaveText([
    "6.00",
    "13.00",
  ]);
  await expect(part("distribution-dnf")).toHaveCount(0);

  const trend = part("trend");
  const svg = trend.getByRole("img");
  await expect(part("line")).toBeAttached();
  await svg.scrollIntoViewIfNeeded();
  const bounds = await svg.boundingBox();
  if (!bounds) throw new Error("Missing trend bounds");
  await page.mouse.move(bounds.x + bounds.width - 14, bounds.y + 20);
  await expect(part("readout-value")).toHaveText("ao12 10.20");
  await expect(part("readout-solve")).toHaveText("Solve 16 · 3 Mar 2026");

  await trend.press("Home");
  await expect(part("readout-solve")).toHaveText("Solve 12 · 2 Mar 2026");
  await trend.press("ArrowRight");
  await expect(part("readout-solve")).toHaveText("Solve 13 · 3 Mar 2026");
  await trend.press("End");
  await expect(part("readout-solve")).toHaveText("Solve 16 · 3 Mar 2026");
  await trend.press("Escape");
  await expect(page).toHaveURL(/#\/$/);
  await page.locator('[data-action="progress"]').click();

  await events.nth(1).click();
  await expect(events.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(part("needs")).toHaveText("An average needs 5 solves.");
  await expect(part("line")).toHaveCount(0);
  await expect(part("pbs").locator("[data-name]")).toHaveCount(0);
  await expect(practice("days")).toHaveText("1");
  await part("calendar").locator('rect[data-day="2026-03-04"]').click();
  await expect(day.locator('[data-key="count"]')).toHaveText("1 solve");
  await expect(day.locator('[data-key="mean"]')).toHaveCount(0);
  await expect(day.locator('[data-key="dnf"]')).toHaveText("1 DNF");
  await part("more").locator("summary").click();
  await expect(part("distribution").locator("rect")).toHaveCount(0);
  await expect(part("distribution-dnf")).toHaveText("1 DNF");
  await page.keyboard.press("KeyT");
  await expect(page).toHaveURL(/#\/$/);
  await expect(sessionButton(page)).toHaveText("Practice");
});

test("folder and selected sessions combine one puzzle in chronological order", async ({
  page,
}) => {
  await page.goto("/?state=progress-scopes#/progress");
  const part = (name: string) => page.locator(`[data-part="progress-${name}"]`);
  const action = (name: string) =>
    page.locator(`[data-action="progress-${name}"]`);
  await expect(part("event-name")).toHaveText(["A", "B", "C"]);
  const options = part("scope").locator("summary");
  await options.focus();
  await page.keyboard.press("Enter");
  await action("scope").selectOption("folder");
  await expect(part("scope-count")).toHaveText("105 solves");
  await expect(part("average-name")).toHaveText("ao100");
  // The folder's day holds both sessions' solves.
  await part("calendar").locator('rect[data-day="2026-11-01"]').click();
  await expect(part("day").locator('[data-key="count"]')).toHaveText(
    "105 solves",
  );

  for (const name of ["ao5", "ao12", "ao100"]) {
    await action("stat").selectOption(name);
    await expect(part("average-name")).toHaveText(name);
    await expect(part("best")).toBeAttached();
  }
  await action("stat").selectOption("ao5");
  await expect(part("average")).toHaveText("12.00");
  await expect(part("target")).toHaveCount(1);
  await action("puzzle").selectOption("333fm");
  await expect(part("scope-count")).toHaveText("3 solves");
  await expect(part("average-name")).toHaveText("mo3");
  // Fewest Moves has no target: a target is a time.
  await expect(part("target")).toHaveCount(0);
  await expect(part("average")).toHaveText("22.00");
  await expect(part("pbs").locator('[data-name="single"] data')).toHaveText(
    "21",
  );

  await action("scope").selectOption("selection");
  await expect(part("scope-count")).toHaveText("53 solves");
  const b = part("scope").getByRole("checkbox", { name: "B", exact: true });
  await b.focus();
  await page.keyboard.press("Space");
  await expect(part("scope-count")).toHaveText("105 solves");

  await page.keyboard.press("Escape");
  await expect(sessionButton(page)).toHaveText("A");
  await page.keyboard.press("ArrowUp");
  await expect(page.locator('[data-part="time"]')).toHaveText("12.00");
  await page.keyboard.press("KeyD");
  await expect(page.locator('[data-part="time"]')).toHaveText("DNF");
  await page.keyboard.press("KeyT");
  await expect(part("event-name")).toHaveText(["A", "B", "C"]);
  await part("scope").locator("summary").click();
  await action("scope").selectOption("folder");
  await expect(part("scope-count")).toHaveText("105 solves");
  await action("stat").selectOption("ao5");
  await expect(part("average")).toHaveText("12.67");
});

test("on a phone a month opens its days, and today counts in the file", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const times = await page.evaluate(() => ({
    now: new Date(2026, 3, 1, 21).getTime(),
    march: new Date(2026, 2, 2, 18).getTime() / 1000,
    late: new Date(2026, 2, 31, 23, 30).getTime() / 1000,
    today: new Date(2026, 3, 1, 0, 15).getTime() / 1000,
  }));
  await page.clock.setFixedTime(times.now);
  await expect(sessionButton(page)).toBeEnabled();
  await page.goto("/#/settings/data");
  const input = page.locator('[data-action="import-file"] input');
  await expect(input).toBeEnabled();
  await input.setInputFiles({
    name: "phone.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        session1: [
          ...Array.from({ length: 3 }, (_, i) => [
            [0, 10000],
            "R U",
            "",
            times.march + i,
          ]),
          [[0, 11000], "R U", "", times.late],
          [[0, 9000], "R U", "", times.today],
          [[-1, 9000], "R U", "", times.today + 1],
        ],
        properties: { sessionData: { 1: { name: "Phone", scrType: "333" } } },
      }),
    ),
  });
  await page.locator('[data-action="import-confirm"]').click();
  await expect(page.locator('[data-part="data-result"]')).toHaveText(
    "Added 6 solves.",
  );
  await page
    .locator('[data-part="settings-sections"] [data-section="look"]')
    .click();
  await page.locator("#setting-today").selectOption("on");
  await page.goto("/#/");
  await switchSession(page, "Phone");
  // 23:30 the day before stays out; a DNF after midnight counts.
  await expect(page.locator('[data-stat="today"]')).toHaveText("2");

  await page.goto("/#/progress");
  const part = (name: string) => page.locator(`[data-part="progress-${name}"]`);
  await expect(part("calendar")).toHaveAttribute("data-shape", "months");
  await expect(
    part("practice-numbers").locator('[data-key="today"] dd'),
  ).toHaveText("2");
  await part("calendar").locator('rect[data-month="2026-03"]').click();
  const line = part("day").first();
  await expect(line.locator("span")).toHaveText([
    "March 2026",
    "4 solves",
    "2 days",
  ]);
  await part("month").locator('rect[data-day="2026-03-31"]').click();
  const day = part("day").last();
  await expect(day).toHaveAttribute("data-day", "2026-03-31");
  await expect(day.locator('[data-key="mean"]')).toHaveText("11.00 mean");
  await part("month").press("ArrowLeft");
  await expect(day).toHaveAttribute("data-day", "2026-03-30");
});

test("a target time gets a rough day, or says why it cannot", async ({
  page,
}) => {
  await page.goto("/");
  const times = await page.evaluate(() => ({
    now: new Date(2026, 2, 7, 21).getTime(),
    first: new Date(2026, 2, 1, 18).getTime() / 1000,
  }));
  await page.clock.setFixedTime(times.now);
  await expect(sessionButton(page)).toBeEnabled();
  await page.goto("/#/settings/data");
  const input = page.locator('[data-action="import-file"] input');
  await expect(input).toBeEnabled();
  // Seven days, five solves a day, medians from 16.00 down to 10.00; then a flat
  // session and a sparse one.
  const day = 86_400;
  const daily = (medians: number[], from: number) =>
    medians.flatMap((median, index) =>
      Array.from({ length: 5 }, (_, i) => [
        [0, median],
        "R U",
        "",
        from + index * day + i * 60,
      ]),
    );
  await input.setInputFiles({
    name: "target.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        session1: daily(
          [16000, 15000, 14000, 13000, 12000, 11000, 10000],
          times.first,
        ),
        session2: daily(
          [12000, 12000, 12000, 12000, 12000, 12000, 12000],
          times.first,
        ),
        session3: daily([12000, 11000, 10000], times.first + 4 * day),
        properties: {
          sessionData: {
            1: { name: "Falling", scrType: "333" },
            2: { name: "Flat", scrType: "333" },
            3: { name: "Sparse", scrType: "333" },
          },
        },
      }),
    ),
  });
  await page.locator('[data-action="import-confirm"]').click();
  await expect(page.locator('[data-part="data-result"]')).toHaveText(
    "Added 85 solves.",
  );
  await page.goto("/#/");
  await switchSession(page, "Falling");
  await page.locator('[data-action="progress"]').click();
  const part = (name: string) => page.locator(`[data-part="progress-${name}"]`);
  const target = part("target");
  const answer = part("target-answer").filter({ visible: true });
  // The first screen stays calm: the target is one folded word.
  await expect(target.locator("summary")).toHaveText("Target", {
    useInnerText: true,
  });
  await target.locator("summary").click();
  const field = page.locator('[data-action="progress-target"]');
  await field.fill("9");
  await field.press("Enter");
  // Open, the line names the part and the answer stands beside the field.
  await expect(target.locator("summary")).toHaveText("Target", {
    useInnerText: true,
  });
  // 9.00 is met on 8 March; 9 March is the first day under it.
  await expect(answer).toHaveText("about 9 Mar 2026");
  await expect(answer).toHaveAttribute("data-reason", "estimate");
  await expect(part("target-slope")).toHaveText("−1.00 a day");
  await expect(part("target-basis")).toContainText("from 7 days, 35 solves");
  // T typed in the field stays in the field.
  await field.press("KeyT");
  await expect(page).toHaveURL(/#\/progress$/);
  await field.fill("9");
  await field.press("Enter");

  await part("event").filter({ hasText: "Flat" }).click();
  await expect(answer).toHaveText("no change lately");
  await part("event").filter({ hasText: "Sparse" }).click();
  await expect(answer).toHaveText("needs 7 days of 5 solves in the last 90");
  await expect(part("target-slope")).toHaveCount(0);

  // The target is the event's: it is back after a reload.
  await page.reload();
  await part("event").filter({ hasText: "Falling" }).click();
  // Folded, the line itself is the answer.
  await expect(target.locator("summary")).toContainText("Under 9.00", {
    useInnerText: true,
  });
  await expect(answer).toHaveText("about 9 Mar 2026");
});

test("the target layout follows the disclosure before its toggle event", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    document.addEventListener(
      "toggle",
      (event) => {
        if (
          event.target instanceof HTMLElement &&
          event.target.dataset.part === "progress-target"
        )
          event.stopPropagation();
      },
      true,
    );
  });
  await page.goto(
    "/?state=progress-target-sparse&now=2026-11-22T12:00#/progress",
  );
  const target = page.locator('[data-part="progress-target"]');
  const summary = target.locator("summary");
  const folded = summary.getByText("Under 12.50", { exact: true });
  const answer = target.locator('div [data-part="progress-target-answer"]');
  await expect(folded).toBeVisible();
  await summary.click();
  await expect(target).toHaveAttribute("open", "");
  await expect(summary).toHaveText("Target", { useInnerText: true });
  await expect(answer).toBeVisible();
  await summary.click();
  await expect(folded).toBeVisible();
  await expect(answer).toBeHidden();
});
