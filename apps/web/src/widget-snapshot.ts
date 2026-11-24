/**
 * What the phone's Home Screen widgets show (apps/mobile/ios/App/Widgets): a small
 * snapshot the page computes and hands to the app, which writes it as a file the widget
 * extension reads. The page is the source of truth; the extension computes nothing.
 * Format, versioned:
 *
 *   { version, trainer: { set, name, done, total, next } | null,
 *     times: { session, count, stats: { single|mo3|ao5|ao12: { values, current, best,
 *     record } } } | null }
 *
 * `values` are the last 50 the stat has, oldest first, in milliseconds (moves for Fewest
 * Moves), a DNF as null. `current` is the newest value as the app writes it, null when
 * there is none yet. `best` is the session's best in the same unit, `record` whether the
 * newest is one as the timer marks it.
 */
import {
  type EventId,
  eventInfo,
  formatAverage,
  formatMoves,
  formatMultiValue,
  formatTime,
} from "@cubehaus/core";
import { best, parseStat, rolling } from "@cubehaus/stats";

export const WIDGET_SNAPSHOT_VERSION = 1;
export const WIDGET_POINTS = 50;
/** The setting that names the trainer widget's set (in the backup, as `trainer.*` are). */
export const WIDGET_SET_KEY = "trainer.widget";

export const widgetStats = ["single", "mo3", "ao5", "ao12"] as const;
export type WidgetStat = (typeof widgetStats)[number];

export interface WidgetLine {
  values: (number | null)[];
  current: string | null;
  best: number | null;
  record: boolean;
}
export interface WidgetTimes {
  session: string;
  count: number;
  stats: Partial<Record<WidgetStat, WidgetLine>>;
}
export interface WidgetTrainer {
  set: string;
  name: string;
  done: number;
  total: number;
  next: string | null;
}
export interface WidgetSnapshot {
  version: typeof WIDGET_SNAPSHOT_VERSION;
  trainer: WidgetTrainer | null;
  times: WidgetTimes | null;
}

/**
 * The open session's part. `values` is its whole series, oldest first, a DNF as Infinity
 * (the store's `solves.series`); `records` are the timer's own marks for the newest solve.
 */
export function widgetTimes(session: {
  name: string;
  event: EventId;
  values: Float64Array;
  precision?: 2 | 3;
  /** The newest solve as the file writes it (`3.91+` after a +2), when it is at hand. */
  newest?: string | undefined;
  records?: Partial<Record<"best" | WidgetStat, boolean>>;
}): WidgetTimes {
  const { values, precision = 2, records = {} } = session;
  const kind = eventInfo(session.event).kind;
  const stats: WidgetTimes["stats"] = {};
  for (const name of widgetStats) {
    // As the timer offers them: Fewest Moves has a mean and no trimmed average, a
    // Multi-Blind result no average at all.
    if (
      name !== "single" &&
      kind !== "time" &&
      !(kind === "moves" && name === "mo3")
    )
      continue;
    const stat = name === "single" ? null : parseStat(name);
    const series = stat ? rolling(values, stat) : values;
    const format = (value: number) =>
      kind === "moves"
        ? formatMoves(value, { mean: name !== "single" })
        : kind === "multi"
          ? formatMultiValue(value)
          : name === "single"
            ? formatTime(value, { precision })
            : formatAverage(value, { precision });
    const shown: (number | null)[] = [];
    for (
      let i = Math.max(0, series.length - WIDGET_POINTS);
      i < series.length;
      i++
    ) {
      const value = series[i] as number;
      if (!Number.isNaN(value)) shown.push(value === Infinity ? null : value);
    }
    const newest = series.length ? (series[series.length - 1] as number) : NaN;
    stats[name] = {
      values: shown,
      current: Number.isNaN(newest)
        ? null
        : name === "single" && session.newest !== undefined
          ? session.newest
          : format(newest),
      best: best(series)?.value ?? null,
      record: records[name === "single" ? "best" : name] === true,
    };
  }
  return { session: session.name, count: values.length, stats };
}

/**
 * The trainer's part: of the set's cases, how many are being learnt (in the drills, the
 * trainer's own measure: the cases `trainer.cases` holds), and the one due first.
 */
export function widgetTrainer(input: {
  set: string;
  name: string;
  /** Every case of the set, by id. */
  ids: readonly string[];
  /** The cases in the drills with their schedules. */
  learning: readonly { caseId: string; dueAt: number }[];
  labels: ReadonlyMap<string, string>;
}): WidgetTrainer {
  const known = new Set(input.ids);
  const mine = input.learning.filter((row) => known.has(row.caseId));
  let first: (typeof mine)[number] | undefined;
  for (const row of mine) if (!first || row.dueAt < first.dueAt) first = row;
  return {
    set: input.set,
    name: input.name,
    done: mine.length,
    total: input.ids.length,
    next: first ? (input.labels.get(first.caseId) ?? null) : null,
  };
}

export function widgetSnapshot(
  trainer: WidgetTrainer | null,
  times: WidgetTimes | null,
): WidgetSnapshot {
  return { version: WIDGET_SNAPSHOT_VERSION, trainer, times };
}

type SnapshotHost = {
  visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
};

// The trainer and the timer say "something the widgets show may have changed" here; the
// one keeper (App) listens. Nothing listens on the web or the desktop.
const listeners = new Set<() => void>();
export function widgetsChanged(): void {
  for (const listener of listeners) listener();
}

/**
 * Keeps the widgets' snapshot current: `delayMs` after the last change, and at once when
 * the app goes to the background; written only when it differs from the last one written.
 * Returns a function that stops.
 */
export function keepWidgetSnapshot(
  build: () => Promise<WidgetSnapshot>,
  write: (json: string) => Promise<void>,
  doc: SnapshotHost,
  delayMs = 1500,
): () => void {
  let last: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<void> = Promise.resolve();
  const writeNow = () => {
    clearTimeout(timer);
    timer = undefined;
    queue = queue.then(async () => {
      try {
        const json = JSON.stringify(await build());
        if (json === last) return;
        await write(json);
        last = json;
      } catch {
        /* Tried again at the next change. */
      }
    });
    return queue;
  };
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void writeNow(), delayMs);
  };
  const onVisibility = () => {
    if (doc.visibilityState === "hidden") void writeNow();
  };
  listeners.add(changed);
  doc.addEventListener("visibilitychange", onVisibility);
  changed();
  return () => {
    clearTimeout(timer);
    listeners.delete(changed);
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}
