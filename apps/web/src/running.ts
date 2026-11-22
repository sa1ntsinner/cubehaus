import { formatTime, inspectionPenalty } from "@cubehaus/core";
import type { Settings } from "./settings";

// What the large time shows while a solve runs (DESIGN.md section 7): whole seconds
// by default, truncated like a result. From 10:00 every mode shows whole
// seconds, which formatTime already does.
export function formatRunning(ms: number, mode: Settings["running"]): string {
  if (mode === "hidden") return "…";
  const text = formatTime(ms);
  const point = text.indexOf(".");
  if (point < 0 || mode === "hundredths") return text;
  return mode === "tenths" ? text.slice(0, point + 2) : text.slice(0, point);
}

export type InspectionBand = "clean" | "warn" | "late";

// The inspection count (research C1): whole seconds while under 15.00,
// then the price of starting now. Boundaries are read in hundredths, as the
// automatic penalty reads them.
export function inspectionDisplay(ms: number): {
  text: string;
  band: InspectionBand;
  penalty: "ok" | "plus2" | "dnf";
} {
  const hundredths = Math.floor(ms / 10) * 10;
  const { plus2, dnf } = inspectionPenalty(hundredths);
  const band =
    hundredths >= 12000 ? "late" : hundredths >= 8000 ? "warn" : "clean";
  if (dnf) return { text: "DNF", band, penalty: "dnf" };
  if (plus2) return { text: "+2", band, penalty: "plus2" };
  return { text: String(Math.floor(hundredths / 1000)), band, penalty: "ok" };
}
