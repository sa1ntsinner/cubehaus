import { type EventId, eventInfo } from "@cubehaus/core";
import {
  best,
  OrderStatistics,
  parseStat,
  rankedWindowThreshold,
  rolling,
  type Stat,
  type StatId,
  statOf,
  summary,
} from "@cubehaus/stats";
import type { Layout } from "./settings";

export const statNames = ["ao5", "ao12", "mo3", "ao100"] as const;
type WindowId = Exclude<StatId, "best" | "mean">;
export type SessionStats = Record<
  StatId | `${WindowId}-best` | "count" | "finiteCount",
  number
>;
export type SlotPreferences = Readonly<Record<string, readonly StatId[]>>;

export function statId(value: unknown): value is StatId {
  return (
    typeof value === "string" &&
    (value === "best" ||
      value === "mean" ||
      value === "mo3" ||
      (value.startsWith("ao") && parseStat(value) !== null))
  );
}

export function slotKey(event: EventId, layout: Layout = "lift"): string {
  const { kind, format } = eventInfo(event);
  return `${layout}.${kind}.${format}`;
}

export function slotsFor(event: EventId, layout: Layout = "lift"): StatId[] {
  if (event === "333mbf") return [];
  const expanded = layout !== "lift";
  if (event === "333fm")
    return expanded ? ["mo3", "best", "mean"] : ["mo3", "best"];
  if (event === "666" || event === "777")
    return expanded ? ["mo3", "best", "ao5", "mean"] : ["mo3", "best"];
  if (event === "333bf")
    return expanded ? ["best", "ao5", "ao12", "mean"] : ["best", "ao5"];
  if (event === "444bf" || event === "555bf")
    return expanded ? ["best", "mo3", "ao5", "mean"] : ["best", "mo3"];
  return expanded ? ["ao5", "ao12", "best", "mean"] : ["ao5", "ao12"];
}

export function selectedSlots(
  event: EventId,
  preferences: SlotPreferences,
  layout: Layout = "lift",
): readonly StatId[] {
  const defaults = slotsFor(event, layout);
  const ids = preferences[slotKey(event, layout)];
  return ids?.length === defaults.length &&
    ids.every((id) => supportsStat(event, id))
    ? ids
    : defaults;
}

export function supportsStat(event: EventId, stat: StatId): boolean {
  const { kind } = eventInfo(event);
  return kind === "time" || (kind === "moves" && !stat.startsWith("ao"));
}

export function sessionWindows(
  event: EventId,
  prefs: SlotPreferences,
  layout: Layout = "lift",
): StatId[] {
  const kind = eventInfo(event).kind;
  return [
    ...(kind === "time"
      ? statNames
      : kind === "moves"
        ? (["mo3"] as const)
        : []),
    ...selectedSlots(event, prefs, layout),
  ];
}

function rollingOffThread(
  values: Float64Array,
  stat: Stat,
): Promise<Float64Array> {
  if (typeof Worker === "undefined")
    return Promise.resolve(rolling(values, stat));
  return new Promise<Float64Array>((resolve, reject) => {
    const worker = new Worker(
      new URL("./session-stats-worker.ts", import.meta.url),
      {
        type: "module",
      },
    );
    worker.onmessage = (event: MessageEvent<Float64Array>) => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage({ values, stat });
  }).catch(() => rolling(values, stat));
}

type Window = {
  name: WindowId;
  stat: Stat;
  series: Float64Array;
  minimum: number;
  tail: OrderStatistics | null;
};

function ranked(stat: Stat) {
  return stat.kind === "ao" && stat.n >= rankedWindowThreshold;
}

function grow(values: Float64Array, length: number): Float64Array {
  if (length <= values.length) return values;
  const next = new Float64Array(Math.max(length, values.length * 2, 16));
  next.set(values);
  return next;
}

export function createSessionStats(
  values: Float64Array = new Float64Array(0),
  startedAt: Float64Array = new Float64Array(0),
  requested: readonly StatId[] = statNames,
) {
  let count = values.length;
  const initial = summary(values);
  let validCount = count - initial.dnfCount;
  let sum = values.reduce(
    (total, value) => (Number.isFinite(value) ? total + value : total),
    0,
  );
  let singleBest = initial.best?.value ?? Infinity;
  let windows: Window[] = [];
  function request(names: readonly StatId[]) {
    const next: Window[] = [];
    for (const name of new Set(names)) {
      if (name === "best" || name === "mean") continue;
      const stat = parseStat(name);
      if (!stat) continue;
      const existing = windows.find((window) => window.name === name);
      if (existing) next.push(existing);
      else {
        const series = rolling(values.subarray(0, count), stat);
        next.push({
          name,
          stat,
          series,
          minimum: best(series)?.value ?? Infinity,
          tail: null,
        });
      }
    }
    windows = next;
  }
  request(requested);

  function change(
    index: number,
    removed: boolean,
    next?: { value: number; at: number },
  ) {
    const oldCount = count;
    const delta = Number(next !== undefined) - Number(removed);
    const oldValue = removed ? values[index] : undefined;
    const nextValue = next?.value;
    count += delta;
    values = grow(values, count);
    startedAt = grow(startedAt, count);
    if (delta !== 0) {
      const from = index + Number(removed);
      const to = index + Number(next !== undefined);
      values.copyWithin(to, from, oldCount);
      startedAt.copyWithin(to, from, oldCount);
    }
    if (next) {
      values[index] = next.value;
      startedAt[index] = next.at;
    }
    if (oldValue !== undefined && Number.isFinite(oldValue)) {
      validCount--;
      sum -= oldValue;
    }
    if (nextValue !== undefined && Number.isFinite(nextValue)) {
      validCount++;
      sum += nextValue;
    }
    if (oldValue === singleBest && (nextValue ?? Infinity) > singleBest) {
      singleBest = best(values.subarray(0, count))?.value ?? Infinity;
    } else {
      singleBest = Math.min(singleBest, nextValue ?? Infinity);
    }

    const pending: Promise<void>[] = [];
    for (const window of windows) {
      const { stat } = window;
      const boundary = index + stat.n - 1 + Number(removed);
      const oldEnd = Math.min(oldCount, boundary);
      let lostBest = false;
      for (let i = index; i < oldEnd; i++) {
        if (window.series[i] === window.minimum) lostBest = true;
      }
      const newEnd = Math.min(count, boundary + delta);
      window.series = grow(window.series, count);
      if (delta !== 0) window.series.copyWithin(newEnd, oldEnd, oldCount);
      function setAt(i: number, value: number) {
        window.series[i] = value;
        if (Number.isFinite(value))
          window.minimum = Math.min(window.minimum, value);
      }
      function updateBest() {
        if (lostBest)
          window.minimum =
            best(window.series.subarray(0, count))?.value ?? Infinity;
      }

      if (ranked(stat)) {
        if (index === oldCount && next) {
          if (count < stat.n) setAt(index, NaN);
          else {
            const from = count - stat.n;
            if (window.tail) window.tail.remove(values[from - 1] as number);
            else {
              window.tail = new OrderStatistics();
              for (let i = from; i < index; i++)
                window.tail.add(values[i] as number);
            }
            window.tail.add(next.value);
            setAt(index, window.tail.average());
          }
        } else {
          if (index >= oldCount - stat.n || delta !== 0) window.tail = null;
          if (newEnd <= index || newEnd < stat.n)
            window.series.fill(NaN, index, newEnd);
          else {
            const from = Math.max(0, index + 1 - stat.n);
            const segment = values.slice(from, newEnd);
            pending.push(
              rollingOffThread(segment, stat).then((result) => {
                for (let i = index; i < newEnd; i++)
                  setAt(i, result[i - from] as number);
                updateBest();
              }),
            );
            continue;
          }
        }
      } else {
        for (let i = index; i < newEnd; i++) {
          setAt(
            i,
            statOf(values.subarray(Math.max(0, i + 1 - stat.n), i + 1), stat),
          );
        }
      }
      updateBest();
    }
    if (pending.length) return Promise.all(pending).then(() => {});
  }

  return {
    get count() {
      return count;
    },
    get dates() {
      return startedAt.subarray(0, count);
    },
    change,
    request,
    at(name: StatId, index: number) {
      return (
        windows.find((window) => window.name === name)?.series[index] ?? NaN
      );
    },
    bestWindowEnd(name: StatId): number {
      const window = windows.find((item) => item.name === name);
      return window && Number.isFinite(window.minimum)
        ? window.series.subarray(0, count).indexOf(window.minimum)
        : -1;
    },
    preview(name: StatId, index: number = count - 1) {
      if (name === "best" || name === "mean") {
        const partial = summary(values.subarray(0, index + 1));
        return name === "best" ? (partial.best?.value ?? NaN) : partial.mean;
      }
      const existing = windows.find((window) => window.name === name);
      if (existing) return existing.series[index] ?? NaN;
      const stat = parseStat(name);
      return stat && index + 1 >= stat.n
        ? statOf(values.subarray(index + 1 - stat.n, index + 1), stat)
        : NaN;
    },
    /** The numbers as they stood when the solve at `index` was the newest. */
    upTo(index: number): Pick<SessionStats, StatId> {
      const partial = summary(values.subarray(0, index + 1));
      const out = {
        best: partial.best?.value ?? NaN,
        mean: partial.mean,
      } as Pick<SessionStats, StatId>;
      for (const { name, series } of windows) out[name] = series[index] ?? NaN;
      return out;
    },
    stats(): SessionStats {
      const stats = {
        count,
        finiteCount: validCount,
        best: Number.isFinite(singleBest) ? singleBest : NaN,
        mean: validCount === 0 ? NaN : sum / validCount,
      } as SessionStats;
      for (const { name, series, minimum } of windows) {
        stats[name] = series[count - 1] ?? NaN;
        stats[`${name}-best`] = Number.isFinite(minimum) ? minimum : NaN;
      }
      return stats;
    },
  };
}
