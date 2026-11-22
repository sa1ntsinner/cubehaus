export type OfflineState =
  | "unsupported"
  | "caching"
  | "ready"
  | "update-waiting";

export function watchOffline(onChange: (state: OfflineState) => void): {
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
  onChange(state);

  function refreshState() {
    registration?.installing?.addEventListener("statechange", refreshState);
    registration?.waiting?.addEventListener("statechange", refreshState);
    if (applying?.state === "redundant") applying = null;
    const next = registration?.waiting
      ? "update-waiting"
      : services.controller && services.controller === registration?.active
        ? "ready"
        : "caching";
    if (next !== state) {
      state = next;
      onChange(next);
    }
  }

  // A controller change alone can also come from an update in another tab.
  services.addEventListener("controllerchange", () => {
    if (applying && services.controller === applying) {
      applying = null;
      location.reload();
    }
    refreshState();
  });

  // The same scope works when the app is deployed under a subdirectory.
  const url = `${import.meta.env.BASE_URL}sw.js`;
  void services.register(url, { updateViaCache: "none" }).then((result) => {
    registration = result;
    result.addEventListener("updatefound", refreshState);
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

  return {
    applyUpdate() {
      if (applying || !registration?.waiting) return;
      applying = registration.waiting;
      applying.postMessage("SKIP_WAITING");
    },
  };
}
