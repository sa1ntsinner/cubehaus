import { formatSolve, formatTime, type Solve } from "@cubehaus/core";

export function formatFileResult(solve: Solve, precision: 2 | 3 = 2): string {
  const result = formatSolve(solve, { precision });
  if (solve.event !== "333mbf" || result !== "DNF") return result;
  const { cubesSolved, cubesAttempted, timeMs } = solve;
  if (cubesSolved == null || cubesAttempted == null) return result;
  const time = formatTime(timeMs).replace(/\.\d+$/, "");
  return `DNF (${cubesSolved}/${cubesAttempted} ${time})`;
}

/**
 * The result as a screen reader hears it once a solve is finished or its penalty changes:
 * the figures, then what was added or voided, never the `+` mark alone.
 */
export function spokenResult(solve: Solve, precision: 2 | 3 = 2): string {
  const result = formatFileResult(solve, precision);
  if (solve.event === "333fm" || solve.event === "333mbf") return result;
  if (solve.dnf) return `DNF, ${formatTime(solve.timeMs, { precision })}`;
  if (solve.plus2 > 0)
    return `${result.replace(/\+$/, "")}, +${2 * solve.plus2}`;
  return result;
}
