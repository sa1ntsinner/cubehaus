import { describe, expect, it } from "vitest";
import { keepAwake } from "./wake-lock";

function fakes() {
  const held: { released: boolean }[] = [];
  const listeners = new Set<() => void>();
  const gestures = new Map<string, Set<() => void>>();
  const doc = {
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: (type: string, f: () => void) => {
      if (type === "visibilitychange") listeners.add(f);
      else gestures.set(type, (gestures.get(type) ?? new Set()).add(f));
    },
    removeEventListener: (type: string, f: () => void) => {
      if (type === "visibilitychange") listeners.delete(f);
      else gestures.get(type)?.delete(f);
    },
  };
  const gesture = (type: string) => {
    for (const f of [...(gestures.get(type) ?? [])]) f();
  };
  const waiting = () =>
    [...gestures.values()].reduce((n, set) => n + set.size, 0);
  const wakeLock = {
    request: async (type: "screen") => {
      expect(type).toBe("screen");
      const sentinel = { released: false };
      held.push(sentinel);
      return {
        release: async () => {
          sentinel.released = true;
        },
      };
    },
  };
  const show = (state: DocumentVisibilityState) => {
    doc.visibilityState = state;
    // A hidden page loses its lock without asking.
    if (state === "hidden") for (const s of held) s.released = true;
    for (const f of listeners) f();
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { held, doc, wakeLock, show, tick, listeners, gesture, waiting };
}

describe("keep the screen awake", () => {
  it("holds the lock while the page shows and takes it again when it comes back", async () => {
    const f = fakes();
    const stop = keepAwake({ wakeLock: f.wakeLock }, f.doc);
    await f.tick();
    expect(f.held.filter((s) => !s.released)).toHaveLength(1);
    f.show("hidden");
    await f.tick();
    expect(f.held.filter((s) => !s.released)).toHaveLength(0);
    f.show("visible");
    await f.tick();
    expect(f.held.filter((s) => !s.released)).toHaveLength(1);
    stop();
    await f.tick();
    expect(f.held.filter((s) => !s.released)).toHaveLength(0);
    expect(f.listeners.size).toBe(0);
  });

  it("does nothing where the browser has no wake lock, or refuses it", async () => {
    const f = fakes();
    expect(() => keepAwake({}, f.doc)()).not.toThrow();
    const stop = keepAwake(
      { wakeLock: { request: () => Promise.reject(new Error("denied")) } },
      f.doc,
    );
    await f.tick();
    stop();
  });

  it("a lock that arrives after stop is let go at once", async () => {
    const f = fakes();
    const stop = keepAwake({ wakeLock: f.wakeLock }, f.doc);
    stop();
    await f.tick();
    expect(f.held.filter((s) => !s.released)).toHaveLength(0);
  });

  // Safari refuses a lock asked for without a user gesture (NotAllowedError), as at load.
  it("a lock refused for want of a gesture is asked for again at the next touch or key", async () => {
    const f = fakes();
    let refuse = true;
    const wakeLock = {
      request: (type: "screen") => {
        if (!refuse) return f.wakeLock.request(type);
        const error = new Error("Permission was denied");
        error.name = "NotAllowedError";
        return Promise.reject(error);
      },
    };
    const stop = keepAwake({ wakeLock }, f.doc);
    await f.tick();
    expect(f.held).toHaveLength(0);
    expect(f.waiting()).toBeGreaterThan(0);
    refuse = false;
    f.gesture("pointerup");
    await f.tick();
    expect(f.held.filter((s) => !s.released)).toHaveLength(1);
    expect(f.waiting()).toBe(0);
    stop();
    await f.tick();
    expect(f.held.filter((s) => !s.released)).toHaveLength(0);
  });

  it("stops waiting for a gesture when it is stopped", async () => {
    const f = fakes();
    const error = new Error("Permission was denied");
    error.name = "NotAllowedError";
    const stop = keepAwake(
      { wakeLock: { request: () => Promise.reject(error) } },
      f.doc,
    );
    await f.tick();
    expect(f.waiting()).toBeGreaterThan(0);
    stop();
    expect(f.waiting()).toBe(0);
    expect(f.listeners.size).toBe(0);
  });
});
