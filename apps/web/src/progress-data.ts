import { formatAverage, formatMoves, type ResultKind } from "@cubehaus/core";
import { best, pbHistory, practice, rolling } from "@cubehaus/stats";
import type { ProgressSeries } from "@cubehaus/storage";
import { localDayKey } from "./day";

const averages = [
  { name: "ao5", n: 5 },
  { name: "ao12", n: 12 },
  { name: "ao100", n: 100 },
] as const;

export function progressEvents<
  T extends { session: { id: string }; count: number },
>(sessions: readonly T[], selectedId: string | undefined): T[] {
  return sessions.filter(
    ({ session, count }) => count > 0 || session.id === selectedId,
  );
}

const dayMs = 86_400_000;
const comparisonDays = [30, 365] as const;

function lastOnOrBefore(
  startedAt: Float64Array,
  day: string,
  timeZone: string | undefined,
) {
  // The store returns solves in chronological order.
  let low = 0;
  let high = startedAt.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (localDayKey(startedAt[mid] as number, timeZone) <= day) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

export type ProgressStat = (typeof averages)[number]["name"] | "mo3";
type Best = {
  name: "single" | ProgressStat;
  value: number;
  at: number;
  index: number;
};

// Use the same rounding at both precisions as the figures shown in Progress.
function displayedAverageMs(value: number): number {
  const [whole = "", fraction = ""] = formatAverage(value).split(".");
  const seconds = whole
    .split(":")
    .reduce((total, unit) => total * 60 + Number(unit), 0);
  return seconds * 1000 + Number(fraction.padEnd(3, "0"));
}

export function formatProgressDifference(
  delta: number,
  kind: ResultKind = "time",
) {
  const sign = delta === 0 ? "same" : delta < 0 ? "faster" : "slower";
  const prefix = sign === "faster" ? "−" : sign === "slower" ? "+" : "";
  const magnitude =
    kind === "moves"
      ? formatMoves(Math.abs(delta), { mean: true })
      : formatAverage(Math.abs(delta));
  return { sign, label: prefix + magnitude };
}

export function progressDetails(
  { values, startedAt }: ProgressSeries,
  now: number,
  opts: {
    kind?: ResultKind;
    stat?: ProgressStat | null;
    timeZone?: string;
  } = {},
) {
  const kind = opts.kind ?? "time";
  const windowsForKind =
    kind === "time"
      ? averages
      : kind === "moves"
        ? [{ name: "mo3", n: 3 } as const]
        : [];
  const timeZone =
    opts.timeZone === Intl.DateTimeFormat().resolvedOptions().timeZone
      ? undefined
      : opts.timeZone;
  const today = localDayKey(now, timeZone);
  const displayed =
    kind === "moves"
      ? (value: number) => Number(formatMoves(value, { mean: true }))
      : displayedAverageMs;
  const pbs: Best[] = [];
  const single = best(values);
  if (single)
    pbs.push({
      name: "single",
      value: single.value,
      at: startedAt[single.index] as number,
      index: single.index,
    });

  const windows = windowsForKind
    .filter(({ n }) => n <= values.length)
    .map(({ name, n }) => {
      const series = rolling(values, {
        kind: kind === "moves" ? "mo" : "ao",
        n,
      });
      const record = pbHistory(series).at(-1);
      if (record !== undefined)
        pbs.push({
          name,
          value: series[record] as number,
          at: startedAt[record] as number,
          index: record,
        });
      return { name, first: n - 1, series, record };
    });

  const main = windows.find(({ name }) => name === opts.stat) ?? windows.at(-1);
  const value = main?.series.at(-1) ?? NaN;
  const comparisons: { key: 30 | 365 | "best"; delta: number }[] = [];
  if (main && Number.isFinite(value)) {
    const current = displayed(value);
    for (const days of comparisonDays) {
      const cutoff = new Date(Date.parse(today) - days * dayMs)
        .toISOString()
        .slice(0, 10);
      const cutoffIndex = lastOnOrBefore(startedAt, cutoff, timeZone);
      if (cutoffIndex === main.series.length - 1) continue;
      const previous = main.series[cutoffIndex] ?? NaN;
      if (Number.isFinite(previous))
        comparisons.push({
          key: days,
          delta: current - displayed(previous),
        });
    }
    if (main.record !== undefined)
      comparisons.push({
        key: "best",
        delta: current - displayed(main.series[main.record] as number),
      });
  }

  const days = new Map<string, number>();
  let day = "";
  let nextDay = -Infinity;
  for (const at of startedAt) {
    if (timeZone || at >= nextDay) {
      day = localDayKey(at, timeZone);
      if (!timeZone) {
        const boundary = new Date(at);
        nextDay = boundary.setHours(24, 0, 0, 0);
      }
    }
    days.set(day, (days.get(day) ?? 0) + 1);
  }

  return {
    current: main ? { ...main, value, comparisons } : null,
    pbs,
    today,
    windows,
    days,
    practice: practice([...days.keys()].sort()),
  };
}
