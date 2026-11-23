import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { action, createSession } from "./helpers";

const part = (page: Page, name: string) =>
  page.locator(`[data-part="${name}"]`);

async function ready(page: Page, event: string) {
  await expect(part(page, "scramble")).toHaveAttribute("data-event", event);
  await expect(part(page, "scramble")).toHaveAttribute("data-ready", "true");
}

async function newSession(page: Page, event: string) {
  await createSession(page, event, event);
  await ready(page, event);
}

test("typing shows a validation sentence, saves a valid time and persists the mode", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page, "333");
  await part(page, "entry-mode").selectOption("typing");
  const input = part(page, "entry-input");
  await input.fill("12.3.4");
  await input.press("Enter");
  await expect(part(page, "entry-error")).toHaveText(/\.$/);
  await expect(part(page, "solve-time")).toHaveCount(0);

  await input.fill("12.34");
  await input.press("Enter");
  await expect(part(page, "solve-time")).toHaveText("12.34");
  await expect(part(page, "entry-error")).toHaveCount(0);

  await page.reload();
  await expect(part(page, "entry-mode")).toHaveValue("typing");
  await expect(part(page, "solve-time")).toHaveText("12.34");
});

test("E2b, E2b1, E2d1: reaching 60:00 stores nothing and 81 ETM previews DNF", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  await newSession(page, "333fm");

  const clock = part(page, "fm-clock");
  await expect(clock).toHaveText("60:00");
  await action(page, "fm-start").click();
  await page.clock.fastForward(3300000);
  await expect(clock).toHaveAttribute("data-warn", "true");
  await page.clock.fastForward(300000);
  await expect(clock).toHaveAttribute("data-over", "true");
  await expect(clock).toHaveText("0:00");
  await expect(part(page, "solve-time")).toHaveCount(0);

  const input = part(page, "entry-input");
  await input.fill("x ".repeat(81));
  await action(page, "entry-save").click();
  await expect(part(page, "entry-feedback")).toHaveText(/DNF/);
  await expect(part(page, "solve-time")).toHaveCount(0);
  await action(page, "entry-save").click();
  await expect(part(page, "solve-time")).toHaveText("DNF");
});

test("H1a, H1b1, 9f12c: attempted cubes determine the scrambles and 1 of 2 is DNF", async ({
  page,
}) => {
  await page.goto("/");
  await newSession(page, "333mbf");
  const time = part(page, "time");
  const totals = part(page, "stats-totals");
  await expect(time).toHaveText("0.00");
  await expect(time).not.toHaveAttribute("data-result-kind", "multi");
  for (const field of ["cubes-attempted", "cubes-solved"]) {
    await expect(part(page, field)).toHaveAttribute("placeholder", "–");
  }
  await expect(part(page, "cube-scramble")).toHaveCount(2);
  await part(page, "cubes-attempted").fill("3");
  await action(page, "entry-scrambles").click();
  await expect(part(page, "cube-scramble")).toHaveCount(3);

  await page.evaluate(() => {
    const send = (type: string, at: number) => {
      const key = new KeyboardEvent(type, {
        code: "Space",
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(key, "timeStamp", { value: at });
      window.dispatchEvent(key);
    };
    send("keydown", 0);
    send("keyup", 300);
    send("keydown", 1800300);
    send("keyup", 1800301);
  });
  await expect(part(page, "entry-input")).toHaveValue("1800.000");
  await expect(part(page, "solve-time")).toHaveCount(0);
  await part(page, "cubes-solved").fill("3");
  await action(page, "entry-save").click();
  await expect(part(page, "solve-time").first()).toHaveText("3/3 30:00");
  await expect(time).toHaveAttribute("data-result-kind", "multi");
  await expect(time).toHaveText("3/3 30:00");

  await part(page, "cubes-attempted").fill("2");
  await action(page, "entry-scrambles").click();
  await expect(part(page, "cube-scramble")).toHaveCount(2);
  await part(page, "cubes-solved").fill("1");
  await part(page, "entry-input").fill("20:00");
  await action(page, "entry-save").click();
  await expect(part(page, "solve-time").first()).toHaveText("DNF (1/2 20:00)");
  await expect(time).toHaveText("DNF (1/2 20:00)");
  await expect(totals).toHaveCount(0);
  await expect(part(page, "entry-feedback")).toHaveText(/DNF/);
});
