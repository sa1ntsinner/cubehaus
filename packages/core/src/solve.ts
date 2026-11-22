import type { EventId } from "./events";

export type Penalty = "ok" | "plus2" | "dnf";
export type InputKind = "keyboard" | "touch" | "manual" | "imported";

export interface Solve {
  id: string;
  sessionId: string;
  event: EventId;
  timeMs: number;
  plus2: number;
  dnf: boolean;
  scramble: string;
  startedAt: number;
  inspectionMs: number | null;
  comment: string | null;
  input: InputKind;
  moves?: number | null;
  solution?: string | null;
  cubesSolved?: number | null;
  cubesAttempted?: number | null;
  /**
   * A further attempt on the scramble of an earlier solve: that solve's id. A repeat is
   * stored apart and never counts in the session's statistics.
   */
  repeatOf?: string;
  /** How many live repeats a solve has, when the read counted them. */
  repeats?: number;
}

export function penaltyOf(solve: Pick<Solve, "plus2" | "dnf">): Penalty {
  return solve.dnf ? "dnf" : solve.plus2 > 0 ? "plus2" : "ok";
}

export function effectiveMs(
  solve: Pick<Solve, "timeMs" | "plus2" | "dnf">,
): number {
  return solve.dnf ? Infinity : solve.timeMs + 2000 * solve.plus2;
}

export function inspectionPenalty(inspectionMs: number | null): {
  plus2: number;
  dnf: boolean;
} {
  if (inspectionMs !== null && inspectionMs >= 17000)
    return { plus2: 0, dnf: true };
  return {
    plus2: inspectionMs !== null && inspectionMs >= 15000 ? 1 : 0,
    dnf: false,
  };
}

export function nextPlus2(
  solve: Pick<Solve, "inspectionMs" | "plus2">,
): number {
  const auto = inspectionPenalty(solve.inspectionMs).plus2;
  return solve.plus2 > auto ? auto : auto + 1;
}
