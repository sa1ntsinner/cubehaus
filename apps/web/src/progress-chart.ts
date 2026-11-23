import type { ProgressPoint } from "./progress-worker";

const PLOT_LEFT = 40;
const PLOT_RIGHT = 12;
const PLOT_TOP = 12;
const PLOT_BOTTOM = 24;

function roundStep(
  startPower: number,
  factors: readonly number[],
  fits: (step: number) => boolean,
) {
  for (let power = startPower; ; power++) {
    for (const factor of factors) {
      const step = factor * 10 ** power;
      if (fits(step)) return step;
    }
  }
}

function ticks(min: number, max: number, step: number) {
  const first = Math.ceil(min / step);
  const last = Math.floor(max / step);
  return Array.from({ length: last - first + 1 }, (_, i) => (first + i) * step);
}

export function yTicks(min: number, max: number) {
  const step = roundStep(
    Math.floor(Math.log10((max - min) / 5)),
    [1, 2, 2.5, 5],
    (step) => Math.floor(max / step) - Math.ceil(min / step) < 4,
  );
  return ticks(min, max, step);
}

export function xTicks(
  first: number,
  last: number,
  plotWidth: number,
  figureWidth: number,
) {
  if (first === last) return [first];
  const minimum = ((figureWidth < 500 ? 64 : 88) * (last - first)) / plotWidth;
  const step = roundStep(
    Math.max(0, Math.floor(Math.log10(minimum))),
    [1, 2, 5],
    (step) => step >= minimum,
  );
  return ticks(first, last, step);
}

export function formatAxisTime(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return String(Number(seconds.toPrecision(12)));
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

type Point = { x: number; value: number };

function decimate(
  series: ArrayLike<number>,
  first: number,
  plotWidth: number,
  x: (index: number) => number,
): (Point | null)[] {
  const count = series.length - first;
  const columns = Math.floor(plotWidth);
  if (count <= columns)
    return Array.from({ length: count }, (_, offset) => {
      const index = first + offset;
      const value = series[index] as number;
      return Number.isFinite(value) ? { x: x(index), value } : null;
    });

  return Array.from({ length: columns }, (_, column) => {
    const from = first + Math.ceil((column * (count - 1)) / plotWidth);
    const to =
      column === columns - 1
        ? series.length
        : first + Math.ceil(((column + 1) * (count - 1)) / plotWidth);
    let sum = 0;
    let finite = 0;
    for (let index = from; index < to; index++) {
      const value = series[index] as number;
      if (Number.isFinite(value)) {
        sum += value;
        finite++;
      }
    }
    return finite ? { x: PLOT_LEFT + column + 0.5, value: sum / finite } : null;
  });
}

function linePath(
  points: readonly (Point | null)[],
  y: (value: number) => number,
) {
  const commands: string[] = [];
  let length = 0;
  for (const point of points) {
    if (point) {
      commands.push(`${length++ ? "L" : "M"}${point.x} ${y(point.value)}`);
    } else {
      if (length === 1) commands.push("h0");
      length = 0;
    }
  }
  if (length === 1) commands.push("h0");
  return commands.join(" ");
}

export function trendGeometry(
  series: ArrayLike<number>,
  first: number,
  width: number,
  height: number,
) {
  const plotWidth = width - PLOT_LEFT - PLOT_RIGHT;
  const plotHeight = height - PLOT_TOP - PLOT_BOTTOM;
  if (plotWidth < 1 || plotHeight < 1) return null;

  const finite: number[] = [];
  let fastest = Infinity;
  let slowest = -Infinity;
  for (let index = first; index < series.length; index++) {
    const value = series[index] as number;
    if (Number.isFinite(value)) {
      finite.push(index);
      fastest = Math.min(fastest, value);
      slowest = Math.max(slowest, value);
    }
  }
  const firstFinite = finite[0];
  const lastFinite = finite.at(-1);
  if (firstFinite === undefined || lastFinite === undefined) return null;

  const pad = (slowest - fastest) * 0.06 || 1000;
  const domain = [fastest - pad, slowest + pad] as const;
  const last = series.length - 1;
  const columns = Math.floor(plotWidth);
  const x = (index: number) =>
    PLOT_LEFT +
    (first === last
      ? plotWidth / 2
      : ((index - first) * plotWidth) / (last - first));
  const y = (value: number) =>
    PLOT_TOP + ((domain[1] - value) * plotHeight) / (domain[1] - domain[0]);

  function pick(px: number) {
    const index = Math.min(
      last,
      Math.max(
        first,
        first + Math.round(((px - PLOT_LEFT) * (last - first)) / plotWidth),
      ),
    );
    if (Number.isFinite(series[index])) return index;
    let low = 0;
    let high = finite.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if ((finite[mid] as number) < index) low = mid + 1;
      else high = mid;
    }
    const next = finite[low] as number;
    const previous = finite[low - 1];
    return previous !== undefined && index - previous <= Math.abs(next - index)
      ? previous
      : next;
  }

  const points = decimate(series, first, plotWidth, x);
  return {
    left: PLOT_LEFT,
    right: width - PLOT_RIGHT,
    top: PLOT_TOP,
    bottom: height - PLOT_BOTTOM,
    stepX:
      series.length - first <= columns
        ? plotWidth / Math.max(1, last - first)
        : 1,
    domain,
    fastest,
    slowest,
    firstFinite,
    lastFinite,
    points,
    path: linePath(points, y),
    x,
    y,
    pick,
  };
}

/** Geometry from the bucket extrema, with x in original solve indices. */
export function sampledTrendGeometry(
  samples: readonly (ProgressPoint | null)[],
  first: number,
  count: number,
  width: number,
  height: number,
  equalPadding: number,
) {
  const left = PLOT_LEFT;
  const right = width - PLOT_RIGHT;
  const top = PLOT_TOP;
  const bottom = height - PLOT_BOTTOM;
  const plotWidth = right - left;
  if (plotWidth < 1 || bottom <= top) return null;
  let fastest = Infinity;
  let slowest = -Infinity;
  for (const sample of samples) {
    if (sample) {
      fastest = Math.min(fastest, sample.value);
      slowest = Math.max(slowest, sample.value);
    }
  }
  if (!Number.isFinite(fastest)) return null;
  const pad = (slowest - fastest) * 0.06 || equalPadding;
  const domain = [fastest - pad, slowest + pad] as const;
  const last = count - 1;
  const span = last - first;
  const x = (index: number) =>
    left + (span === 0 ? plotWidth / 2 : ((index - first) * plotWidth) / span);
  const y = (value: number) =>
    top + ((domain[1] - value) * (bottom - top)) / (domain[1] - domain[0]);
  const pick = (pixel: number) =>
    Math.min(
      last,
      Math.max(first, first + Math.round(((pixel - left) * span) / plotWidth)),
    );
  const points = samples.map((sample) =>
    sample ? { x: x(sample.index), value: sample.value } : null,
  );
  return {
    left,
    right,
    top,
    bottom,
    fastest,
    slowest,
    domain,
    x,
    y,
    pick,
    stepX: Math.max(1, plotWidth / Math.max(1, span)),
    path: linePath(points, y),
  };
}

export function calendarLevel(counts: Iterable<number>) {
  const positive = [...counts]
    .filter((count) => count > 0)
    .sort((a, b) => a - b);
  const thresholds = [0.25, 0.5, 0.75].map(
    (q) => positive[Math.ceil(q * positive.length) - 1] ?? 0,
  );
  return (count: number) =>
    count === 0
      ? 0
      : 1 + thresholds.filter((threshold) => count > threshold).length;
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
export const CALENDAR_HEADER = 16;
const MONTH_LABEL_WIDTH = 40;
// Three letters of the 12 px mono and a clear gap: a month narrower than this names every
// other month, so no two names touch.
const MONTH_NAME_PITCH = 28;

/** A month's name in three letters (`Jun`, `июн`): one letter would make June and July
 * the same `J` or `И`. */
export function monthAbbreviation(locale: string, month: number): string {
  return new Intl.DateTimeFormat(locale, { month: "short" })
    .format(new Date(2000, month, 1))
    .replace(/\./g, "")
    .slice(0, 3);
}

function monday(at: number) {
  return at - ((new Date(at).getUTCDay() + 6) % 7) * DAY_MS;
}

function firstDay(days: ReadonlyMap<string, number>, today: string) {
  let first = "";
  for (const day of days.keys()) {
    if (day <= today && (!first || day < first)) first = day;
  }
  return first;
}

export function weekLayout(
  days: ReadonlyMap<string, number>,
  today: string,
  width: number,
) {
  const cells: {
    day: string;
    count: number;
    level: number;
    x: number;
    y: number;
  }[] = [];
  const years: { year: number; x: number }[] = [];
  const first = firstDay(days, today);
  if (!first || width < 4) return { cells, years, cell: 0, height: 0 };
  const end = Date.parse(today);
  const lastMonday = monday(end);
  const total = (lastMonday - monday(Date.parse(first))) / WEEK_MS + 1;
  const weeks = Math.min(total, Math.floor(width / 4));
  const pitch = Math.max(4, Math.min(15, Math.floor(width / weeks)));
  const start = lastMonday - (weeks - 1) * WEEK_MS;
  const level = calendarLevel(
    Array.from(days, ([day, count]) => (day <= today ? count : 0)),
  );
  let hasJanuaryLabel = false;

  for (let at = start; at <= end; at += DAY_MS) {
    const day = new Date(at).toISOString().slice(0, 10);
    const offset = (at - start) / DAY_MS;
    const x = Math.floor(offset / 7) * pitch;
    const count = days.get(day) ?? 0;
    cells.push({
      day,
      count,
      level: level(count),
      x,
      y: CALENDAR_HEADER + (offset % 7) * pitch,
    });
    const isJanuaryFirst = day.endsWith("-01-01");
    if (at !== start && !isJanuaryFirst) continue;
    const previous = years.at(-1);
    if (previous && x - previous.x < 36) {
      if (hasJanuaryLabel) continue;
      years.pop();
    }
    years.push({ year: Number(day.slice(0, 4)), x });
    hasJanuaryLabel = isJanuaryFirst;
  }
  return { cells, years, cell: pitch - 1, height: CALENDAR_HEADER + 7 * pitch };
}

export function monthLayout(
  days: ReadonlyMap<string, number>,
  today: string,
  width: number,
) {
  const cells: {
    year: number;
    month: number;
    count: number;
    level: number;
    x: number;
    y: number;
  }[] = [];
  const years: { year: number; y: number }[] = [];
  const months: { month: number; x: number }[] = [];
  const pitch = Math.min(28, Math.floor((width - MONTH_LABEL_WIDTH) / 12));
  const first = firstDay(days, today);
  if (!first || pitch <= 2) return { cells, years, months, cell: 0, height: 0 };
  const every = pitch >= MONTH_NAME_PITCH ? 1 : 2;
  for (let month = 0; month < 12; month += every)
    months.push({ month, x: MONTH_LABEL_WIDTH + (month + 0.5) * pitch });

  const firstYear = Number(first.slice(0, 4));
  const firstMonth = Number(first.slice(5, 7)) - 1;
  const lastYear = Number(today.slice(0, 4));
  const lastMonth = Number(today.slice(5, 7)) - 1;
  const byMonth = new Map<string, number>();
  for (const [day, count] of days) {
    if (day > today) continue;
    const key = day.slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + count);
  }
  const level = calendarLevel(byMonth.values());
  for (let year = firstYear; year <= lastYear; year++) {
    const y = CALENDAR_HEADER + (year - firstYear) * pitch;
    years.push({ year, y: y + (pitch - 2) / 2 });
    const start = year === firstYear ? firstMonth : 0;
    const end = year === lastYear ? lastMonth : 11;
    for (let month = start; month <= end; month++) {
      const key = `${year}-${String(month + 1).padStart(2, "0")}`;
      const count = byMonth.get(key) ?? 0;
      cells.push({
        year,
        month,
        count,
        level: level(count),
        x: MONTH_LABEL_WIDTH + month * pitch,
        y,
      });
    }
  }
  return {
    cells,
    years,
    months,
    cell: pitch - 2,
    height: CALENDAR_HEADER + years.length * pitch,
  };
}
