import { afterEach, beforeEach, expect, test, vi } from "vitest";

let workers: FakeWorker[];
let version: number;
class FakeWorker extends EventTarget {
  terminated = false;
  constructor() {
    super();
    workers.push(this);
  }
  postMessage(request: { id: number; method: string; args: unknown[] }) {
    let result: unknown;
    if (request.method === "open") {
      result = (request.args[0] as { opfs: boolean }).opfs
        ? { kind: "persistent" }
        : { kind: "memory", reason: "Unavailable" };
    } else if (request.method === "all") result = [{ user_version: version }];
    queueMicrotask(() =>
      this.dispatchEvent(
        new MessageEvent("message", { data: { id: request.id, result } }),
      ),
    );
  }
  terminate() {
    this.terminated = true;
  }
}
let page: EventTarget;
let persist: ReturnType<typeof vi.fn>;
let request: ReturnType<typeof vi.fn>;
let released: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => {
  vi.resetModules();
  workers = [];
  version = 0;
  page = new EventTarget();
  persist = vi.fn().mockResolvedValue(false);
  released = vi.fn();
  request = vi.fn(async (_name, _options, callback) => {
    await callback({ name: "cubehaus-db" });
    released();
  });
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("window", page);
  vi.stubGlobal("location", { search: "", reload: vi.fn() });
  vi.stubGlobal("navigator", {
    locks: { request },
    storage: { getDirectory: vi.fn(), persist },
  });
});
afterEach(() => {
  page.dispatchEvent(new Event("pagehide"));
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function deferLock() {
  vi.useFakeTimers();
  let grant = () => {};
  request.mockImplementation(
    async (_name, { signal }: LockOptions, callback) => {
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(signal?.reason);
        signal?.addEventListener("abort", abort, { once: true });
        grant = () => {
          signal?.removeEventListener("abort", abort);
          resolve();
        };
      });
      await callback({ name: "cubehaus-db" });
      released();
    },
  );
  return () => grant();
}

test("persistent open migrates, asks persist once, and holds the lock until pagehide", async () => {
  const { openDatabase } = await import("./open");
  const first = openDatabase();
  expect(openDatabase()).toBe(first);
  expect((await first.initial).kind).toBe("persistent");
  expect(await first.ready).toBe(await first.initial);
  expect(request).toHaveBeenCalledWith(
    "cubehaus-db",
    { signal: expect.any(AbortSignal) },
    expect.any(Function),
  );
  expect(persist).toHaveBeenCalledTimes(1);
  expect(released).not.toHaveBeenCalled();
  page.dispatchEvent(new Event("pagehide"));
  await vi.waitFor(() => expect(released).toHaveBeenCalledTimes(1));
  expect(workers[0]?.terminated).toBe(true);
});
test("a lock granted after 200 ms opens without reporting busy", async () => {
  const { openDatabase } = await import("./open");
  const grant = deferLock();
  const { initial, ready } = openDatabase();
  const report = vi.fn();
  void initial.then(report);
  await vi.advanceTimersByTimeAsync(200);
  expect(report).not.toHaveBeenCalled();
  expect(workers).toHaveLength(0);
  grant();
  expect(await initial).toMatchObject({ kind: "persistent" });
  expect(await ready).toBe(await initial);
  expect(report).toHaveBeenCalledExactlyOnceWith(await ready);
});

test("a lock granted after the grace period reports busy and then opens", async () => {
  const { LOCK_GRACE_MS, openDatabase } = await import("./open");
  const grant = deferLock();
  const { initial, ready } = openDatabase();
  await vi.advanceTimersByTimeAsync(LOCK_GRACE_MS);
  expect(await initial).toEqual({ kind: "busy" });
  expect(workers).toHaveLength(0);
  grant();
  expect(await ready).toMatchObject({ kind: "persistent" });
  expect(workers).toHaveLength(1);
  expect(request).toHaveBeenCalledTimes(1);
});

test("a lock that never arrives stays busy and pagehide cancels the request", async () => {
  const { LOCK_GRACE_MS, openDatabase } = await import("./open");
  deferLock();
  const { initial, ready } = openDatabase();
  const initialReport = vi.fn();
  const report = vi.fn();
  void initial.then(initialReport);
  void ready.then(report);
  await vi.advanceTimersByTimeAsync(LOCK_GRACE_MS - 1);
  expect(initialReport).not.toHaveBeenCalled();
  expect(workers).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(await initial).toEqual({ kind: "busy" });
  await vi.advanceTimersByTimeAsync(LOCK_GRACE_MS * 2);
  expect(workers).toHaveLength(0);
  expect(report).not.toHaveBeenCalled();
  expect(persist).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledTimes(1);
  const signal: AbortSignal = request.mock.calls[0]?.[1].signal;
  expect(signal.aborted).toBe(false);
  page.dispatchEvent(new Event("pagehide"));
  expect(signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(report).not.toHaveBeenCalled();
  page.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
  expect(location.reload).toHaveBeenCalledTimes(1);
});
test("missing OPFS uses memory and ignores persist rejection", async () => {
  Reflect.deleteProperty(navigator.storage, "getDirectory");
  persist.mockRejectedValue(new Error("Refused"));
  const { openDatabase } = await import("./open");
  expect(await openDatabase().initial).toMatchObject({
    kind: "memory",
    reason: "Unavailable",
  });
});

test("missing Web Locks opens in memory without waiting", async () => {
  Reflect.deleteProperty(navigator, "locks");
  const { openDatabase } = await import("./open");
  expect(await openDatabase().initial).toMatchObject({ kind: "memory" });
  expect(request).not.toHaveBeenCalled();
});
test("a newer schema reports failed and releases the worker and lock", async () => {
  version = 999;
  const { openDatabase } = await import("./open");
  expect(await openDatabase().initial).toMatchObject({
    kind: "failed",
    reason: "Database schema 999 is newer than 7",
  });
  await vi.waitFor(() => expect(released).toHaveBeenCalledTimes(1));
  expect(workers[0]?.terminated).toBe(true);
  expect(persist).not.toHaveBeenCalled();
});
