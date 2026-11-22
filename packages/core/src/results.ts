import { eventInfo } from "./events";
import { formatTime } from "./format";
import { effectiveMs, type Solve } from "./solve";

const faceOrWide = /^(?:[rludfb]|2?[rludfb]w)(?:2'?|')?$/i;
const rotation = /^[xyz](?:2'?|')?$/i;

export function countMoves(
  solution: string,
): { obtm: number; etm: number } | { error: string } {
  let obtm = 0;
  let etm = 0;
  for (const move of solution.split(/\s+/)) {
    if (!move) continue;
    if (faceOrWide.test(move)) obtm++;
    else if (!rotation.test(move)) return { error: `Invalid move: ${move}` };
    etm++;
  }
  return { obtm, etm };
}

export function multiPoints(solved: number, attempted: number): number | null {
  if (
    !Number.isInteger(solved) ||
    !Number.isInteger(attempted) ||
    solved < 2 ||
    attempted < 2 ||
    solved > attempted
  ) {
    return null;
  }
  const points = solved - (attempted - solved);
  return points < 0 ? null : points;
}

export function multiLimitMs(attempted: number): number {
  return Math.min(attempted, 6) * 600000;
}

export function multiValue(
  solved: number,
  attempted: number,
  timeMs: number,
): number {
  const points = multiPoints(solved, attempted);
  if (points === null || !Number.isFinite(timeMs) || timeMs < 0)
    return Infinity;
  // WCA export format 0DDTTTTTMM: inverted points, seconds, missed cubes.
  const seconds = Math.floor(timeMs / 1000);
  return (99 - points) * 10000000 + seconds * 100 + (attempted - solved);
}

export function formatMulti(
  solved: number,
  attempted: number,
  timeMs: number,
): string {
  const time = formatTime(timeMs).replace(/\.\d+$/, "");
  if (multiPoints(solved, attempted) === null || time === "DNF") return "DNF";
  return `${solved}/${attempted} ${time}`;
}

// The other way: a value from multiValue back to "3/5 40:30".
export function formatMultiValue(value: number): string {
  if (!Number.isFinite(value)) return value === Infinity ? "DNF" : "";
  const points = 99 - Math.floor(value / 10000000);
  const seconds = Math.floor((value % 10000000) / 100);
  const missed = value % 100;
  return formatMulti(points + missed, points + 2 * missed, seconds * 1000);
}

export function formatMoves(
  value: number,
  options?: { mean?: boolean },
): string {
  if (value === Infinity) return "DNF";
  if (!Number.isFinite(value)) return "";
  return value.toFixed(options?.mean ? 2 : 0);
}

export function formatSolve(
  solve: Pick<Solve, "timeMs" | "plus2" | "dnf"> &
    Partial<Pick<Solve, "event" | "moves" | "cubesSolved" | "cubesAttempted">>,
  options?: { precision?: 2 | 3 },
): string {
  if (solve.event === "333fm") {
    return formatMoves(solve.dnf ? Infinity : (solve.moves ?? Infinity));
  }
  if (solve.event === "333mbf") {
    return formatMulti(
      solve.cubesSolved ?? 0,
      solve.cubesAttempted ?? 0,
      effectiveMs(solve),
    );
  }
  return (
    formatTime(effectiveMs(solve), options) +
    (!solve.dnf && solve.plus2 > 0 ? "+" : "")
  );
}

export function resultValue(solve: Solve): number {
  if (solve.dnf) return Infinity;
  switch (eventInfo(solve.event).kind) {
    case "moves":
      return solve.moves ?? Infinity;
    case "multi":
      return multiValue(
        solve.cubesSolved ?? 0,
        solve.cubesAttempted ?? 0,
        effectiveMs(solve),
      );
    case "time":
      return effectiveMs(solve);
  }
}
