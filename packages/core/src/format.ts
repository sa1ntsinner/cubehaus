import { effectiveMs, type Solve } from "./solve";

type Options = { precision?: 2 | 3 };

export function formatTime(ms: number, options?: Options): string {
  return formatDuration(ms, options, Math.floor);
}

// An average is rounded half up, where a single time is truncated.
export function formatAverage(ms: number, options?: Options): string {
  return formatDuration(ms, options, Math.round);
}

function formatDuration(
  ms: number,
  options: Options | undefined,
  round: (value: number) => number,
): string {
  if (ms === Infinity) return "DNF";
  if (!Number.isFinite(ms)) return "";
  const precision = ms >= 600000 ? 0 : (options?.precision ?? 2);
  const unitsPerSecond = 10 ** precision;
  const units = round(ms / (1000 / unitsPerSecond));
  const seconds = Math.floor(units / unitsPerSecond);
  const fraction =
    precision === 0
      ? ""
      : `.${String(units % unitsPerSecond).padStart(precision, "0")}`;
  if (seconds < 60) return `${seconds}${fraction}`;
  const tail = `${String(seconds % 60).padStart(2, "0")}${fraction}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}:${tail}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${tail}`;
}

export function formatPenaltySum(
  solve: Pick<Solve, "timeMs" | "plus2" | "dnf">,
): string {
  if (solve.dnf || solve.plus2 === 0) return "";
  return `${formatTime(solve.timeMs)} + ${2 * solve.plus2} = ${formatTime(effectiveMs(solve))}`;
}

export function isRecord(value: number, previousBest: number | null): boolean {
  return (
    Number.isFinite(value) && (previousBest === null || value <= previousBest)
  );
}
