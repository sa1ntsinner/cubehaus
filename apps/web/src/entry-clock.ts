const limitMs = 60 * 60 * 1000;
const warningMs = 55 * 60 * 1000;

export function fmClock(elapsedMs: number): {
  text: string;
  warn: boolean;
  over: boolean;
} {
  const seconds = Math.max(0, Math.ceil((limitMs - elapsedMs) / 1000));
  return {
    text: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
    warn: elapsedMs >= warningMs,
    over: elapsedMs >= limitMs,
  };
}
