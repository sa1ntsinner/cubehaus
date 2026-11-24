import { statOf, summary } from "./average";

export interface SplitStanding {
  key: string;
  name: string;
  mean: number;
  ao12: number;
  best: number;
}

/** Oldest first; each named part uses its own available samples. */
export function splitSummary(
  solves: readonly (readonly { name: string; durationMs: number }[])[],
): SplitStanding[] {
  const series = new Map<string, { name: string; values: number[] }>();
  for (const parts of solves) {
    const occurrences = new Map<string, number>();
    for (const { name, durationMs } of parts) {
      const occurrence = (occurrences.get(name) ?? 0) + 1;
      occurrences.set(name, occurrence);
      const key = JSON.stringify([name, occurrence]);
      let part = series.get(key);
      if (!part) {
        part = {
          name: occurrence === 1 ? name : `${name} (${occurrence})`,
          values: [],
        };
        series.set(key, part);
      }
      part.values.push(durationMs);
    }
  }
  return Array.from(series, ([key, { name, values }]) => {
    const { mean, best } = summary(Float64Array.from(values));
    return {
      key,
      name,
      mean,
      ao12: statOf(values.slice(-12), { kind: "ao", n: 12 }),
      best: best?.value ?? NaN,
    };
  });
}
