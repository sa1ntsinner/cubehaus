import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { parseCsTimer } from "./cstimer";
import fixture from "./fixtures/cstimer-small.json";
import { importHash } from "./hash";

test("uses the first 16 SHA-256 bytes of the specified UTF-8 fields", async () => {
  const result = parseCsTimer(JSON.stringify(fixture));
  const solve = result.sessions[0]?.solves[2];
  if (!solve) throw new Error("Missing fixture solve");
  const expected = createHash("sha256")
    .update("cstimer\n333\n12345\n0\n1\n1700000002000\nF U\n0")
    .digest("hex")
    .slice(0, 32);
  expect(await importHash("cstimer", "333", solve, 0)).toBe(expected);
});

test("distinguishes occurrences of identical rows and ignores comments", async () => {
  const result = parseCsTimer(JSON.stringify(fixture));
  const first = result.sessions[0]?.solves[4];
  const second = result.sessions[0]?.solves[5];
  if (!first || !second) throw new Error("Missing fixture duplicates");
  const hash = await importHash("cstimer", "333", first, 0);
  expect(await importHash("cstimer", "333", second, 1)).not.toBe(hash);
  expect(
    await importHash("cstimer", "333", { ...second, comment: "Edited" }, 0),
  ).toBe(hash);
});

test("the hash of an imported solve never changes", async () => {
  const result = parseCsTimer(JSON.stringify(fixture));
  const solve = result.sessions[0]?.solves[0];
  if (!solve) throw new Error("Missing fixture solve");
  expect(solve.timeMs).toBe(10510);
  const hash = "d0123e7fcc51e5a2ebcb56882ef1ea3d";
  expect(await importHash("cstimer", "333", solve, 0)).toBe(hash);
  // Split times, extra row items and the row number are not part of the identity.
  expect(
    await importHash(
      "cstimer",
      "333",
      { ...solve, row: 9, phases: [5000], extra: [1] },
      0,
    ),
  ).toBe(hash);
});
