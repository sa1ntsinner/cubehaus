import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { NativeUpdates, UpdateState } from "./db/native";
import { CHECK_EVERY_MS, runUpdates, TRY_EVERY_MS } from "./updates";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fakeWindow() {
  const target = new EventTarget();
  return Object.assign(target, {
    focus: () => target.dispatchEvent(new Event("focus")),
  });
}

function fakeUpdates(version: string | null, states: UpdateState[]) {
  const calls = { check: 0, apply: [] as boolean[] };
  const updates: NativeUpdates = {
    async check() {
      calls.check++;
      return version;
    },
    async apply(ready) {
      calls.apply.push(ready);
      return ready ? (states.shift() ?? "current") : "waiting";
    },
  };
  return { updates, calls };
}

test("a downloaded release installs only once the timer is ready, then stops asking", async () => {
  const { updates, calls } = fakeUpdates("0.1.0-rc.2", ["applied"]);
  let ready = false;
  const target = fakeWindow();
  const stop = runUpdates(updates, async () => ready, vi.fn(), target);
  expect(calls.check).toBe(0);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(calls.check).toBe(1);
  await vi.advanceTimersByTimeAsync(TRY_EVERY_MS * 3);
  expect(calls.apply).toEqual([false, false, false]);
  ready = true;
  await vi.advanceTimersByTimeAsync(TRY_EVERY_MS);
  expect(calls.apply).toEqual([false, false, false, true]);
  await vi.advanceTimersByTimeAsync(TRY_EVERY_MS * 4);
  expect(calls.apply).toHaveLength(4);
  stop();
});

test("no release: one check at the start and on focus at most once an hour", async () => {
  const { updates, calls } = fakeUpdates(null, []);
  const target = fakeWindow();
  const stop = runUpdates(updates, async () => true, vi.fn(), target);
  await vi.advanceTimersByTimeAsync(15_000);
  target.focus();
  await vi.advanceTimersByTimeAsync(TRY_EVERY_MS * 10);
  expect(calls).toEqual({ check: 1, apply: [] });
  await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
  target.focus();
  await vi.advanceTimersByTimeAsync(0);
  expect(calls.check).toBe(2);
  stop();
});

test("a failed install is reported once and the running version goes on", async () => {
  const onError = vi.fn();
  const updates: NativeUpdates = {
    check: async () => "0.1.0-rc.2",
    apply: async () => {
      throw new Error("signature mismatch");
    },
  };
  const stop = runUpdates(updates, async () => true, onError, fakeWindow());
  await vi.advanceTimersByTimeAsync(15_000 + TRY_EVERY_MS * 5);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenCalledWith("signature mismatch");
  stop();
});
