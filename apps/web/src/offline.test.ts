import { afterEach, expect, test, vi } from "vitest";
import { watchOffline } from "./offline";

function worker() {
  return Object.assign(new EventTarget(), {
    state: "installing",
    postMessage: vi.fn(),
  });
}

function setup() {
  const registration = Object.assign(new EventTarget(), {
    installing: null as ReturnType<typeof worker> | null,
    active: null as ReturnType<typeof worker> | null,
    waiting: null as ReturnType<typeof worker> | null,
    update: vi.fn().mockResolvedValue(undefined),
  });
  const services = Object.assign(new EventTarget(), {
    controller: null as ReturnType<typeof worker> | null,
    register: vi.fn().mockResolvedValue(registration),
  });
  const reload = vi.fn();
  vi.stubGlobal("navigator", { serviceWorker: services });
  vi.stubGlobal("location", { reload });
  return { registration, services, reload, change: vi.fn() };
}

afterEach(() => vi.unstubAllGlobals());

test("the first install is ready once the page is controlled", async () => {
  const { registration, services, change } = setup();
  const first = worker();
  registration.installing = first;
  watchOffline(change);
  expect(change).toHaveBeenLastCalledWith("caching");
  await Promise.resolve();

  registration.installing = null;
  registration.active = first;
  first.state = "activating";
  first.dispatchEvent(new Event("statechange"));
  expect(change).toHaveBeenLastCalledWith("caching");

  services.controller = first;
  services.dispatchEvent(new Event("controllerchange"));
  expect(change).toHaveBeenLastCalledWith("ready");
});

test("a failed install stays caching and a subsequent visit registers again", async () => {
  const { registration, services, change } = setup();
  const first = worker();
  registration.installing = first;
  watchOffline(change);
  await Promise.resolve();

  registration.installing = null;
  first.state = "redundant";
  first.dispatchEvent(new Event("statechange"));
  expect(change.mock.calls).toEqual([["caching"]]);

  watchOffline(vi.fn());
  expect(services.register).toHaveBeenCalledTimes(2);
});

test("a worker already waiting is reported as an update", async () => {
  const { registration, services, change } = setup();
  registration.active = services.controller = worker();
  registration.waiting = worker();
  watchOffline(change);
  await Promise.resolve();
  expect(change).toHaveBeenLastCalledWith("update-waiting");
});

test("an update found after registration is reported when it finishes installing", async () => {
  const { registration, services, change } = setup();
  registration.active = services.controller = worker();
  watchOffline(change);
  await Promise.resolve();
  expect(change).toHaveBeenLastCalledWith("ready");

  const next = worker();
  registration.installing = next;
  registration.dispatchEvent(new Event("updatefound"));
  expect(change).toHaveBeenLastCalledWith("ready");

  registration.installing = null;
  registration.waiting = next;
  next.state = "installed";
  next.dispatchEvent(new Event("statechange"));
  expect(change).toHaveBeenLastCalledWith("update-waiting");
});

test("applyUpdate messages the waiting worker once and reloads only when it takes control", async () => {
  const { registration, services, reload, change } = setup();
  registration.active = services.controller = worker();
  const next = worker();
  registration.waiting = next;
  const update = watchOffline(change);
  await Promise.resolve();
  expect(reload).not.toHaveBeenCalled();

  update.applyUpdate();
  update.applyUpdate();
  expect(next.postMessage.mock.calls).toEqual([["SKIP_WAITING"]]);
  expect(reload).not.toHaveBeenCalled();

  services.dispatchEvent(new Event("controllerchange"));
  expect(reload).not.toHaveBeenCalled();

  registration.waiting = null;
  registration.active = services.controller = next;
  services.dispatchEvent(new Event("controllerchange"));
  services.dispatchEvent(new Event("controllerchange"));
  expect(reload).toHaveBeenCalledTimes(1);
});

test("a navigator without service workers is unsupported", () => {
  vi.stubGlobal("navigator", {});
  const change = vi.fn();
  watchOffline(change);
  expect(change).toHaveBeenCalledExactlyOnceWith("unsupported");
});

test("the files are fetched for offline use only once the page says it is ready", async () => {
  const { services, change } = setup();
  let ready!: () => void;
  watchOffline(change, {
    ready: new Promise<void>((resolve) => (ready = resolve)),
  });
  await Promise.resolve();
  // The first scramble is not on screen yet: nothing competes with the first load.
  expect(services.register).not.toHaveBeenCalled();
  ready();
  await Promise.resolve();
  await Promise.resolve();
  expect(services.register).toHaveBeenCalledTimes(1);
});

test("a page that turns hidden to reload or close does not take the waiting update", async () => {
  vi.useFakeTimers();
  try {
    const { registration, services } = setup();
    const page = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal("window", Object.assign(new EventTarget(), { setInterval }));
    vi.stubGlobal("document", page);
    registration.active = services.controller = worker();
    const next = worker();
    registration.waiting = next;
    watchOffline(vi.fn());
    window.dispatchEvent(new Event("keydown"));
    await vi.advanceTimersByTimeAsync(0);
    expect(next.postMessage).not.toHaveBeenCalled();

    // Reloading: the old worker already answered with the old page, so a new worker
    // taken now would leave that page on the old version with nothing to offer.
    page.hidden = true;
    page.dispatchEvent(new Event("visibilitychange"));
    expect(next.postMessage).not.toHaveBeenCalled();

    // Still alive and hidden a while later: a tab in the background.
    await vi.advanceTimersByTimeAsync(3000);
    expect(next.postMessage.mock.calls).toEqual([["SKIP_WAITING"]]);
  } finally {
    vi.useRealTimers();
  }
});

test("a failed update is said and goes once the next install succeeds", async () => {
  const { registration, services, change } = setup();
  registration.active = services.controller = worker();
  watchOffline(change);
  await Promise.resolve();

  const broken = worker();
  registration.installing = broken;
  registration.dispatchEvent(new Event("updatefound"));
  registration.installing = null;
  broken.state = "redundant";
  broken.dispatchEvent(new Event("statechange"));
  expect(change).toHaveBeenLastCalledWith("update-failed");

  const next = worker();
  registration.installing = next;
  registration.dispatchEvent(new Event("updatefound"));
  registration.installing = null;
  registration.waiting = next;
  next.state = "installed";
  next.dispatchEvent(new Event("statechange"));
  expect(change).toHaveBeenLastCalledWith("update-waiting");
});
