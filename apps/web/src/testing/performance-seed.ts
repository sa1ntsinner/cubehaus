import { currentSessionKey } from "../db/flow";
import { openDatabase } from "../db/open";
import { sessionSettingsKey } from "../settings";
import {
  performanceName,
  performanceSeedKey,
  performanceSettings,
  performanceSolve,
} from "./performance-data";

export async function provisionPerformanceSeed(count: number): Promise<void> {
  const db = await openDatabase().initial;
  if (db.kind !== "persistent" && db.kind !== "memory")
    throw new Error(`Cannot seed the database: ${db.kind}`);
  const { store } = db;
  const seedKey = performanceSeedKey(count);
  const existing = await store.settings.get(seedKey);
  const saved = existing
    ? (await store.sessions.list()).find((session) => session.id === existing)
    : undefined;
  const session =
    saved ??
    (await store.sessions.create({ name: performanceName, event: "333" }));
  await store.settings.set(seedKey, session.id);
  const chunk = 5000;
  // The stable import identities make it safe to resume an interrupted seed.
  if ((await store.solves.count(session.id)) < count) {
    for (let first = 0; first < count; first += chunk) {
      await store.solves.addImported(
        Array.from({ length: Math.min(chunk, count - first) }, (_, offset) => {
          const solve = performanceSolve(first + offset, session.id, 1);
          return {
            ...solve,
            importSource: "cubehaus-test-seed",
            importHash: solve.id,
          };
        }),
      );
    }
  }
  await store.settings.set(currentSessionKey, session.id);
  await store.settings.set(
    sessionSettingsKey(session.id),
    JSON.stringify(performanceSettings),
  );
  if (db.kind === "persistent") sessionStorage.setItem(seedKey, "ready");
}

export async function provisionGroupedPerformanceSeed(
  count: number,
): Promise<void> {
  const db = await openDatabase().initial;
  if (db.kind !== "persistent" && db.kind !== "memory")
    throw new Error(`Cannot seed the database: ${db.kind}`);
  const { store } = db;
  const ids: string[] = [];
  for (let index = 0; index < 50; index++) {
    const session = await store.sessions.create({
      name: `Practice ${index + 1}`,
      event: "333",
    });
    ids.push(session.id);
  }
  const current = ids[0];
  if (!current) throw new Error("No performance session");
  await store.folders.create("Synthetic performance folder", ids);
  for (let first = 0; first < count; first += 5000) {
    await store.solves.addImported(
      Array.from({ length: Math.min(5000, count - first) }, (_, offset) => {
        const index = first + offset;
        const id = ids[index % ids.length] ?? current;
        const solve = performanceSolve(index, id, 1);
        return {
          ...solve,
          importSource: "cubehaus-test-grouped",
          importHash: solve.id,
        };
      }),
    );
  }
  await store.settings.set(currentSessionKey, current);
  await store.settings.set(
    sessionSettingsKey(current),
    JSON.stringify(performanceSettings),
  );
  if (db.kind === "persistent")
    sessionStorage.setItem(performanceSeedKey(count, true), "ready");
}
