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

test("F2: nothing is made ahead while the page is hidden; asking still makes one", async () => {
  const generate = fake();
  let visible = false;
  const source = createScrambleSource(generate, { active: () => visible });
  source.prefetch("444");
  expect(generate).not.toHaveBeenCalled();
  // A scramble asked for is made, but none is put by for later.
  await expect(source.next("444")).resolves.toBe("444#1");
  expect(generate.mock.calls).toEqual([["444"]]);
  // Shown again: the queue fills to its depth.
  visible = true;
  source.prefetch("444");
  expect(generate.mock.calls).toEqual([["444"], ["444"], ["444"]]);
  await expect(source.next("444")).resolves.toBe("444#2");
});

test("F2: a scramble made ahead is the next one handed out, in order", async () => {
  const generate = fake();
  const source = createScrambleSource(generate);
  source.prefetch("sq1");
  await Promise.resolve();
  await expect(source.next("sq1")).resolves.toBe("sq1#1");
  await expect(source.next("sq1")).resolves.toBe("sq1#2");
  await expect(source.next("sq1")).resolves.toBe("sq1#3");
});

test("F2: keys other than an event (Multi-Blind with its cube count) keep their own queues", async () => {
  const made: string[] = [];
  const source = createScrambleSource(
    async (key: string) => {
      made.push(key);
      return `${key}#${made.filter((k) => k === key).length}`;
    },
    { depth: () => 1 },
  );
  await expect(source.next("333mbf:5")).resolves.toBe("333mbf:5#1");
  await expect(source.next("333mbf:8")).resolves.toBe("333mbf:8#1");
  await expect(source.next("333mbf:5")).resolves.toBe("333mbf:5#2");
  expect(made).toEqual([
    "333mbf:5",
    "333mbf:5",
    "333mbf:8",
    "333mbf:8",
    "333mbf:5",
  ]);
});

test("F2: the scrambles made ahead and not yet handed out can be read, to keep for later", async () => {
  let release: (value: string) => void = () => {};
  let calls = 0;
  const source = createScrambleSource<string>(
    (key) => {
      calls++;
      return calls === 3
        ? new Promise<string>((resolve) => {
            release = resolve;
          })
        : Promise.resolve(`${key}#${calls}`);
    },
    { depth: () => 2 },
  );
  expect(source.ahead()).toEqual({});
  source.prefetch("444");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(source.ahead()).toEqual({ "444": ["444#1", "444#2"] });
  // Handed out, a scramble is no longer kept; one still being made is not listed yet.
  await expect(source.next("444")).resolves.toBe("444#1");
  expect(source.ahead()).toEqual({ "444": ["444#2"] });
  release("444#3");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(source.ahead()).toEqual({ "444": ["444#2", "444#3"] });
});
