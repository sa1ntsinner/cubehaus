import { describe, expect, test } from "vitest";
import { formatRunning, inspectionDisplay } from "./running";

describe("the running display", () => {
  test("tenths are truncated", () => {
    expect(formatRunning(12_678, "tenths")).toBe("12.6");
    expect(formatRunning(62_350, "tenths")).toBe("1:02.3");
  });
  test("hundredths, seconds and hidden", () => {
    expect(formatRunning(12_678, "hundredths")).toBe("12.67");
    expect(formatRunning(12_678, "seconds")).toBe("12");
    expect(formatRunning(12_678, "hidden")).toBe("…");
  });
  test("from 10:00 every mode shows whole seconds", () => {
    expect(formatRunning(729_990, "tenths")).toBe("12:09");
    expect(formatRunning(729_990, "hundredths")).toBe("12:09");
  });
});

describe("C1: the inspection count", () => {
  test("whole seconds, bands at 8 and 12", () => {
    expect(inspectionDisplay(7_999)).toEqual({
      text: "7",
      band: "clean",
      penalty: "ok",
    });
    expect(inspectionDisplay(8_000)).toMatchObject({ text: "8", band: "warn" });
    expect(inspectionDisplay(11_999)).toMatchObject({ band: "warn" });
    expect(inspectionDisplay(12_000)).toMatchObject({
      text: "12",
      band: "late",
    });
  });
  test("A4d1: 14.999 is clean, 15.00 is +2, 16.999 is +2, 17.00 is DNF", () => {
    expect(inspectionDisplay(14_999)).toMatchObject({
      text: "14",
      penalty: "ok",
    });
    expect(inspectionDisplay(15_000)).toMatchObject({
      text: "+2",
      penalty: "plus2",
    });
    expect(inspectionDisplay(16_999)).toMatchObject({
      text: "+2",
      penalty: "plus2",
    });
    expect(inspectionDisplay(17_000)).toMatchObject({
      text: "DNF",
      penalty: "dnf",
    });
  });
});
