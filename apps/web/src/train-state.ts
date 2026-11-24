import type { OllcpEntry } from "@cubehaus/algs/ollcp";
import {
  type F2lSection,
  type F2lSetId,
  f2lGroups,
  f2lOrder,
  MAIN_BEFORE_REVIEW,
  REVIEW_LIVE_AT,
  type SetId,
  slotOf,
  type TrainerCaseData,
} from "@cubehaus/algs/trainer";

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

/**
 * The choices after choosing `moves`; choosing what the case shows with no choice (the
 * best one, or the one `learnt` keeps) forgets the choice.
 */
export function chooseAlg<A extends { moves: string }>(
  choices: AlgChoices,
  set: string,
  c: WithAlgs<A>,
  moves: string,
  learnt: AlgChoices = {},
): Record<string, string> {
  const next: Record<string, string> = { ...choices };
  const key = choiceKey(set, c.id);
  if (moves === (learnt[key] ?? c.algs[0]?.moves)) delete next[key];
  else next[key] = moves;
  return next;
}

/**
 * The choices to show with: the person's own, and for each case whose main algorithm the
 * review replaced, drilled before the change went live and with no choice of theirs, the
 * old main algorithm, which is what they learnt. It is still among the case's algorithms,
 * so the new one leads the others. Read from the attempts alone, so the same data always
 * gives the same answer.
 */
export function learntChoices(
  choices: AlgChoices,
  set: string,
  attempts: readonly { caseId: string; at: number }[],
): AlgChoices {
  let next: Record<string, string> | null = null;
  for (const { caseId, at } of attempts) {
    const old = MAIN_BEFORE_REVIEW[caseId];
    const key = choiceKey(set, caseId);
    if (!old || at >= REVIEW_LIVE_AT || !caseId.startsWith(`${set}-`)) continue;
    if (key in choices || next?.[key]) continue;
    next ??= { ...choices };
    next[key] = old;
  }
  return next ?? choices;
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

/** F2L's slot sets: front right, front left, back right, back left. */
export type F2lSlot = "fr" | "fl" | "br" | "bl";
const SLOT_SETS = {
  fr: "f2l",
  fl: "f2l-left",
  br: "f2l-back",
  bl: "f2l-back-left",
} as const;
export const setOfSlot = (slot: F2lSlot) => SLOT_SETS[slot];

/** The slot last chosen (setting `trainer.slot`); `left` and `right` from before. */
export function storedSlot(value: string | null): F2lSlot {
  if (value === "left") return "fl";
  if (value === "fr" || value === "fl" || value === "br" || value === "bl")
    return value;
  return "fr";
}

/**
 * A set the trainer shows: the sets `@cubehaus/algs/trainer` loads whole, and OLLCP, whose
 * 331 cases are listed from an index and loaded a group at a time (`@cubehaus/algs/ollcp`).
 */
export type TrainSet = SetId | "ollcp";

/**
 * Sets that stand as one word in the set row, with a quiet choice of member at the far
 * end of Learn's `All` line: F2L's four slots, the last layer oriented alone (OLL) or with
 * its corners placed (OLLCP), the last layer's corners over whole first
 * two layers (COLL) or over two side blocks (CMLL), last slot's two inserts (the pair goes
 * in with R U' R' or with F' U F), and the 2×2's top in one go over a bottom that is
 * solved, swapped side by side, or swapped across. Each remembers the member last chosen.
 */
export const FAMILIES = {
  f2l: {
    key: "trainer.slot",
    choices: ["fr", "fl", "br", "bl"],
    members: ["f2l", "f2l-left", "f2l-back", "f2l-back-left"],
  },
  oll: {
    key: "trainer.oll",
    choices: ["oll", "ollcp"],
    members: ["oll", "ollcp"],
  },
  coll: {
    key: "trainer.corners",
    choices: ["coll", "cmll"],
    members: ["coll", "cmll"],
  },
  ls: {
    key: "trainer.ls",
    choices: ["right", "front"],
    members: ["ls-right", "ls-front"],
  },
  "two-cll": {
    key: "trainer.bottom",
    choices: ["solved", "adj", "diag"],
    members: ["two-cll", "two-adj", "two-diag"],
  },
} as const satisfies Record<
  string,
  { key: string; choices: readonly string[]; members: readonly TrainSet[] }
>;
export type Family = keyof typeof FAMILIES;
export type Choice<F extends Family> = (typeof FAMILIES)[F]["choices"][number];

/** The word in the set row a set stands under: its family, or itself. */
export function familyOf(set: TrainSet): Family | TrainSet {
  for (const [family, { members }] of Object.entries(FAMILIES))
    if ((members as readonly TrainSet[]).includes(set)) return family as Family;
  return set;
}

export function memberOf<F extends Family>(
  family: F,
  choice: Choice<F>,
): TrainSet {
  const f = FAMILIES[family];
  return f.members[
    (f.choices as readonly string[]).indexOf(choice)
  ] as TrainSet;
}

/** The choice a set is in its family. */
export function choiceOf(family: Family, set: TrainSet): string {
  const f = FAMILIES[family];
  return f.choices[(f.members as readonly TrainSet[]).indexOf(set)] as string;
}

/** The member last chosen, as stored; the first when nothing (or nothing known) is. */
export function storedMember<F extends Family>(
  family: F,
  value: string | null,
): Choice<F> {
  if (family === "f2l") return storedSlot(value) as Choice<F>;
  const choices = FAMILIES[family].choices as readonly string[];
  return (
    value !== null && choices.includes(value) ? value : choices[0]
  ) as Choice<F>;
}

/**
 * Case names as Learn and the drill show them: F2L numbered in the learner's order; the
 * 2×2's swapped bottoms by the set row's own words in the interface's language (`Adj 3`,
 * `Сосед 3`), so a title, its tile and what a screen reader hears name the set alike;
 * OLLCP's two cases with nothing to orient by the interface's word for that group
 * (`skip`) in the same form.
 */
export function caseLabels(
  set: TrainSet,
  cases: readonly TrainerCaseData[],
  bottoms?: { adj: string; diag: string },
  skip?: string,
): ReadonlyMap<string, string> {
  if (set === "ollcp")
    return new Map(
      cases.map((c) => [
        c.id,
        skip ? c.label.replace(/^OLL skip-(?=\d+$)/, `${skip} `) : c.label,
      ]),
    );
  if (slotOf(set) !== null)
    return new Map(
      f2lOrder(set as F2lSetId).map((place) => [place.id, place.label]),
    );
  const word =
    set === "two-adj"
      ? bottoms?.adj
      : set === "two-diag"
        ? bottoms?.diag
        : null;
  return new Map(
    cases.map((c) => [
      c.id,
      word ? c.label.replace(/^\S+(?= \d+$)/, word) : c.label,
    ]),
  );
}

/** F2L's list in Learn: the learner's order in four groups. Other sets: one list. */
export function learnGroups(set: TrainSet): F2lSection[] | null {
  return slotOf(set) !== null ? f2lGroups(set as F2lSetId) : null;
}

/**
 * An OLLCP case's number in its group, the name of its tile under the group's heading:
 * `OLL 27-3` is `3`.
 */
export const ollcpMember = (label: string): string =>
  /(\d+)$/.exec(label)?.[1] ?? label;

/**
 * An OLLCP case from the index alone, in the shape every set's cases have: listed, drawn
 * and kept in the drills by its id before its group's algorithms are loaded.
 */
export const ollcpListed = (entry: OllcpEntry): TrainerCaseData => ({
  ...entry,
  algs: [],
  recognise: null,
  subsets: [],
});

/** The OLLCP group a route names (`#/train/ollcp/learn/27`; 0 is the skip), or null. */
export function ollcpGroupOf(segment: string | undefined): number | null {
  if (segment === undefined || !/^\d{1,2}$/.test(segment)) return null;
  const oll = Number(segment);
  return oll <= 57 ? oll : null;
}
