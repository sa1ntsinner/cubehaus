import type { NativeUpdates } from "./db/native";

/** How often a desktop app looks for a newer release, at most (on start and on focus). */
export const CHECK_EVERY_MS = 3_600_000;
/** How often a downloaded release asks whether the timer is safe to leave. */
export const TRY_EVERY_MS = 5_000;

/**
 * The desktop app's updates, run quietly: a check a little after the start and when the
 * window comes back (at most once an hour); once a release is downloaded, every few seconds
 * `ready()` is asked (the timer idle, nothing open, every solve written) and the native side
 * installs it then and relaunches. A failure is reported once and the running version goes
 * on; nothing is shown otherwise.
 */
export function runUpdates(
  updates: NativeUpdates,
  ready: () => Promise<boolean>,
  onError: (reason: string) => void,
  target: Pick<Window, "addEventListener" | "removeEventListener"> = window,
): () => void {
  let stopped = false;
  let lastCheck = -Infinity;
  let waiting: string | null = null;
  let trying: ReturnType<typeof setInterval> | undefined;
  let reported = false;
  const fail = (error: unknown) => {
    if (reported || stopped) return;
    reported = true;
    onError(error instanceof Error ? error.message : String(error));
  };
  const tryApply = async () => {
    if (stopped || waiting === null) return;
    try {
      const state = await updates.apply(await ready());
      if (state !== "waiting") {
        waiting = null;
        clearInterval(trying);
      }
    } catch (error) {
      waiting = null;
      clearInterval(trying);
      fail(error);
    }
  };
  const check = async () => {
    const now = Date.now();
    if (stopped || waiting !== null || now - lastCheck < CHECK_EVERY_MS) return;
    lastCheck = now;
    try {
      waiting = await updates.check();
    } catch (error) {
      fail(error);
      return;
    }
    if (waiting !== null && !stopped)
      trying = setInterval(() => void tryApply(), TRY_EVERY_MS);
  };
  const first = setTimeout(() => void check(), 15_000);
  const focus = () => void check();
  target.addEventListener("focus", focus);
  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(trying);
    target.removeEventListener("focus", focus);
  };
}
