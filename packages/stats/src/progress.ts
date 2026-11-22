export function pbHistory(series: Float64Array): number[] {
  const records: number[] = [];
  let best = Infinity;
  for (const [index, value] of series.entries()) {
    if (Number.isFinite(value) && value < best) {
      records.push(index);
      best = value;
    }
  }
  return records;
}

export function quantile(sortedFinite: Float64Array, q: number): number {
  if (sortedFinite.length === 0) return NaN;
  const position = (sortedFinite.length - 1) * q;
  const lower = Math.floor(position);
  const start = sortedFinite[lower] as number;
  const end = sortedFinite[Math.ceil(position)] as number;
  return start + (end - start) * (position - lower);
}

export interface DayStat {
  day: string;
  count: number;
  dnfCount: number;
  best: number;
  median: number;
  p10: number;
  p90: number;
}

export function byDay(
  startedAt: Float64Array,
  values: Float64Array,
  dayKey: (ms: number) => string,
): DayStat[] {
  const groups = new Map<
    string,
    { count: number; dnfCount: number; finite: number[] }
  >();
  for (let i = 0; i < values.length; i++) {
    const day = dayKey(startedAt[i] as number);
    let group = groups.get(day);
    if (!group) {
      group = { count: 0, dnfCount: 0, finite: [] };
      groups.set(day, group);
    }
    group.count++;
    const value = values[i] as number;
    if (value === Infinity) group.dnfCount++;
    if (Number.isFinite(value)) group.finite.push(value);
  }
  return Array.from(groups, ([day, { count, dnfCount, finite }]) => {
    const sorted = Float64Array.from(finite).sort();
    return {
      day,
      count,
      dnfCount,
      best: sorted[0] ?? NaN,
      median: quantile(sorted, 0.5),
      p10: quantile(sorted, 0.1),
      p90: quantile(sorted, 0.9),
    };
  });
}

type DaySpan = { days: number; from: string; to: string };
const dayMs = 86_400_000;

export function practice(days: readonly string[]): {
  activeDays: number;
  longestRun: DaySpan | null;
  longestBreak: DaySpan | null;
} {
  const first = days[0];
  if (first === undefined)
    return { activeDays: 0, longestRun: null, longestBreak: null };

  let longestRun = { days: 1, from: first, to: first };
  let longestBreak: DaySpan | null = null;
  let previous = first;
  // Date-only ISO strings parse at UTC midnight. They stand for civil dates,
  // so the difference is the same across clock changes in any time zone.
  let previousAt = Date.parse(first);
  let runFrom = first;
  let runDays = 1;
  for (const day of days.slice(1)) {
    const at = Date.parse(day);
    const gap = (at - previousAt) / dayMs - 1;
    if (gap === 0) {
      runDays++;
      if (runDays > longestRun.days)
        longestRun = { days: runDays, from: runFrom, to: day };
    } else {
      if (gap > (longestBreak?.days ?? 0))
        longestBreak = { days: gap, from: previous, to: day };
      runFrom = day;
      runDays = 1;
    }
    previous = day;
    previousAt = at;
  }
  return { activeDays: days.length, longestRun, longestBreak };
}

export function histogram(
  values: Float64Array,
  binMs: number,
): { start: number; count: number }[] {
  if (!Number.isFinite(binMs) || binMs <= 0)
    throw new RangeError("Histogram bin width must be positive and finite");
  const counts = new Map<number, number>();
  let first = Infinity;
  let last = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    const bin = Math.floor(value / binMs);
    counts.set(bin, (counts.get(bin) ?? 0) + 1);
    first = Math.min(first, bin);
    last = Math.max(last, bin);
  }
  if (counts.size === 0) return [];
  return Array.from({ length: last - first + 1 }, (_, offset) => {
    const bin = first + offset;
    return { start: bin * binMs, count: counts.get(bin) ?? 0 };
  });
}

const maxBins = 40;

/**
 * Finite results counted in bins of `width` (in their own unit), DNFs apart. The bins
 * run from the fastest to the slowest; when that would take more than 40 of them, the
 * width doubles until it does not, before anything is allocated.
 */
export function distribution(
  values: Float64Array,
  width: number,
): { bins: { start: number; count: number }[]; dnf: number } {
  if (!Number.isFinite(width) || width <= 0)
    throw new RangeError("Distribution bin width must be positive and finite");
  let dnf = 0;
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    if (value === Infinity) dnf++;
    else if (Number.isFinite(value)) {
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
  }
  if (low === Infinity) return { bins: [], dnf };
  let step = width;
  while (Math.floor(high / step) - Math.floor(low / step) + 1 > maxBins)
    step *= 2;
  const first = Math.floor(low / step);
  const counts = new Array<number>(Math.floor(high / step) - first + 1).fill(0);
  for (const value of values)
    if (Number.isFinite(value)) {
      const bin = Math.floor(value / step) - first;
      counts[bin] = (counts[bin] ?? 0) + 1;
    }
  return {
    bins: counts.map((count, index) => ({
      start: (first + index) * step,
      count,
    })),
    dnf,
  };
}
