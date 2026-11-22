const formatters = new Map<string, Intl.DateTimeFormat>();

export function localDayKey(ms: number, timeZone?: string): string {
  if (timeZone === undefined) {
    const date = new Date(ms);
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "iso8601",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(ms);
  const year = parts
    .find((part) => part.type === "year")
    ?.value.padStart(4, "0");
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

/** One civil day of practice: every attempt, its DNFs, and the mean of the rest. */
export type DailyTotal = {
  day: string;
  count: number;
  dnf: number;
  mean: number | null;
};

/**
 * Solves grouped by the local civil day they started on, oldest first. `values` are
 * results in their own unit (Infinity for a DNF); a day of DNFs only has no mean.
 */
export function dailyTotals(
  startedAt: Float64Array,
  values: Float64Array,
  timeZone?: string,
): DailyTotal[] {
  const out: DailyTotal[] = [];
  const sums: number[] = [];
  let day = "";
  let nextDay = -Infinity;
  for (let i = 0; i < startedAt.length; i++) {
    const at = startedAt[i] as number;
    // Without a zone the next local midnight bounds a day, so most solves skip the format.
    if (timeZone !== undefined || at >= nextDay) {
      day = localDayKey(at, timeZone);
      if (timeZone === undefined) nextDay = new Date(at).setHours(24, 0, 0, 0);
    }
    let total = out.at(-1);
    if (total?.day !== day) {
      total = { day, count: 0, dnf: 0, mean: null };
      out.push(total);
      sums.push(0);
    }
    total.count++;
    const value = values[i] as number;
    if (value === Infinity) total.dnf++;
    else if (Number.isFinite(value))
      sums[sums.length - 1] = (sums.at(-1) ?? 0) + value;
  }
  for (const [index, total] of out.entries()) {
    const finite = total.count - total.dnf;
    total.mean = finite > 0 ? (sums[index] as number) / finite : null;
  }
  return out;
}

/** The total of one day, or an empty one when nothing was solved that day. */
export function totalOn(
  totals: readonly DailyTotal[],
  day: string,
): DailyTotal {
  return (
    totals.find((total) => total.day === day) ?? {
      day,
      count: 0,
      dnf: 0,
      mean: null,
    }
  );
}

/**
 * The median finite result of each civil day in the `days` before `now` (today
 * included), oldest first, with how many finite results it rests on. `startedAt` is
 * in time order, so only the tail is read.
 */
export function dailyMedians(
  startedAt: Float64Array,
  values: Float64Array,
  now: number,
  days: number,
  timeZone?: string,
): { day: string; medianMs: number; finiteCount: number }[] {
  const today = localDayKey(now, timeZone);
  const from = new Date(Date.parse(today) - (days - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  // Two days of slack for any zone, then the civil day decides.
  const earliest = Date.parse(from) - 2 * 86_400_000;
  let low = 0;
  let high = startedAt.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((startedAt[mid] as number) < earliest) low = mid + 1;
    else high = mid;
  }
  const byDay = new Map<string, number[]>();
  for (let i = low; i < startedAt.length; i++) {
    const value = values[i] as number;
    if (!Number.isFinite(value)) continue;
    const day = localDayKey(startedAt[i] as number, timeZone);
    if (day < from || day > today) continue;
    const list = byDay.get(day);
    if (list) list.push(value);
    else byDay.set(day, [value]);
  }
  return [...byDay].map(([day, list]) => {
    list.sort((a, b) => a - b);
    const middle = list.length >> 1;
    return {
      day,
      medianMs:
        list.length % 2
          ? (list[middle] as number)
          : ((list[middle - 1] as number) + (list[middle] as number)) / 2,
      finiteCount: list.length,
    };
  });
}
