export interface SplitPart {
  name: string;
  durationMs: number;
}

/** csTimer stores the earlier ends in reverse order, with no part names. */
export function splitsFromCsTimer(
  totalMs: number,
  phases: unknown,
): SplitPart[] | undefined {
  if (!Array.isArray(phases) || phases.length === 0) return;
  const parts: SplitPart[] = [];
  let previous = 0;
  for (const end of [...phases].reverse().concat(totalMs)) {
    if (typeof end !== "number" || !Number.isSafeInteger(end) || end < previous)
      return;
    parts.push({ name: String(parts.length + 1), durationMs: end - previous });
    previous = end;
  }
  return parts;
}

/** Read the optional JSON field. Ignore malformed data from a damaged backup. */
export function readSplitParts(
  value: unknown,
  totalMs: number,
): SplitPart[] | undefined {
  if (typeof value !== "string") return;
  try {
    const parts: unknown = JSON.parse(value);
    if (!Array.isArray(parts) || parts.length < 2) return;
    let sum = 0;
    for (const part of parts) {
      if (
        typeof part?.name !== "string" ||
        !part.name.trim() ||
        !Number.isSafeInteger(part.durationMs) ||
        part.durationMs < 0
      )
        return;
      sum += part.durationMs;
    }
    if (sum === totalMs) return parts;
  } catch {
    return;
  }
}
