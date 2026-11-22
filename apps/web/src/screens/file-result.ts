import { formatSolve, formatTime, type Solve } from "@cubehaus/core";

export function formatFileResult(solve: Solve, precision: 2 | 3 = 2): string {
  const result = formatSolve(solve, { precision });
  if (solve.event !== "333mbf" || result !== "DNF") return result;
  const { cubesSolved, cubesAttempted, timeMs } = solve;
  if (cubesSolved == null || cubesAttempted == null) return result;
  const time = formatTime(timeMs).replace(/\.\d+$/, "");
  return `DNF (${cubesSolved}/${cubesAttempted} ${time})`;
}
