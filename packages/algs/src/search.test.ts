import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { turned } from "./build";
import { collCases, collState } from "./coll";
import { searchLL, tables } from "./search";
import { kpuzzle, verify } from "./verify";

describe("search", () => {
  it("search finds Sune's case in seven turns", async () => {
    const t = tables(await kpuzzle(), "oriented");
    // Sune's case: a cross, corners twisted 2, 2, 2 and one up (OLL 27's key 00000222).
    const top = {
      ep: [0, 1, 2, 3],
      eo: [0, 0, 0, 0],
      cp: [0, 1, 2, 3],
      co: [0, 2, 2, 2],
    };
    const found = searchLL(t, top, { maxDepth: 9, extra: 0, limit: 50 });
    expect(found.length).toBeGreaterThan(0);
    for (const alg of found) expect(alg.split(" ")).toHaveLength(7);
    // Every one of them is accepted by the verifier as an OLL 27 algorithm, at some angle.
    for (const alg of found)
      expect((await verify("oll", "00000222", alg)).ok, alg).toBe(true);
    // The corners-solved goal (COLL) is a stricter one: the Sune shape with the corners
    // in their places needs more than an OLL algorithm's seven turns at most angles.
    const coll = tables(await kpuzzle(), "solved");
    expect(
      searchLL(coll, collState("01230222"), { maxDepth: 7, extra: 0, limit: 5 })
        .length,
    ).toBeGreaterThan(0);
  }, 120_000);
});

/**
 * Writes `candidates/coll-search.json`: for every COLL case and each of its four angles,
 * the shortest algorithms in R, U and F and those one turn longer (up to 12 an angle).
 * Slow (about a minute); run with ALGS_SEARCH=1 when the search or the cases change.
 */
describe.runIf(process.env.ALGS_SEARCH === "1")("COLL search", () => {
  it("writes the COLL candidates our search finds", async () => {
    const t = tables(await kpuzzle(), "solved");
    const out: Record<string, string[]> = {};
    for (const c of collCases()) {
      const found = new Set<string>();
      for (let k = 0; k < 4; k++)
        for (const alg of searchLL(t, turned(collState(c.key), k), {
          maxDepth: 16,
          extra: 1,
          limit: 12,
        }))
          found.add(alg);
      out[c.key] = [...found];
    }
    writeFileSync(
      new URL("./candidates/coll-search.json", import.meta.url),
      `${JSON.stringify(out, null, 2)}\n`,
    );
  }, 1_200_000);
});
