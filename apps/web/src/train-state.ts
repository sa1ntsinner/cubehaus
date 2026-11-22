import { type AttemptLike, weakCases } from "@cubehaus/algs";

/**
 * One drill attempt, from input event timestamps only (a result is the
 * difference of two input events). The case is shown, a key or the screen is held, let
 * go to start, pressed to stop; as on the timer, a hold shorter than HOLD_MS does not
 * start.
 *
 * - Execution: the release that started the clock to the press that stopped it.
 * - Recognition: the frame that first showed the case's picture to the first key down
 *   after it (the frame's timestamp is on the same clock as the events). Only when the
 *   case is shown as a picture: with a scramble the person sees the case on the cube
 *   while scrambling, which nothing here can see.
 */
export const HOLD_MS = 300;

export type DrillPhase = "shown" | "holding" | "running" | "stopped";

export type Drill = {
  phase: DrillPhase;
  picture: boolean;
  shownAt: number | null;
  firstDownAt: number | null;
  downAt: number | null;
  startAt: number | null;
  result: { recogMs: number | null; execMs: number } | null;
};

export type DrillEvent =
  | { type: "shown"; at: number }
  | { type: "down"; at: number }
  | { type: "up"; at: number };

export const showCase = (picture: boolean): Drill => ({
  phase: "shown",
  picture,
  shownAt: null,
  firstDownAt: null,
  downAt: null,
  startAt: null,
  result: null,
});

export function drillStep(state: Drill, event: DrillEvent): Drill {
  switch (event.type) {
    // The frame may come after a quick first press; it still marks when the case showed.
    case "shown":
      return state.shownAt === null && state.phase !== "stopped"
        ? { ...state, shownAt: event.at }
        : state;
    case "down":
      if (state.phase === "shown")
        return {
          ...state,
          phase: "holding",
          downAt: event.at,
          firstDownAt: state.firstDownAt ?? event.at,
        };
      if (state.phase === "running") {
        const startAt = state.startAt as number;
        const recogMs =
          state.picture && state.shownAt !== null && state.firstDownAt !== null
            ? Math.max(0, Math.round(state.firstDownAt - state.shownAt))
            : null;
        return {
          ...state,
          phase: "stopped",
          result: {
            recogMs,
            execMs: Math.max(0, Math.round(event.at - startAt)),
          },
        };
      }
      return state;
    case "up":
      if (state.phase !== "holding") return state;
      if (event.at - (state.downAt as number) < HOLD_MS)
        return { ...state, phase: "shown", downAt: null };
      return { ...state, phase: "running", startAt: event.at };
  }
}

/**
 * Review: only the weak cases, the slow against the set and the often missed
 * (`weakCases`), slowest first.
 */
export const reviewPool = (
  attempts: readonly AttemptLike[],
  caseIds: readonly string[],
): string[] => weakCases(attempts, caseIds);

/** The next weak case, drawn by `draw` (0 to 1), never the same twice running. */
export function reviewCase(
  pool: readonly string[],
  last: string | null,
  draw: number,
): string | null {
  const others = pool.filter((id) => id !== last);
  const from = others.length > 0 ? others : pool;
  return (
    from[Math.min(from.length - 1, Math.floor(draw * from.length))] ?? null
  );
}

/**
 * The algorithm a person chose as theirs for a case, by set and case (`pll/<id>`): what
 * Learn shows first and the drill's answer gives. Stored as the setting `trainer.algs`,
 * so it is in the backup; a choice of an algorithm no longer shipped falls back to the
 * best one.
 */
export type AlgChoices = Readonly<Record<string, string>>;
type WithAlgs<A> = { id: string; algs: readonly A[] };

const choiceKey = (set: string, caseId: string) => `${set}/${caseId}`;

export function myAlg<A extends { moves: string }>(
  c: WithAlgs<A>,
  choices: AlgChoices,
  set = "",
): A {
  const chosen = choices[choiceKey(set, c.id)];
  return (c.algs.find((a) => a.moves === chosen) ?? c.algs[0]) as A;
}

/** The case's other algorithms, best first. */
export function otherAlgs<A extends { moves: string }>(
  c: WithAlgs<A>,
  choices: AlgChoices,
  set = "",
): A[] {
  const mine = myAlg(c, choices, set);
  return c.algs.filter((a) => a !== mine);
}

/** The choices after choosing `moves`; choosing the best one forgets the choice. */
export function chooseAlg<A extends { moves: string }>(
  choices: AlgChoices,
  set: string,
  c: WithAlgs<A>,
  moves: string,
): Record<string, string> {
  const next: Record<string, string> = { ...choices };
  const key = choiceKey(set, c.id);
  if (moves === c.algs[0]?.moves) delete next[key];
  else next[key] = moves;
  return next;
}

export function parseChoices(json: string | null): Record<string, string> {
  try {
    const value: unknown = JSON.parse(json ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}
