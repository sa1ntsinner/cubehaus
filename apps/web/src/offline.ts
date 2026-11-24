export type OfflineState =
  | "unsupported"
  | "caching"
  | "ready"
  | "update-waiting"
  | "update-failed";

/**
 * `ready` holds the registration back until the page has what it shows first (the first
 * scramble): installing the worker fetches every file, which would compete with the first
 * load for the network and the CPU.
 *
 * `entry` is the URL of the page's own entry script. The worker in control is asked
 * whether that file is in its build; when it is not, the page is older than its worker
 * (a newer version took over while this page was loading, or from another tab) and is
 * treated like a page with an update waiting.
 *
 * `busy` says the timer is held, inspecting or running: nothing is taken quietly then.
 */
export function watchOffline(
  onChange: (state: OfflineState) => void,
  {
    ready,
    entry,
    busy = () => false,
  }: {
    ready?: Promise<void>;
    entry?: string;
    busy?: () => boolean;
  } = {},
): {
  applyUpdate(): void;
} {
  const services = globalThis.navigator?.serviceWorker;
  if (!services) {
    onChange("unsupported");
    return { applyUpdate() {} };
  }

  let state: OfflineState = "caching";
  let registration: ServiceWorkerRegistration | undefined;
  let applying: ServiceWorker | null = null;
  let stale = false;
  let reloading = false;
  let failed = false;
  const tracked = new WeakSet<ServiceWorker>();
  onChange(state);

  // An update that goes from installing straight to redundant failed (a file missing or
  // altered on the host). The old version keeps working; the status line says so and the
  // next check (focus, online, every minute) installs again.
  function track(next: ServiceWorker | null | undefined) {
    if (!next || tracked.has(next)) return;
    tracked.add(next);
    let previous = next.state;
    next.addEventListener("statechange", () => {
      if (
        next.state === "redundant" &&
        previous === "installing" &&
        services.controller
      )
        failed = true;
      if (next.state === "installed" || next.state === "activated")
        failed = false;
      previous = next.state;
      refreshState();
    });
  }

  // On a first visit the new worker passes through `waiting` on its way to taking control;
  // only a worker waiting behind another one is an update.
  const waiting = () =>
    services.controller ? (registration?.waiting ?? null) : null;

  function refreshState() {
    track(registration?.installing);
    track(registration?.waiting);
    if (applying?.state === "redundant") applying = null;
    const next =
      waiting() || stale
        ? "update-waiting"
        : failed
          ? "update-failed"
          : services.controller && services.controller === registration?.active
            ? "ready"
            : "caching";
    if (next !== state) {
      state = next;
      onChange(next);
    }
    quietUpdate();
  }

  function apply() {
    if (applying || reloading) return;
    const next = waiting();
    if (next) {
      applying = next;
      applying.postMessage("SKIP_WAITING");
    } else if (stale) {
      reloading = true;
      location.reload();
    }
  }

  // A new version is taken without a word when nobody can be mid-solve: the page has only
  // just opened and nothing has been pressed yet, or it has been in the background for a
  // while. Otherwise the status line offers it (`Update`).
  //
  // A page that is being reloaded or closed turns hidden too. Taking the update there
  // would activate the new worker after the old one has already answered the reload with
  // the old page, which then runs the old version under the new worker with nothing left
  // to offer. A timer never fires in a page that is gone, so the background case waits.
  let touched = false;
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  function quietUpdate() {
    if (typeof document === "undefined") return;
    if (!(waiting() || stale) || applying || reloading) return;
    if (!touched && !busy()) return apply();
    clearTimeout(hiddenTimer);
    if (document.hidden)
      hiddenTimer = setTimeout(() => {
        if (document.hidden && !busy()) apply();
      }, 3000);
  }
  if (typeof window !== "undefined") {
    const touch = () => {
      touched = true;
    };
    window.addEventListener("keydown", touch, { once: true, capture: true });
    window.addEventListener("pointerdown", touch, {
      once: true,
      capture: true,
    });
    document.addEventListener("visibilitychange", quietUpdate);
  }

  function checkBuild() {
    const controller = services.controller;
    if (!entry || !controller || stale) return;
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      channel.port1.close();
      if (event.data === false && services.controller === controller) {
        stale = true;
        refreshState();
      }
    };
    // A worker from before this check never answers, which reads as "same build".
    controller.postMessage({ type: "HAS_FILE", url: entry }, [channel.port2]);
  }

  // A controller change alone can also come from an update in another tab.
  services.addEventListener("controllerchange", () => {
    if (applying && services.controller === applying) {
      applying = null;
      reloading = true;
      location.reload();
      return;
    }
    checkBuild();
    refreshState();
  });

  // The same scope works when the app is deployed under a subdirectory.
  const url = `${import.meta.env.BASE_URL}sw.js`;
  const register = () =>
    services.register(url, { updateViaCache: "none" }).then((result) => {
      registration = result;
      result.addEventListener("updatefound", refreshState);
      checkBuild();
      refreshState();

      if (typeof window !== "undefined") {
        const checkForUpdate = () => {
          if (!document.hidden && navigator.onLine)
            void result.update().catch(() => {});
        };
        window.addEventListener("online", checkForUpdate);
        window.addEventListener("focus", checkForUpdate);
        window.setInterval(checkForUpdate, 60_000);
      }
    }, refreshState);
  if (ready) void ready.then(register);
  else void register();

  return {
    applyUpdate() {
      apply();
    },
  };
}
