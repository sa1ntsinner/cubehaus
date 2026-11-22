/**
 * Keeps the screen awake while the page shows (Screen Wake Lock). The browser drops the
 * lock when the page is hidden; it is asked for again when the page shows. Where there is
 * no wake lock, or the browser refuses, nothing happens. Returns a function that lets go.
 */
type Sentinel = { release(): Promise<void> };
export type WakeLockHost = {
  wakeLock?: { request(type: "screen"): Promise<Sentinel> } | undefined;
};
export type VisibilityHost = {
  visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
};

export function keepAwake(nav: WakeLockHost, doc: VisibilityHost): () => void {
  const wakeLock = nav.wakeLock;
  if (!wakeLock) return () => {};
  let stopped = false;
  let held: Sentinel | null = null;
  const take = () => {
    if (stopped || doc.visibilityState !== "visible") return;
    wakeLock.request("screen").then(
      (sentinel) => {
        if (stopped) void sentinel.release().catch(() => {});
        else held = sentinel;
      },
      () => {},
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
    doc.removeEventListener("visibilitychange", onVisibility);
    void held?.release().catch(() => {});
    held = null;
  };
}
