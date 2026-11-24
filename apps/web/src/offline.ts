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

  // The same scope works when the app is deployed under a subdirectory.
  const url = `${import.meta.env.BASE_URL}sw.js`;
  let state: OfflineState = "caching";
  let registration: ServiceWorkerRegistration | undefined;
  let applying: ServiceWorker | null = null;
  let stale = false;
  let reloading = false;
  let failed = false;
  // A key or a pointer has been pressed on this page.
  let touched = false;
  // The page has finished loading and a moment has passed.
  let settled = typeof window === "undefined";
  // The person pressed Update, so a reload is expected whatever has been pressed since.
  let asked = false;
  let stalled: ReturnType<typeof setTimeout> | undefined;
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
    // An update the page is about to take quietly is not offered for that moment.
    const next =
      (waiting() || stale) && (touched || settled)
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
      clearTimeout(stalled);
      stalled = setTimeout(() => void unstick(next), 8000);
    } else if (stale) {
      reloading = true;
      location.reload();
    }
  }

  // A browser lets the waiting worker take over only once the old one has nothing left to
  // do, and an old worker that never gets there (a request that never ends) holds the new
  // version back until the browser is restarted. After a few seconds the page stops
  // waiting: it lets go of the old worker and loads again, from the host this time, where
  // the new version is. The caches and the history are not touched, and the page registers
  // the worker again as on a first visit. Not without the host in reach, and under the
  // same rules as any quiet update.
  async function unstick(next: ServiceWorker) {
    if (applying !== next || reloading || !registration) return;
    const allowed =
      !busy() &&
      (asked ||
        !touched ||
        (typeof document !== "undefined" && document.hidden));
    let reachable = false;
    if (allowed && globalThis.navigator.onLine !== false)
      try {
        // The worker script is the one file no worker answers from a cache.
        reachable = (await fetch(url, { cache: "no-store" })).ok;
      } catch {
        // Offline: the update waits.
      }
    if (applying !== next || reloading) return;
    if (!reachable || busy()) {
      // Offered again (`Update`), and tried again at the next quiet moment.
      applying = null;
      asked = false;
      return;
    }
    reloading = true;
    await registration.unregister().catch(() => {});
    location.reload();
  }

  // A new version is taken without a word when nobody can be mid-solve: the page has only
  // just opened and nothing has been pressed yet, or it has been in the background for a
  // while. Otherwise the status line offers it (`Update`).
  //
  // A page that is being reloaded or closed turns hidden too. Taking the update there
  // would activate the new worker after the old one has already answered the reload with
  // the old page, which then runs the old version under the new worker with nothing left
  // to offer. A timer never fires in a page that is gone, so the background case waits.
  let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  function quietUpdate() {
    if (typeof document === "undefined") return;
    if (!(waiting() || stale) || applying || reloading) return;
    // Not in the first moments of a page load: Chromium, told to swap workers then,
    // leaves the new one waiting until the next reload.
    if (!touched && !busy() && settled) return apply();
    if (!document.hidden) {
      clearTimeout(hiddenTimer);
      hiddenTimer = undefined;
    } else
      hiddenTimer ??= setTimeout(() => {
        hiddenTimer = undefined;
        if (document.hidden && !busy()) apply();
      }, 3000);
  }
  if (typeof window !== "undefined") {
    const touch = () => {
      touched = true;
      refreshState();
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

  const register = () =>
    services.register(url, { updateViaCache: "none" }).then((result) => {
      registration = result;
      result.addEventListener("updatefound", refreshState);
      checkBuild();
      refreshState();
      if (typeof window !== "undefined") {
        const settle = () =>
          setTimeout(() => {
            settled = true;
            refreshState();
          }, 1000);
        if (document.readyState === "complete") settle();
        else window.addEventListener("load", settle, { once: true });
      }

      if (typeof window !== "undefined") {
        // The browser's own check after a page load is not relied on: the page asks the
        // host for the worker script itself, when it opens and whenever it is looked at
        // again. One check at a time: a focus and a visibility change come together.
        let checking = false;
        const checkForUpdate = () => {
          if (checking || document.hidden || !navigator.onLine) return;
          checking = true;
          void result
            .update()
            .catch(() => {})
            .finally(() => {
              checking = false;
            });
        };
        window.addEventListener("online", checkForUpdate);
        window.addEventListener("focus", checkForUpdate);
        document.addEventListener("visibilitychange", checkForUpdate);
        // A page brought back from the back-forward cache missed every event while it
        // was frozen, a change of worker included.
        window.addEventListener("pageshow", (event) => {
          if (!(event as PageTransitionEvent).persisted) return;
          checkBuild();
          refreshState();
          checkForUpdate();
        });
        window.setInterval(checkForUpdate, 60_000);
        // On a first visit the worker is installing right now and there is nothing older.
        if (result.active) checkForUpdate();
      }
    }, refreshState);
  if (ready) void ready.then(register);
  else void register();

  return {
    applyUpdate() {
      asked = true;
      apply();
    },
  };
}
