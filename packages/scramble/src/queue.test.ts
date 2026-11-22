import { EVENTS, type EventId } from "@cubehaus/core";
import { expect, test, vi } from "vitest";
import {
  createScrambleSource,
  defaultDepth,
  ScrambleTimeoutError,
} from "./queue";

function fake() {
  const counts = new Map<EventId, number>();
  return vi.fn(async (event: EventId) => {
    const n = (counts.get(event) ?? 0) + 1;
    counts.set(event, n);
    return `${event}#${n}`;
  });
}

test("next returns the first scramble and refills in the background", async () => {
  const generate = fake();
  const source = createScrambleSource(generate);
  await expect(source.next("333")).resolves.toBe("333#1");
  expect(generate.mock.calls).toEqual([["333"], ["333"]]);
});

test("concurrent requests receive distinct scrambles in order", async () => {
  const source = createScrambleSource(fake());
  const first = source.next("333");
  const second = source.next("333");
  await expect(Promise.all([first, second])).resolves.toEqual([
    "333#1",
    "333#2",
  ]);
});

test("prefetch fills to depth and repeated calls do not overfill", () => {
  const generate = fake();
  const source = createScrambleSource(generate, { depth: defaultDepth });
  source.prefetch("444");
  expect(generate.mock.calls).toEqual([["444"], ["444"]]);
  source.prefetch("444");
  expect(generate).toHaveBeenCalledTimes(2);
});

test("Task 3: prefetches two scrambles for 444, 444bf, 333fm and sq1, and one for every other event", () => {
  const generate = fake();
  const source = createScrambleSource(generate);
  const doubleDepth: EventId[] = ["444", "444bf", "333fm", "sq1"];
  expect(EVENTS.map(({ id }) => id)).toContain("fto");
  for (const { id } of EVENTS) {
    const expected = doubleDepth.includes(id) ? 2 : 1;
    expect(defaultDepth(id), id).toBe(expected);
    generate.mockClear();
    source.prefetch(id);
    expect(generate.mock.calls).toEqual(
      Array.from({ length: expected }, () => [id]),
    );
  }
});

test("propagates failure and retries on the next request", async () => {
  const error = new Error("generation failed");
  const generate = vi
    .fn<(event: EventId) => Promise<string>>()
    .mockRejectedValueOnce(error)
    .mockResolvedValue("333#2");
  const source = createScrambleSource(generate);
  await expect(source.next("333")).rejects.toBe(error);
  expect(generate).toHaveBeenCalledTimes(1);
  await expect(source.next("333")).resolves.toBe("333#2");
  expect(generate).toHaveBeenCalledTimes(3);
});

test("events have independent queues", async () => {
  const source = createScrambleSource(fake());
  await expect(
    Promise.all([source.next("333"), source.next("222")]),
  ).resolves.toEqual(["333#1", "222#1"]);
});

test("times out at 30 seconds, then generates again on the next request", async () => {
  vi.useFakeTimers();
  try {
    const generate = vi
      .fn<(event: EventId) => Promise<string>>()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue("333#2");
    const source = createScrambleSource(generate, {});
    const pending = source.next("333");
    const rejected =
      expect(pending).rejects.toBeInstanceOf(ScrambleTimeoutError);
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.advanceTimersByTimeAsync(29999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(generate).toHaveBeenCalledTimes(1);
    await expect(source.next("333")).resolves.toBe("333#2");
    expect(generate).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("accepts custom depth and timeout options and frees failed prefetch slots", async () => {
  vi.useFakeTimers();
  try {
    const generate = vi.fn(() => new Promise<string>(() => {}));
    const source = createScrambleSource(generate, {
      depth: () => 2,
      timeoutMs: 50,
    });
    source.prefetch("333");
    expect(generate).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(50);
    source.prefetch("333");
    expect(generate).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(50);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("calls onTimeout once for each generate call that times out", async () => {
  vi.useFakeTimers();
  try {
    const onTimeout = vi.fn();
    const generate = vi.fn(() => new Promise<string>(() => {}));
    const source = createScrambleSource(generate, {
      timeoutMs: 50,
      onTimeout,
    });
    const result = source.next("333").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(49);
    expect(onTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBeInstanceOf(ScrambleTimeoutError);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test("onTimeout runs before the next generate call", async () => {
  vi.useFakeTimers();
  try {
    const order: string[] = [];
    let calls = 0;
    const source = createScrambleSource(
      () => {
        calls += 1;
        order.push(`generate ${calls}`);
        return calls === 1
          ? new Promise<string>(() => {})
          : Promise.resolve("R");
      },
      { timeoutMs: 50, onTimeout: () => order.push("timeout") },
    );
    const first = source.next("333").catch(() => null);
    await vi.advanceTimersByTimeAsync(50);
    await first;
    expect(await source.next("333")).toBe("R");
    expect(order.slice(0, 3)).toEqual(["generate 1", "timeout", "generate 2"]);
  } finally {
    vi.useRealTimers();
  }
});
