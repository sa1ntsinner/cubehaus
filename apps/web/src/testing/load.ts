import type { DbState } from "../db/open";
import { pinClock } from "./clock";
import { performanceSeedKey } from "./performance-data";
import type { Seed } from "./seed";

export type LoadedSeed = Seed & { open(): Promise<DbState> };

export function performanceCount(search: string): number | undefined {
  const value = new URLSearchParams(search).get("seed");
  if (!value || !/^[1-9][0-9]{0,5}$/.test(value)) return undefined;
  const count = Number(value);
  return count <= 100_000 ? count : undefined;
}

export function loadSeed(
  search: string,
): Promise<LoadedSeed | undefined> | undefined {
  if (import.meta.env.VITE_TEST_HOOKS !== "1") return undefined;
  // Before the seed dates its solves from today.
  pinClock(search);
  const params = new URLSearchParams(search);
  if (!params.has("state")) {
    const count = performanceCount(search);
    if (!count) return undefined;
    // The measured reload follows the regular startup path, including its
    // database open. Provisioning runs only on the first visit in this tab.
    const grouped = params.get("history") === "grouped";
    if (sessionStorage.getItem(performanceSeedKey(count, grouped)) === "ready")
      return undefined;
    return import("./performance-seed").then(
      async ({ provisionPerformanceSeed, provisionGroupedPerformanceSeed }) => {
        await (grouped
          ? provisionGroupedPerformanceSeed(count)
          : provisionPerformanceSeed(count));
        return undefined;
      },
    );
  }
  return import("./seed").then(({ openSeed, parseSeed }) => {
    const seed = parseSeed(search);
    return seed && { ...seed, open: () => openSeed(seed) };
  });
}
