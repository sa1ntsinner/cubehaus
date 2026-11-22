import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type DailyTotal, totalOn } from "../day";
import {
  CALENDAR_HEADER,
  calendarLevel,
  monthLayout,
  weekLayout,
} from "../progress-chart";
import type { Text } from "../text";
import { useProgressSize } from "./useProgressSize";

const PHONE = "(max-width: 699px)";
const DAY_MS = 86_400_000;

/** A civil date moved by whole days (UTC arithmetic, so clock changes do not count). */
function shiftDay(day: string, by: number) {
  return new Date(Date.parse(day) + by * DAY_MS).toISOString().slice(0, 10);
}

function shiftMonth(month: string, by: number) {
  const [year = 0, index = 1] = month.split("-").map(Number);
  const at = new Date(Date.UTC(year, index - 1 + by, 1));
  return at.toISOString().slice(0, 7);
}

/**
 * The practice numbers and calendar. A click, a tap or the arrow keys on the calendar
 * pick a day (on a phone, a month first, then a day of it), and one line under it says
 * how many solves that day had, their mean and DNFs.
 */
export function ProgressPractice({
  days,
  totals,
  run,
  today,
  locale,
  numbers,
  dates,
  labels,
  mean,
}: {
  days: ReadonlyMap<string, number>;
  totals: readonly DailyTotal[];
  run: number;
  today: string;
  locale: string;
  numbers: Intl.NumberFormat;
  dates: Intl.DateTimeFormat;
  labels: Text["progress"];
  /** The mean in the scope's units, or null where a mean means nothing (Multi-Blind). */
  mean: ((value: number) => string) | null;
}) {
  const { ref, width } = useProgressSize(true);
  const [phone, setPhone] = useState(() => matchMedia(PHONE).matches);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [pickedMonth, setPickedMonth] = useState<string | null>(null);
  useEffect(() => {
    const media = matchMedia(PHONE);
    const update = () => setPhone(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);

  const layout = useMemo(
    () =>
      phone
        ? { shape: "months" as const, grid: monthLayout(days, today, width) }
        : { shape: "weeks" as const, grid: weekLayout(days, today, width) },
    [days, today, width, phone],
  );
  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "narrow" }),
    [locale],
  );
  const monthName = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
    [locale],
  );
  const { height } = layout.grid;
  // The keys walk as far back as the calendar draws.
  const first = useMemo(() => {
    let earliest = today;
    if (layout.shape === "weeks") {
      for (const { day } of layout.grid.cells)
        if (day < earliest) earliest = day;
    } else
      for (const { year, month } of layout.grid.cells) {
        const key = `${year}-${String(month + 1).padStart(2, "0")}-01`;
        if (key < earliest) earliest = key;
      }
    return earliest;
  }, [layout, today]);

  // The picked month's days, as a small calendar of weeks from Monday.
  const month = useMemo(() => {
    if (layout.shape !== "months" || !pickedMonth || !layout.grid.cell)
      return null;
    const start = `${pickedMonth}-01`;
    const pitch = layout.grid.cell + 2;
    const lead = (new Date(Date.parse(start)).getUTCDay() + 6) % 7;
    const cells: { day: string; count: number; x: number; y: number }[] = [];
    for (let day = start; day.startsWith(pickedMonth); day = shiftDay(day, 1)) {
      const offset = lead + cells.length;
      cells.push({
        day,
        count: day > today ? 0 : (days.get(day) ?? 0),
        x: (offset % 7) * pitch,
        y: Math.floor(offset / 7) * pitch,
      });
    }
    const level = calendarLevel(cells.map(({ count }) => count));
    return {
      cells: cells.map((cell) => ({ ...cell, level: level(cell.count) })),
      cell: layout.grid.cell,
      width: 7 * pitch,
      height: (Math.floor((lead + cells.length - 1) / 7) + 1) * pitch,
    };
  }, [layout, pickedMonth, days, today]);

  const clampDay = (day: string) =>
    day < first ? first : day > today ? today : day;
  const clampMonth = (key: string) =>
    key < first.slice(0, 7)
      ? first.slice(0, 7)
      : key > today.slice(0, 7)
        ? today.slice(0, 7)
        : key;

  function pickFrom(input: MouseEvent<SVGSVGElement>) {
    const target = input.target as Element;
    const day = target.getAttribute("data-day");
    const key = target.getAttribute("data-month");
    if (day) setPickedDay(day);
    else if (key) {
      setPickedMonth(key);
      setPickedDay(null);
    }
  }

  function step(input: KeyboardEvent<SVGSVGElement>, months: boolean) {
    const moves: Record<string, number> = months
      ? { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -12, ArrowDown: 12 }
      : { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
    if (input.key === "Escape" && (pickedDay || pickedMonth)) {
      input.preventDefault();
      setPickedDay(null);
      setPickedMonth(null);
      return;
    }
    const by = moves[input.key];
    if (by === undefined) return;
    input.preventDefault();
    if (months) {
      setPickedMonth((key) =>
        clampMonth(key ? shiftMonth(key, by) : today.slice(0, 7)),
      );
      setPickedDay(null);
    } else setPickedDay((day) => clampDay(day ? shiftDay(day, by) : today));
  }

  const picked = pickedDay ? totalOn(totals, pickedDay) : null;
  const monthTotal = useMemo(() => {
    if (!pickedMonth) return null;
    let count = 0;
    let active = 0;
    for (const total of totals)
      if (total.day.startsWith(pickedMonth)) {
        count += total.count;
        active++;
      }
    return { count, active };
  }, [pickedMonth, totals]);
  const todayCount = totalOn(totals, today).count;

  return (
    <section ref={ref} data-part="progress-practice">
      <dl data-part="progress-practice-numbers">
        <div data-key="days">
          <dt>{labels.days}</dt>
          <dd>{numbers.format(days.size)}</dd>
        </div>
        <div data-key="run">
          <dt>{labels.run}</dt>
          <dd>{numbers.format(run)}</dd>
        </div>
        <div data-key="today">
          <dt>{labels.today}</dt>
          <dd>{numbers.format(todayCount)}</dd>
        </div>
      </dl>
      <svg
        data-part="progress-calendar"
        data-shape={layout.shape}
        role="img"
        aria-label={labels.calendar}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: The calendar takes the arrow keys, as the trend does.
        tabIndex={0}
        width="100%"
        height={height}
        viewBox={height ? `0 0 ${width} ${height}` : undefined}
        onClick={pickFrom}
        onKeyDown={(input) => step(input, layout.shape === "months")}
      >
        {layout.shape === "weeks" ? (
          <>
            {layout.grid.years.map(({ year, x }) => (
              <text
                data-part="progress-axis"
                key={year}
                x={x}
                y={CALENDAR_HEADER - 4}
              >
                {year}
              </text>
            ))}
            {layout.grid.cells.map(({ day, count, level, x, y }) => (
              <rect
                key={day}
                data-day={day}
                data-level={level}
                data-picked={day === pickedDay || undefined}
                x={x}
                y={y}
                width={layout.grid.cell}
                height={layout.grid.cell}
              >
                <title>
                  {dates.format(new Date(`${day}T12:00:00`))} ·{" "}
                  {numbers.format(count)}
                </title>
              </rect>
            ))}
          </>
        ) : (
          height > 0 && (
            <>
              {layout.grid.months.map(({ month: index, x }) => (
                <text
                  data-part="progress-axis"
                  key={`month-${index}`}
                  x={x}
                  y={CALENDAR_HEADER - 4}
                  textAnchor="middle"
                >
                  {monthLabel.format(new Date(2000, index, 1))}
                </text>
              ))}
              {layout.grid.years.map(({ year, y }) => (
                <text
                  data-part="progress-axis"
                  key={year}
                  x={0}
                  y={y}
                  dominantBaseline="middle"
                >
                  {year}
                </text>
              ))}
              {layout.grid.cells.map(({ year, month: index, level, x, y }) => {
                const key = `${year}-${String(index + 1).padStart(2, "0")}`;
                return (
                  <rect
                    key={key}
                    data-month={key}
                    data-level={level}
                    data-picked={key === pickedMonth || undefined}
                    x={x}
                    y={y}
                    width={layout.grid.cell}
                    height={layout.grid.cell}
                  />
                );
              })}
            </>
          )
        )}
      </svg>
      {month && pickedMonth && monthTotal && (
        <>
          <p data-part="progress-day" aria-live="polite">
            <span>
              {monthName.format(new Date(`${pickedMonth}-01T00:00:00Z`))}
            </span>{" "}
            <span>{labels.solveCount(monthTotal.count)}</span>{" "}
            <span>{labels.dayCount(monthTotal.active)}</span>
          </p>
          <svg
            data-part="progress-month"
            role="img"
            aria-label={labels.calendar}
            width={month.width}
            height={month.height}
            viewBox={`0 0 ${month.width} ${month.height}`}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: The month's days take the arrow keys too.
            tabIndex={0}
            onClick={pickFrom}
            onKeyDown={(input) => {
              if (input.key === "Escape") {
                step(input, true);
                return;
              }
              const by = (
                {
                  ArrowLeft: -1,
                  ArrowRight: 1,
                  ArrowUp: -7,
                  ArrowDown: 7,
                } as Record<string, number>
              )[input.key];
              if (by === undefined) return;
              input.preventDefault();
              setPickedDay((day) => {
                const next = clampDay(
                  day ? shiftDay(day, by) : `${pickedMonth}-01`,
                );
                return next.startsWith(pickedMonth) ? next : day;
              });
            }}
          >
            {month.cells.map(({ day, level, x, y }) => (
              <rect
                key={day}
                data-day={day}
                data-level={level}
                data-picked={day === pickedDay || undefined}
                x={x}
                y={y}
                width={month.cell}
                height={month.cell}
              />
            ))}
          </svg>
        </>
      )}
      {picked && (
        <p data-part="progress-day" data-day={picked.day} aria-live="polite">
          <span>{dates.format(new Date(`${picked.day}T12:00:00`))}</span>{" "}
          {picked.count === 0 ? (
            <span>{labels.noSolves}</span>
          ) : (
            <>
              <span data-key="count">{labels.solveCount(picked.count)}</span>
              {mean && picked.mean !== null && (
                <>
                  {" "}
                  <span data-key="mean">
                    {mean(picked.mean)} <small>{labels.mean}</small>
                  </span>
                </>
              )}
              {picked.dnf > 0 && (
                <>
                  {" "}
                  <span data-key="dnf">
                    {numbers.format(picked.dnf)} <small>{labels.dnf}</small>
                  </span>
                </>
              )}
            </>
          )}
        </p>
      )}
    </section>
  );
}
