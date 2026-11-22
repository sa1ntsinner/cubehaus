import {
  eventInfo,
  formatAverage,
  formatMoves,
  formatSolve,
  penaltyOf,
  resultValue,
  type Solve,
} from "@cubehaus/core";
import { type Stat, statOf, trimCount } from "@cubehaus/stats";

export function describeStatWindow(
  rows: readonly Solve[],
  stat: Stat,
  precision: 2 | 3 = 2,
) {
  const event = rows[0]?.event;
  if (!event || rows.length !== stat.n) return null;
  const kind = eventInfo(event).kind;
  if (kind === "multi" || rows.some((row) => row.event !== event)) return null;

  const values = rows.map(resultValue);
  const value = statOf(values, stat);
  const formatted =
    kind === "moves"
      ? formatMoves(value, { mean: true })
      : formatAverage(value, { precision });
  const dropped = new Set<number>();
  if (stat.kind === "ao") {
    const ordered = values.map((value, index) => ({ value, index }));
    ordered.sort((a, b) => a.value - b.value || a.index - b.index);
    const trim = trimCount(stat.n);
    for (const { index } of ordered.slice(0, trim)) dropped.add(index);
    for (const { index } of ordered.slice(-trim)) dropped.add(index);
  }

  const lines = rows.map((solve, index) => {
    const result = formatSolve(solve, { precision });
    const raw =
      result === "DNF"
        ? formatSolve({ ...solve, dnf: false, plus2: 0 }, { precision })
        : "";
    const time = raw && raw !== "DNF" ? `DNF (${raw})` : result;
    return {
      id: solve.id,
      time,
      scramble: solve.scramble,
      dropped: dropped.has(index),
      penalty: penaltyOf(solve),
    };
  });

  return { title: `${stat.kind}${stat.n} ${formatted}`, lines };
}

export function formatStatWindow(
  rows: readonly Solve[],
  stat: Stat,
  language: "en" | "ru",
  precision: 2 | 3 = 2,
): string {
  const view = describeStatWindow(rows, stat, precision);
  if (!view) return "";
  const number = new Intl.NumberFormat(language, { useGrouping: false });
  return [
    view.title,
    ...view.lines.map(
      ({ time, scramble, dropped }, index) =>
        `${number.format(index + 1)}. ${dropped ? `(${time})` : time}  ${scramble}`,
    ),
  ].join("\n");
}

export async function copyStatWindow(
  text: string,
  write: (value: string) => Promise<void>,
): Promise<{ kind: "copied" } | { kind: "fallback"; text: string }> {
  try {
    await write(text);
    return { kind: "copied" };
  } catch {
    return { kind: "fallback", text };
  }
}
