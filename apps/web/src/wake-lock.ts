/**
 * Keeps the screen awake while the page shows (Screen Wake Lock). The browser drops the
 * lock when the page is hidden; it is asked for again when the page shows. Safari refuses
 * a lock asked for without a user gesture (NotAllowedError, as at load): then it is asked
 * for again at the next touch or key. Where there is no wake lock, or the browser refuses
 * for another reason, nothing happens. Returns a function that lets go.
 */
type Sentinel = { release(): Promise<void> };
export type WakeLockHost = {
  wakeLock?: { request(type: "screen"): Promise<Sentinel> } | undefined;
};
type HostEvent = "visibilitychange" | (typeof gestures)[number];
export type VisibilityHost = {
  visibilityState: DocumentVisibilityState;
  addEventListener(type: HostEvent, listener: () => void): void;
  removeEventListener(type: HostEvent, listener: () => void): void;
};

/** Events that carry a user gesture, after which a refused lock is asked for again. */
const gestures = ["pointerup", "keyup"] as const;

export function keepAwake(nav: WakeLockHost, doc: VisibilityHost): () => void {
  const wakeLock = nav.wakeLock;
  if (!wakeLock) return () => {};
  let stopped = false;
  let held: Sentinel | null = null;
  let waiting = false;
  const unwait = () => {
    if (!waiting) return;
    waiting = false;
    for (const type of gestures) doc.removeEventListener(type, onGesture);
  };
  const onGesture = () => {
    unwait();
    take();
  };
  const take = () => {
    if (stopped || doc.visibilityState !== "visible") return;
    wakeLock.request("screen").then(
      (sentinel) => {
        if (stopped) void sentinel.release().catch(() => {});
        else held = sentinel;
      },
      (error: unknown) => {
        if (stopped || waiting) return;
        if ((error as { name?: unknown } | null)?.name !== "NotAllowedError")
          return;
        waiting = true;
        for (const type of gestures) doc.addEventListener(type, onGesture);
      },
    );
  };
  const onVisibility = () => {
    if (doc.visibilityState === "visible") take();
    else held = null;
  };
  doc.addEventListener("visibilitychange", onVisibility);
  take();
  return () => {
    stopped = true;
    unwait();
    doc.removeEventListener("visibilitychange", onVisibility);
    void held?.release().catch(() => {});
    held = null;
  };
}
