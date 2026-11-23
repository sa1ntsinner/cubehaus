import { type CrossColour, resultValue, type Solve } from "@cubehaus/core";
import {
  ASSIGN,
  assignColour,
  type ColourEntry,
  colourSummary,
  seedOf,
} from "@cubehaus/stats";

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

/** What changed with the scramble on screen: a new colour's block, or the mix beginning. */
export type ColourNews<C extends string> =
  | { kind: "block"; colour: C }
  | { kind: "mixed" };

const isMixed = <C extends string>(
  history: readonly ColourEntry<C>[],
  colours: readonly C[],
) =>
  colourSummary(history, colours).every(({ gap }) => gap <= ASSIGN.mixWithin);

/**
 * One quiet line when the plan changes, said once with the scramble it changes on: a block
 * of another colour begins (the colour furthest behind), or every colour has come within
 * reach of the best and the colours mix from here. Nothing for the first block (nothing
 * is known yet, so it is the person's own colour) or inside a block or the mix.
 */
export function colourNews<C extends string>(
  history: readonly ColourEntry<C>[],
  colours: readonly C[],
  colour: C,
): ColourNews<C> | null {
  const played = history.filter((entry) => colours.includes(entry.colour));
  const last = played.at(-1);
  if (!last || colours.length < 2) return null;
  if (isMixed(played, colours))
    return isMixed(played.slice(0, -1), colours) ? null : { kind: "mixed" };
  return last.colour === colour ? null : { kind: "block", colour };
}
