type ParsedTime = { timeMs: number; plus2: number; dnf: boolean };

const invalidTime = "Enter a valid positive time, such as 12.34.";

function durationMs(value: string): number {
  if (/^\d{3,}$/.test(value)) {
    const hundredths = Number(value.slice(-2));
    const seconds = Number(value.slice(-4, -2));
    const minutes = Number(value.slice(-6, -4));
    const hours = Number(value.slice(0, -6));
    if (seconds >= 60 || minutes >= 60) return NaN;
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + hundredths * 10;
  }
  if (!/^\d+(?::\d+){0,2}(?:\.\d{1,3})?$/.test(value)) return NaN;

  const [whole = "", fraction = ""] = value.split(".");
  const fields = whole.split(":").map(Number);
  if (fields.slice(1).some((field) => field >= 60)) return NaN;
  const seconds = fields.reduce((total, field) => total * 60 + field, 0);
  return seconds * 1000 + Number(fraction.padEnd(3, "0"));
}

export function parseTime(text: string): ParsedTime | { error: string } {
  let value = text.replace(/\s/g, "").replaceAll(",", ".").toLowerCase();
  if (value === "dnf" || value === "d")
    return { timeMs: 0, plus2: 0, dnf: true };

  const dnf = value.endsWith("dnf") || /^dnf\(.*\)$/.test(value);
  if (dnf) {
    value = value.endsWith("dnf") ? value.slice(0, -3) : value.slice(4, -1);
  }
  const penalty = /\+(2|4)?$/.exec(value);
  if (penalty) value = value.slice(0, penalty.index);
  const plus2 = penalty ? (penalty[1] === "4" ? 2 : 1) : 0;

  const timeMs = durationMs(value);
  if (!Number.isSafeInteger(timeMs + plus2 * 2000) || (!dnf && timeMs === 0))
    return { error: invalidTime };
  return { timeMs, plus2, dnf };
}
