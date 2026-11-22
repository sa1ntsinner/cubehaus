import { describe, expect, it } from "vitest";
import { keepAwake } from "./wake-lock";

function fakes() {
  const held: { released: boolean }[] = [];
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: (_: "visibilitychange", f: () => void) =>
      listeners.add(f),
    removeEventListener: (_: "visibilitychange", f: () => void) =>
      listeners.delete(f),
  };
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
  return { held, doc, wakeLock, show, tick, listeners };
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
});
