import { formatAverage, formatMoves } from "@cubehaus/core";
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { actionKey, type Keymap } from "../keys/keymap";
import {
  formatAxisTime,
  sampledTrendGeometry,
  xTicks,
  yTicks,
} from "../progress-chart";
import type { ProgressModel, ProgressPoint } from "../progress-worker";
import type { Text } from "../text";
import { useProgressSize } from "./useProgressSize";

export function ProgressTrend({
  name,
  keymap,
  series,
  trend,
  count,
  moves,
  getPoint,
  dates,
  numbers,
  labels,
}: {
  name: string;
  keymap: Keymap;
  series: ProgressModel["series"];
  trend: NonNullable<ProgressModel["trend"]>;
  count: number;
  moves: boolean;
  getPoint(index: number): Promise<ProgressPoint | null>;
  dates: Intl.DateTimeFormat;
  numbers: Intl.NumberFormat;
  labels: Text["progress"];
}) {
  const id = useId().replace(/[^A-Za-z0-9-]/g, "");
  const { ref, width, height } = useProgressSize();
  const [picked, setPicked] = useState<number | null>(null);
  const [resolved, setResolved] = useState<{
    requested: number;
    point: ProgressPoint | null;
  } | null>(null);
  const position = useRef<{ width: number; x: number } | null>(null);
  const { first, record, start, end } = trend;
  const format = moves ? formatMovesAverage : formatAverage;
  const plot = useMemo(
    () =>
      sampledTrendGeometry(
        series,
        first,
        count,
        width,
        height,
        moves ? 1 : 1000,
      ),
    [series, first, count, width, height, moves],
  );
  const visiblePoints = useMemo(() => {
    const points = new Map<number, ProgressPoint>();
    for (const item of series) if (item) points.set(item.index, item);
    for (const item of [record, start, end])
      if (item) points.set(item.index, item);
    return points;
  }, [series, record, start, end]);

  useEffect(() => {
    if (picked === null || visiblePoints.has(picked)) return;
    let stale = false;
    void getPoint(picked).then(
      (point) => {
        if (!stale) setResolved({ requested: picked, point });
      },
      () => {
        if (!stale) setResolved({ requested: picked, point: null });
      },
    );
    return () => {
      stale = true;
    };
  }, [getPoint, picked, visiblePoints]);

  const description =
    start && end
      ? labels.trend(name, format(start.value), format(end.value))
      : undefined;

  const drawing = useMemo(() => {
    if (!plot) return null;
    return (
      <>
        <defs>
          <linearGradient
            id={id}
            gradientUnits="userSpaceOnUse"
            x1="0"
            x2="0"
            y1={plot.y(plot.fastest)}
            y2={plot.y(plot.slowest)}
          >
            <stop data-stop="fast" offset="0" />
            <stop data-stop="mid" offset="0.5" />
            <stop data-stop="slow" offset="1" />
          </linearGradient>
        </defs>
        {yTicks(...plot.domain).map((value) => {
          const y = Math.floor(plot.y(value)) + 0.5;
          return (
            <g key={value}>
              <line
                data-part="progress-grid"
                x1={plot.left}
                x2={plot.right}
                y1={y}
                y2={y}
              />
              <text
                data-part="progress-axis"
                x={plot.left - 6}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {moves ? value : formatAxisTime(value)}
              </text>
            </g>
          );
        })}
        {xTicks(first + 1, count, plot.right - plot.left, width).map(
          (value) => (
            <text
              data-part="progress-axis"
              key={value}
              x={plot.x(value - 1)}
              y={height - 6}
              textAnchor="middle"
            >
              {numbers.format(value)}
            </text>
          ),
        )}
        <path
          data-part="progress-line"
          pathLength="1"
          stroke={`url(#${id})`}
          fill="none"
          d={plot.path}
        />
        {record && (
          <circle
            data-part="progress-best"
            r="4.5"
            cx={plot.x(record.index)}
            cy={plot.y(record.value)}
          />
        )}
      </>
    );
  }, [count, first, height, id, moves, numbers, plot, record, width]);

  function clear() {
    position.current = null;
    setPicked(null);
  }

  function pick(x: number) {
    if (!plot) return;
    const clamped = Math.max(plot.left, Math.min(plot.right, x));
    position.current = { width, x: clamped };
    setPicked(plot.pick(clamped));
  }

  function pointerPick(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width > 0)
      pick(((event.clientX - rect.left) * width) / rect.width);
  }

  function keyPick(event: KeyboardEvent<HTMLElement>) {
    const action = (["previous", "next", "first", "last"] as const).find((id) =>
      actionKey(keymap, `chart.${id}`, event),
    );
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (!plot) return;
    if (action === "first") pick(plot.left);
    else if (action === "last") pick(plot.right);
    else {
      const direction = action === "next" ? 1 : -1;
      if (picked === null) pick(direction === 1 ? plot.left : plot.right);
      else {
        const x =
          position.current?.width === width
            ? position.current.x
            : plot.x(picked);
        pick(x + direction * plot.stepX);
      }
    }
  }

  const selected =
    picked === null
      ? null
      : (visiblePoints.get(picked) ??
        (resolved?.requested === picked ? resolved.point : null));
  const cursor =
    plot && selected
      ? {
          ...selected,
          x: plot.x(selected.index),
          y: plot.y(selected.value),
        }
      : null;
  return (
    <figure
      ref={ref}
      data-part="progress-trend"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: The chart supports keyboard scrubbing.
      tabIndex={0}
      onKeyDown={keyPick}
      data-hover={cursor ? "" : undefined}
      data-side={cursor ? (cursor.x > width / 2 ? "end" : "start") : undefined}
      style={cursor ? ({ "--x": `${cursor.x}px` } as CSSProperties) : undefined}
    >
      <svg
        role="img"
        aria-label={description ?? undefined}
        width="100%"
        height="100%"
        display="block"
        preserveAspectRatio="none"
        viewBox={plot ? `0 0 ${width} ${height}` : undefined}
        onPointerMove={pointerPick}
        onPointerDown={pointerPick}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse") clear();
        }}
        onPointerCancel={clear}
      >
        {drawing}
        {plot && cursor && (
          <>
            <line
              data-part="progress-crosshair"
              x1={cursor.x}
              x2={cursor.x}
              y1={plot.top}
              y2={plot.bottom}
            />
            <circle data-part="progress-cursor" cx={cursor.x} cy={cursor.y} />
          </>
        )}
      </svg>
      <figcaption data-part="progress-readout" hidden={!cursor}>
        {cursor && (
          <>
            <span data-part="progress-readout-value">
              {name} {format(cursor.value)}
            </span>{" "}
            <span data-part="progress-readout-solve">
              {labels.solveAt(
                numbers.format(cursor.index + 1),
                dates.format(cursor.startedAt),
              )}
            </span>
          </>
        )}
      </figcaption>
    </figure>
  );
}

function formatMovesAverage(value: number) {
  return formatMoves(value, { mean: true });
}
