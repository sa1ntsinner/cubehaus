import { expect, test } from "vitest";
import { fmClock } from "./entry-clock";

test("E2b E2b1: 60:00 allowance and warning at 55 minutes", () => {
  expect(fmClock(0)).toEqual({ text: "60:00", warn: false, over: false });
  expect(fmClock(3299999).warn).toBe(false);
  expect(fmClock(3300000)).toEqual({ text: "5:00", warn: true, over: false });
  expect(fmClock(3600000)).toEqual({ text: "0:00", warn: true, over: true });
  expect(fmClock(3600001).text).toBe("0:00");
});
