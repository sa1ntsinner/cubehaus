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
 *
 * Split (a choice, off by default): the clock starts when the case is there to be seen,
 * the first press marks it recognised and the clock runs on to the stop, so recognition
 * and execution are two parts of one run. With a picture the clock starts at the frame
 * that shows it and there is no hold; with a scramble the hold and release start it as
 * usual (the case is on the cube by then).
 */
export const HOLD_MS = 300;

export type DrillPhase =
  | "shown"
  | "holding"
  /** Split: the clock runs, waiting for the press that says the case is recognised. */
  | "recognising"
  | "running"
  | "stopped";

export type Drill = {
  phase: DrillPhase;
  picture: boolean;
  split: boolean;
  shownAt: number | null;
  firstDownAt: number | null;
  downAt: number | null;
  startAt: number | null;
  /** Split: the press that marked the case recognised. */
  recognisedAt: number | null;
  result: { recogMs: number | null; execMs: number; split: boolean } | null;
};

export type DrillEvent =
  | { type: "shown"; at: number }
  | { type: "down"; at: number }
  | { type: "up"; at: number };

export const showCase = (picture: boolean, split = false): Drill => ({
  phase: "shown",
  picture,
  split,
  shownAt: null,
  firstDownAt: null,
  downAt: null,
  startAt: null,
  recognisedAt: null,
  result: null,
});

const ms = (from: number, to: number) => Math.max(0, Math.round(to - from));

export function drillStep(state: Drill, event: DrillEvent): Drill {
  switch (event.type) {
    // The frame may come after a quick first press; it still marks when the case showed.
    case "shown":
      if (state.shownAt !== null || state.phase === "stopped") return state;
      if (state.split && state.picture && state.phase === "shown")
        return {
          ...state,
          shownAt: event.at,
          phase: "recognising",
          startAt: event.at,
        };
      return { ...state, shownAt: event.at };
    case "down":
      if (state.phase === "recognising")
        return { ...state, phase: "running", recognisedAt: event.at };
      if (state.phase === "shown") {
        // Split with a picture: nothing to recognise before the frame shows it.
        if (state.split && state.picture) return state;
        return {
          ...state,
          phase: "holding",
          downAt: event.at,
          firstDownAt: state.firstDownAt ?? event.at,
        };
      }
      if (state.phase === "running") {
        const startAt = state.startAt as number;
        if (state.split) {
          const recognisedAt = state.recognisedAt as number;
          return {
            ...state,
            phase: "stopped",
            result: {
              recogMs: ms(startAt, recognisedAt),
              execMs: ms(recognisedAt, event.at),
              split: true,
            },
          };
        }
        const recogMs =
          state.picture && state.shownAt !== null && state.firstDownAt !== null
            ? ms(state.shownAt, state.firstDownAt)
            : null;
        return {
          ...state,
          phase: "stopped",
          result: { recogMs, execMs: ms(startAt, event.at), split: false },
        };
      }
      return state;
    case "up":
      if (state.phase !== "holding") return state;
      if (event.at - (state.downAt as number) < HOLD_MS)
        return { ...state, phase: "shown", downAt: null };
      return {
        ...state,
        phase: state.split ? "recognising" : "running",
        startAt: event.at,
      };
  }
}

/**
 * What the clock on screen reads at `now` (same clock as the events), or null when it
 * does not run. Only for display: results come from drillStep. In a split the count
 * starts again at the press that marks the case recognised, so the figures that stop are
 * the execution the result gives.
 */
export function drillElapsed(state: Drill, now: number): number | null {
  if (state.phase !== "running" && state.phase !== "recognising") return null;
  const from = state.recognisedAt ?? state.startAt;
  return from === null ? null : Math.max(0, now - from);
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
