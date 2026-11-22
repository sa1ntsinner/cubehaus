/** Convert decimal seconds to whole milliseconds by dropping the fractional remainder. */
export function duration(text: string): number | undefined {
  const match = /^(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) return;
  const [, whole = "", fraction = "", exponent = "0"] = match;
  const all = whole + fraction;
  if (!all) return;
  const digits = all.replace(/^0+/, "");
  if (!digits) return 0;
  const point =
    whole.length - (all.length - digits.length) + Number(exponent) + 3;
  if (point < 0) return 0;
  if (point > 16) return;
  const ms = Number(digits.slice(0, point).padEnd(point, "0"));
  if (Number.isSafeInteger(ms)) return ms;
}
