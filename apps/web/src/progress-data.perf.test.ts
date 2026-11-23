import { createStore, migrate } from "@cubehaus/storage";
import { createNodeDb } from "@cubehaus/storage/node";
import { expect, test } from "vitest";
import { progressDetails } from "./progress-data";

/** The least CPU time, in ms, one run of `work` took over `runs` runs. */
async function cpuBestOf(runs: number, work: () => Promise<unknown>) {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) {
    const start = process.cpuUsage();
    await work();
    const { user, system } = process.cpuUsage(start);
    best = Math.min(best, (user + system) / 1000);
  }
  return best;
}

test("loads and computes progress for 100,000 stored solves in under 1 s of CPU", async () => {
  const db = createNodeDb(":memory:");
  try {
    await migrate(db);
    const store = createStore(db, () => 0);
    const session = await store.sessions.create({
      name: "Practice",
      event: "333",
    });
    const count = 100_000;
    const first = new Date(2024, 0, 1, 12).getTime();
    let seed = 42;
    for (let offset = 0; offset < count; offset += 5000) {
      await store.solves.addImported(
        Array.from({ length: 5000 }, (_, i) => {
          const index = offset + i;
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          return {
            id: String(index),
            sessionId: session.id,
            event: session.event,
            timeMs: 5000 + (seed % 25000),
            plus2: Number(index % 97 === 0),
            dnf: index % 31 === 0,
            scramble: "R U",
            startedAt: first + index * 600_000,
            inspectionMs: null,
            comment: null,
            input: "imported",
            importSource: "test",
            importHash: String(index),
          };
        }),
      );
    }
    const ms = await cpuBestOf(5, async () => {
      const loaded = await store.solves.scopedSeries({
        kind: "session",
        id: session.id,
        event: session.event,
      });
      progressDetails(loaded, first + count * 600_000);
    });
    console.info(`Progress for 100,000 solves: ${ms.toFixed(1)} ms of CPU`);
    expect(ms).toBeLessThan(1000);
  } finally {
    await db.close();
  }
});
