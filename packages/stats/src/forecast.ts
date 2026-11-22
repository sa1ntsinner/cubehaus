/**
 * When a falling trend of daily medians would first be under a target time. A rough
 * estimate on purpose: robust to bad days, silent when the history cannot carry it.
 */

export type ForecastDay = {
  day: string;
  medianMs: number;
  finiteCount: number;
};

export type ForecastReason =
  | "estimate"
  | "already"
  | "sparse"
  | "flat"
  | "stale"
  | "rising"
  | "distant";

export type Forecast = {
  /** The median change per civil day, negative when getting faster. */
  slopeMsPerDay: number | null;
  /** The first civil day strictly under the target, when there is an estimate. */
  day: string | null;
  reason: ForecastReason;
  /** Days and finite solves the estimate rests on. */
  days: number;
  solves: number;
};

const dayMs = 86_400_000;
const windowDays = 90;
const minDays = 7;
const minSpan = 6;
const minSolves = 5;
const staleDays = 30;
const horizonDays = 365;

/** Whole days between two ISO civil dates (UTC midnights, so clock changes do not count). */
const between = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / dayMs);

function median(values: number[]): number {
  const sorted = values.sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/**
 * Uses the last 90 civil days before `today`, days with at least five finite solves,
 * at least seven of them spanning six days or more. The slope is the median of the
 * slopes between every pair of days (Theil–Sen), projected from the latest median.
 */
export function forecast(
  days: readonly ForecastDay[],
  targetMs: number,
  today: string,
): Forecast {
  const latest = days.reduce<string | null>(
    (last, { day }) => (last === null || day > last ? day : last),
    null,
  );
  const eligible = days
    .filter(
      ({ day, medianMs, finiteCount }) =>
        finiteCount >= minSolves &&
        Number.isFinite(medianMs) &&
        between(day, today) >= 0 &&
        between(day, today) < windowDays,
    )
    .sort((a, b) => (a.day < b.day ? -1 : Number(a.day > b.day)));
  const solves = eligible.reduce((n, { finiteCount }) => n + finiteCount, 0);
  const base = { days: eligible.length, solves };
  if (latest === null || between(latest, today) > staleDays)
    return { slopeMsPerDay: null, day: null, reason: "stale", ...base };
  const first = eligible[0];
  const last = eligible.at(-1);
  if (
    !first ||
    !last ||
    eligible.length < minDays ||
    between(first.day, last.day) < minSpan
  )
    return { slopeMsPerDay: null, day: null, reason: "sparse", ...base };

  const slopes: number[] = [];
  for (let i = 0; i < eligible.length; i++)
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i] as ForecastDay;
      const b = eligible[j] as ForecastDay;
      slopes.push((b.medianMs - a.medianMs) / between(a.day, b.day));
    }
  const slope = median(slopes);
  const result = { slopeMsPerDay: slope, ...base };
  if (last.medianMs < targetMs)
    return { ...result, day: null, reason: "already" };
  if (slope === 0) return { ...result, day: null, reason: "flat" };
  if (slope > 0) return { ...result, day: null, reason: "rising" };
  // last + slope * k < target, for the smallest whole k.
  const k = Math.floor((targetMs - last.medianMs) / slope) + 1;
  const ahead = between(today, last.day) + k;
  if (ahead > horizonDays) return { ...result, day: null, reason: "distant" };
  return {
    ...result,
    day: new Date(Date.parse(last.day) + k * dayMs).toISOString().slice(0, 10),
    reason: "estimate",
  };
}
