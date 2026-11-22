import { eventInfo } from "@cubehaus/core";
import { distribution } from "@cubehaus/stats";
import type { ProgressScope, ProgressSeries, Store } from "@cubehaus/storage";
import { type DailyTotal, dailyMedians, dailyTotals, localDayKey } from "./day";
import { type ProgressStat, progressDetails } from "./progress-data";

export type ProgressPoint = { index: number; startedAt: number; value: number };

export type ProgressRequest = {
  revision: number;
  now: number;
  timeZone: string;
  width: number;
  stat: ProgressStat | null;
};

type Details = ReturnType<typeof progressDetails>;

export type ProgressModel = {
  key: string;
  event: ProgressScope["event"];
  count: number;
  current: Partial<Record<ProgressStat, number>>;
  trend: {
    name: ProgressStat;
    value: number;
    first: number;
    record: ProgressPoint | null;
    start: ProgressPoint | null;
    end: ProgressPoint | null;
    comparisons: NonNullable<Details["current"]>["comparisons"];
  } | null;
  series: (ProgressPoint | null)[];
  records: Details["pbs"];
  days: Details["days"];
  practice: Details["practice"];
  today: string;
  /** Every practised civil day of the scope, oldest first. */
  totals: DailyTotal[];
  /** Daily medians of the last 90 days, for a target estimate; times only. */
  recent: { day: string; medianMs: number; finiteCount: number }[];
};

export type ProgressDistribution = {
  bins: { start: number; count: number }[];
  dnf: number;
};

type Frame = {
  model: ProgressModel;
  /** The scope's results, for the distribution on request. */
  results: Float64Array;
  kind: ReturnType<typeof eventInfo>["kind"];
  values: Float64Array;
  startedAt: Float64Array;
  finite: number[];
};

function point(
  values: Float64Array,
  dates: Float64Array,
  index: number,
): ProgressPoint {
  return {
    index,
    startedAt: dates[index] as number,
    value: values[index] as number,
  };
}

function sample(
  values: Float64Array,
  dates: Float64Array,
  first: number,
  width: number,
) {
  const count = values.length - first;
  const columns = Math.min(width, count);
  const finite: number[] = [];
  const points: (ProgressPoint | null)[] = [];
  for (let column = 0; column < columns; column++) {
    const from = first + Math.floor((column * count) / columns);
    const to = first + Math.floor(((column + 1) * count) / columns);
    let low = -1;
    let high = -1;
    for (let index = from; index < to; index++) {
      const value = values[index] as number;
      if (!Number.isFinite(value)) continue;
      finite.push(index);
      if (low === -1 || value < (values[low] as number)) low = index;
      if (high === -1 || value > (values[high] as number)) high = index;
    }
    if (low === -1) points.push(null);
    else {
      points.push(point(values, dates, Math.min(low, high)));
      if (high !== low) points.push(point(values, dates, Math.max(low, high)));
    }
  }
  return { finite, points };
}

function closest(
  indices: readonly number[],
  index: number,
): number | undefined {
  let low = 0;
  let high = indices.length;
  while (low < high) {
    const mid = low + ((high - low) >> 1);
    if ((indices[mid] as number) < index) low = mid + 1;
    else high = mid;
  }
  const before = indices[low - 1];
  const after = indices[low];
  return before === undefined ||
    (after !== undefined && after - index < index - before)
    ? after
    : before;
}

export function createProgressReader(store: Store) {
  let revision = -1;
  let counts: Promise<Record<string, number>> | undefined;
  const inputs = new Map<string, Promise<ProgressSeries>>();
  const frames = new Map<string, Frame>();

  function reset(next: number) {
    if (next === revision) return;
    revision = next;
    counts = undefined;
    inputs.clear();
    frames.clear();
  }

  return {
    counts(next: number) {
      reset(next);
      counts ??= store.solves.progressCounts();
      return counts;
    },
    async readProgress(
      scope: ProgressScope,
      options: ProgressRequest,
    ): Promise<ProgressModel> {
      reset(options.revision);
      const width = Math.max(1, Math.min(1600, Math.floor(options.width) || 1));
      const scopeKey = JSON.stringify([
        scope.kind,
        scope.event,
        scope.kind === "selection" ? [...new Set(scope.ids)].sort() : scope.id,
      ]);
      const key = JSON.stringify([
        options.revision,
        scopeKey,
        width,
        options.stat,
        options.timeZone,
        localDayKey(options.now, options.timeZone),
      ]);
      const previous = frames.get(key);
      if (previous) return previous.model;

      let input = inputs.get(scopeKey);
      if (!input) {
        input = store.solves.scopedSeries(scope);
        if (inputs.size >= 4) inputs.delete(inputs.keys().next().value ?? "");
        inputs.set(scopeKey, input);
      }
      const data = await input;
      const details = progressDetails(data, options.now, {
        kind: eventInfo(scope.event).kind,
        stat: options.stat,
        timeZone: options.timeZone,
      });
      const selected = details.current;
      const values = selected?.series ?? new Float64Array();
      const result = sample(
        values,
        data.startedAt,
        selected?.first ?? 0,
        width,
      );
      const at = (index: number | undefined) =>
        index === undefined ? null : point(values, data.startedAt, index);
      const kind = eventInfo(scope.event).kind;
      const zone =
        options.timeZone === Intl.DateTimeFormat().resolvedOptions().timeZone
          ? undefined
          : options.timeZone;
      const model: ProgressModel = {
        key,
        event: scope.event,
        count: data.values.length,
        current: Object.fromEntries(
          details.windows.map(({ name, series }) => [name, series.at(-1)]),
        ),
        trend: selected && {
          name: selected.name,
          value: selected.value,
          first: selected.first,
          record: at(selected.record),
          start: at(result.finite[0]),
          end: at(result.finite.at(-1)),
          comparisons: selected.comparisons,
        },
        series: result.points,
        records: details.pbs,
        days: details.days,
        practice: details.practice,
        today: details.today,
        totals: dailyTotals(data.startedAt, data.values, zone),
        recent:
          kind === "time"
            ? dailyMedians(data.startedAt, data.values, options.now, 90, zone)
            : [],
      };

      if (revision === options.revision) {
        if (frames.size >= 6) frames.delete(frames.keys().next().value ?? "");
        frames.set(key, {
          model,
          results: data.values,
          kind,
          values,
          startedAt: data.startedAt,
          finite: result.finite,
        });
      }
      return model;
    },
    /**
     * How the scope's results spread, asked for only when it is shown: whole seconds for
     * times (wider for long ones), single moves for Fewest Moves; none for Multi-Blind.
     */
    async distribution(key: string): Promise<ProgressDistribution | null> {
      const frame = frames.get(key);
      if (!frame || frame.kind === "multi") return null;
      return distribution(frame.results, frame.kind === "moves" ? 1 : 1000);
    },
    async point(key: string, index: number): Promise<ProgressPoint | null> {
      const frame = frames.get(key);
      const nearest = frame && closest(frame.finite, index);
      return frame && nearest !== undefined
        ? point(frame.values, frame.startedAt, nearest)
        : null;
    },
  };
}

export type ProgressReader = ReturnType<typeof createProgressReader>;
