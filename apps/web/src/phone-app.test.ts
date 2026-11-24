import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeDatabase } from "./db/open";
import { inPhoneApp, keepBackupCopy } from "./phone-app";

const backup = (exportedAt: number, solves: string) =>
  `{"format":"cubehaus","version":1,"schema":9,"exportedAt":${exportedAt},"tables":{"solve":[${solves}]}}`;

function host() {
  const listeners = new Set<() => void>();
  return {
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: (_: "visibilitychange", f: () => void) =>
      listeners.add(f),
    removeEventListener: (_: "visibilitychange", f: () => void) =>
      listeners.delete(f),
    hide() {
      this.visibilityState = "hidden";
      for (const f of listeners) f();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the phone app", () => {
  it("keeps its history in the webview's OPFS, not in the desktop's native file", () => {
    vi.stubGlobal("window", globalThis);
    expect(inPhoneApp()).toBe(false);
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true });
    expect(inPhoneApp()).toBe(true);
    expect(nativeDatabase()).toBe(false);
  });
});

describe("keepBackupCopy", () => {
  it("writes after the delay and on hiding, only when the history changed", async () => {
    vi.useFakeTimers();
    let text = backup(1, '{"id":"a"}');
    const written: string[] = [];
    const doc = host();
    let settled = 0;
    const stop = keepBackupCopy(
      async () => text,
      async (t) => void written.push(t),
      doc,
      1000,
      async () => void settled++,
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(written).toHaveLength(1);
    text = backup(2, '{"id":"a"}'); // Only the export time differs.
    doc.hide();
    await vi.advanceTimersByTimeAsync(0);
    expect(written).toHaveLength(1);
    text = backup(3, '{"id":"a"},{"id":"b"}');
    doc.hide();
    await vi.advanceTimersByTimeAsync(0);
    expect(written).toEqual([backup(1, '{"id":"a"}'), text]);
    // Each time the app left, it was told once the copy had settled.
    expect(settled).toBe(2);
    stop();
  });

  it("never replaces the copy with a history that has no solves", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => {});
    keepBackupCopy(async () => backup(1, ""), write, host(), 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).not.toHaveBeenCalled();
  });

  it("tries again after a failed write", async () => {
    vi.useFakeTimers();
    const write = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("disk"))
      .mockResolvedValue();
    const doc = host();
    keepBackupCopy(async () => backup(1, '{"id":"a"}'), write, doc, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    doc.hide();
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(2);
  });
});
