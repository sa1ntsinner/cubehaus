import type { EventId } from "@cubehaus/core";

// csTimer's scramble types for the puzzles cubehaus times. Training scrambles (PLL,
// cross, edges), relays and other puzzles have none and become 3×3 with an issue.
const events = new Map<string, EventId>([
  ["333", "333"],
  ["222so", "222"],
  ["444wca", "444"],
  ["555wca", "555"],
  ["666wca", "666"],
  ["777wca", "777"],
  ["pyrso", "pyram"],
  ["skbso", "skewb"],
  ["sqrs", "sq1"],
  ["clkwca", "clock"],
  ["mgmp", "minx"],
  ["333oh", "333oh"],
  ["333fm", "333fm"],
  ["333ni", "333bf"],
  ["444bld", "444bf"],
  ["555bld", "555bf"],
  ["r3ni", "333mbf"],
  ["fto", "fto"],
]);

const scrTypes = new Map<EventId, string>(
  [...events].map(([scrType, event]) => [event, scrType]),
);

/**
 * The puzzle a csTimer session becomes. `known` is false when the file names no type or
 * one cubehaus has no puzzle for; such a session becomes 3×3. A 3×3 session named for
 * one-handed solving becomes OH, as csTimer has no separate OH type in older files.
 */
export function eventOfScrType(
  scrType: string | undefined,
  name: string,
): { id: EventId; known: boolean } {
  const event = scrType === undefined ? undefined : events.get(scrType);
  if (!event) return { id: "333", known: false };
  if (event === "333" && /\bOH\b|one.?hand/i.test(name))
    return { id: "333oh", known: true };
  return { id: event, known: true };
}

/** csTimer's scramble type for a puzzle. */
export function scrTypeOf(event: EventId): string {
  return scrTypes.get(event) ?? "333";
}
