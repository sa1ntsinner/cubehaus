import { DefaultScheduler, Rating } from "ts-fsrs";

/**
 * Spaced repetition for the trainer, graded from what the person did, never from what
 * they say about it.
 *
 * - A grade comes from the attempt: `again` when the person marked it missed (M);
 *   otherwise the execution time against their own median for that case over its last
 *   12 clean attempts (from 3 of them; before that `good`): above 1.5 times `hard`,
 *   below 0.8 times `easy`, else `good`.
 * - Each case being learnt has one FSRS card (ts-fsrs `DefaultScheduler`, FSRS-7,
 *   desired retention 0.9, no fuzz, so the same history always gives the same days).
 * - What comes next: the cases due now, earliest first; then the rest, least likely to
 *   be remembered first; never the same case twice running when another is there.
 * - Weak cases (Review): a median above 1.25 times the median of the set's medians, or
 *   two misses among the case's last five attempts.
 */
export type Grade = "again" | "hard" | "good" | "easy";

export type AttemptLike = {
  caseId: string;
  execMs: number;
  missed: boolean;
  at: number;
};

export const SLOW = 1.5;
export const FAST = 0.8;
export const WEAK = 1.25;
const WINDOW = 12;

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** The median execution of a case's last 12 clean attempts, or null under 3 of them. */
export function caseMedian(
  attempts: readonly AttemptLike[],
  caseId: string,
): number | null {
  const clean = attempts
    .filter((a) => a.caseId === caseId && !a.missed)
    .slice(-WINDOW)
    .map((a) => a.execMs);
  return clean.length < 3 ? null : median(clean);
}

/** The grade of an attempt, against the attempts of its case that came before it. */
export function gradeOf(
  execMs: number,
  missed: boolean,
  before: readonly AttemptLike[],
  caseId: string,
): Grade {
  if (missed) return "again";
  const typical = caseMedian(before, caseId);
  if (typical === null) return "good";
  const ratio = execMs / typical;
  return ratio > SLOW ? "hard" : ratio < FAST ? "easy" : "good";
}

type Scheduler = Awaited<ReturnType<typeof DefaultScheduler>>;
/** A card as the scheduler made it; its exact type is the library's and is passed back opaque. */
type Card = { dueAt: Date; lastReviewAt: Date | null };
let made: Promise<Scheduler> | undefined;
const scheduler = () => {
  made ??= DefaultScheduler({ desiredRetention: 0.9, enableFuzz: false });
  return made;
};

const RATING = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
} as const;

/** A card as stored: JSON, with its dates as ISO strings. */
function revive(json: string): Card {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const date = (v: unknown) => (typeof v === "string" ? new Date(v) : v);
  return {
    ...raw,
    dueAt: date(raw.dueAt),
    lastReviewAt: raw.lastReviewAt == null ? null : date(raw.lastReviewAt),
  } as Card;
}

export type Scheduled = { card: string; dueAt: number };

/** A new case's card, due at once. */
export async function newCard(caseId: string, now: number): Promise<Scheduled> {
  const s = await scheduler();
  const card = { ...s.newCard({ now: new Date(now) }), cardId: caseId };
  return { card: JSON.stringify(card), dueAt: card.dueAt.getTime() };
}

/** The card after an attempt graded `grade` at `now`. */
export async function review(
  card: string,
  grade: Grade,
  now: number,
): Promise<Scheduled> {
  const s = await scheduler();
  const next: Card = s.review({
    card: revive(card) as never,
    grade: RATING[grade],
    now: new Date(now),
  }).card;
  return { card: JSON.stringify(next), dueAt: next.dueAt.getTime() };
}

/** How likely the case is remembered at `now`, 0 to 1 (1 for a card never reviewed). */
export async function recall(card: string, now: number): Promise<number> {
  const s = await scheduler();
  const c = revive(card);
  if (c.lastReviewAt === null) return 1;
  const days = (now - (c.lastReviewAt as Date).getTime()) / 86_400_000;
  return s.model.forgettingCurve(c as never, Math.max(0, days)) as number;
}

export type Queued = { caseId: string; dueAt: number; recall: number };

/** The case to show next, or null when there is none. */
export function nextCase(
  cases: readonly Queued[],
  now: number,
  last: string | null,
): string | null {
  const others = cases.filter((c) => c.caseId !== last);
  const pool = others.length > 0 ? others : cases;
  const due = pool
    .filter((c) => c.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt || (a.caseId < b.caseId ? -1 : 1));
  if (due[0]) return due[0].caseId;
  const rest = [...pool].sort(
    (a, b) => a.recall - b.recall || (a.caseId < b.caseId ? -1 : 1),
  );
  return rest[0]?.caseId ?? null;
}

/** The cases that are slow against the set or often missed, slowest first. */
export function weakCases(
  attempts: readonly AttemptLike[],
  caseIds: readonly string[],
): string[] {
  const medians = new Map<string, number>();
  for (const id of caseIds) {
    const m = caseMedian(attempts, id);
    if (m !== null) medians.set(id, m);
  }
  const setMedian = median([...medians.values()]);
  const weak: { id: string; ratio: number }[] = [];
  for (const id of caseIds) {
    const last5 = attempts.filter((a) => a.caseId === id).slice(-5);
    const misses = last5.filter((a) => a.missed).length;
    const m = medians.get(id);
    const ratio = m !== undefined && setMedian ? m / setMedian : 0;
    if (misses >= 2 || (medians.size >= 3 && ratio > WEAK))
      weak.push({ id, ratio: misses >= 2 ? Number.POSITIVE_INFINITY : ratio });
  }
  return weak
    .sort((a, b) => b.ratio - a.ratio || (a.id < b.id ? -1 : 1))
    .map((w) => w.id);
}
