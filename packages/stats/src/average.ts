// Values are effective times in milliseconds: a DNF is Infinity. NaN is not a
// valid value; it only appears in results, as "not enough values".

export type Stat = { kind: "ao" | "mo"; n: number };

/** "ao5", "mo3", "ao100". An ao needs n >= 5, an mo needs n >= 2. */
export function parseStat(id: string): Stat | null {
  const match = /^(ao|mo)([1-9][0-9]*)$/.exec(id);
  if (!match) return null;
  const kind = match[1] as Stat["kind"];
  const n = Number(match[2]);
  if (!Number.isSafeInteger(n) || n < (kind === "ao" ? 5 : 2)) return null;
  return { kind, n };
}

/** How many values an ao of n drops at each end. */
export function trimCount(n: number): number {
  return Math.ceil(n * 0.05);
}

/** The stat over the n values ending at index end (default: the last one). */
export function statOf(
  values: ArrayLike<number>,
  stat: Stat,
  end: number = values.length - 1,
): number {
  assertNoNaN(values);
  const { n } = stat;
  if (end < n - 1 || end >= values.length) return NaN;
  const start = end - n + 1;
  if (stat.kind === "mo") {
    let sum = 0;
    for (let i = start; i <= end; i++) sum += values[i] as number;
    return sum / n;
  }
  const window = new Float64Array(n);
  for (let i = 0; i < n; i++) window[i] = values[start + i] as number;
  window.sort();
  return trimmedMean(window, n);
}

/**
 * The ao of a window sorted ascending. Infinity sorts last, so a DNF counts
 * among the highest values. Shared with rolling() so both sum in the same
 * order and give identical results.
 */
export function trimmedMean(sorted: Float64Array, n: number): number {
  const t = trimCount(n);
  if (sorted[n - t - 1] === Infinity) return Infinity; // more than t DNFs
  let sum = 0;
  for (let i = t; i < n - t; i++) sum += sorted[i] as number;
  return sum / (n - 2 * t);
}

/** The smallest finite value; ties go to the earliest index. */
export function best(
  series: Float64Array,
): { index: number; value: number } | null {
  let found: { index: number; value: number } | null = null;
  for (let i = 0; i < series.length; i++) {
    const value = series[i] as number;
    if (Number.isFinite(value) && (found === null || value < found.value))
      found = { index: i, value };
  }
  return found;
}

export function summary(values: Float64Array): {
  count: number;
  dnfCount: number;
  best: { index: number; value: number } | null;
  worst: { index: number; value: number } | null;
  mean: number;
} {
  let dnfCount = 0;
  let finiteCount = 0;
  let sum = 0;
  let worst: { index: number; value: number } | null = null;
  for (let i = 0; i < values.length; i++) {
    const value = values[i] as number;
    if (value === Infinity) dnfCount++;
    if (!Number.isFinite(value)) continue;
    finiteCount++;
    sum += value;
    // Ties go to the earliest index, as for best.
    if (worst === null || value > worst.value) worst = { index: i, value };
  }
  return {
    count: values.length,
    dnfCount,
    best: best(values),
    worst,
    mean: finiteCount === 0 ? NaN : sum / finiteCount,
  };
}

export function assertNoNaN(values: ArrayLike<number>): void {
  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(values[i])) throw new RangeError(`NaN at index ${i}`);
  }
}
