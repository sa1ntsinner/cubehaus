import { type CrossColour, resultValue, type Solve } from "@cubehaus/core";
import { assignColour, type ColourEntry, seedOf } from "@cubehaus/stats";

/**
 * The session's solves that have a cross colour, oldest first, from the newest solves
 * held in memory (newest first) and a solve just made that they may not hold yet.
 */
export function crossHistory(
  newestFirst: readonly Solve[],
  recent: Solve | null,
  sessionId: string | undefined,
): ColourEntry<CrossColour>[] {
  const solves =
    recent &&
    recent.sessionId === sessionId &&
    recent.repeatOf === undefined &&
    !newestFirst.some((solve) => solve.id === recent.id)
      ? [recent, ...newestFirst]
      : newestFirst;
  const entries: ColourEntry<CrossColour>[] = [];
  for (let i = solves.length - 1; i >= 0; i--) {
    const solve = solves[i] as Solve;
    if (solve.crossColour)
      entries.push({ colour: solve.crossColour, value: resultValue(solve) });
  }
  return entries;
}

/**
 * Which colour each scramble's cross is built on. A scramble keeps the colour it was
 * first shown with (a penalty or a late write must not change the mark under the
 * person's eyes), unless that colour has left play.
 */
export function createCrossAssigner() {
  const kept = new Map<string, CrossColour>();
  const remember = (scramble: string, colour: CrossColour) => {
    kept.set(scramble, colour);
    if (kept.size > 500) kept.delete(kept.keys().next().value as string);
  };
  return {
    colourFor(
      scramble: string,
      colours: readonly CrossColour[],
      history: readonly ColourEntry<CrossColour>[],
      seed = seedOf(scramble),
    ): CrossColour {
      const known = kept.get(scramble);
      if (known && colours.includes(known)) return known;
      const { colour } = assignColour({ colours, history, seed });
      remember(scramble, colour);
      return colour;
    },
    /** A drill made for a colour: its scramble is that colour's. */
    keep: remember,
    known: (scramble: string) => kept.get(scramble),
  };
}
