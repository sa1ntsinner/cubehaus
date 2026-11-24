import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { solve333 } from "@cubehaus/scramble/cubing";
import { describe, expect, it } from "vitest";
import { ollcpCases, ollcpScramble, searchCase } from "./ollcp";
import { tables } from "./search";
import { kpuzzle } from "./verify";

/**
 * Writes OLLCP's candidates and drill scrambles. The search is heavy (331 cases, each
 * from four angles), so it runs in shares and can be stopped: every case's result goes to
 * its own file under node_modules/.cache/ollcp and a case with a file is not searched
 * again. Run eight shares side by side, then the merge:
 *
 *   ALGS_SEARCH=1 OLLCP_SHARE=0/8 pnpm exec vitest run packages/algs/src/ollcp-search.test.ts -t "OLLCP search"
 *   ... OLLCP_SHARE=7/8 ...
 *   ALGS_SEARCH=1 pnpm exec vitest run packages/algs/src/ollcp-search.test.ts -t "OLLCP merge"
 *
 * A case's scrambles come from cubing's solver with a seed of the case's own, so a rerun
 * writes the same files.
 */
const cache = new URL("../node_modules/.cache/ollcp/", import.meta.url);
const fileOf = (key: string) => new URL(`${key}.json`, cache);
type Row = { found: number; ms: number; algs: string[]; scrambles: string[] };

describe.runIf(process.env.ALGS_SEARCH === "1")("OLLCP search", () => {
  it("searches one share of the cases", async () => {
    const [share = 0, of = 1] = (process.env.OLLCP_SHARE ?? "0/1")
      .split("/")
      .map(Number);
    mkdirSync(cache, { recursive: true });
    const puzzle = await kpuzzle();
    const t = tables(puzzle, "solved");
    for (const [n, c] of ollcpCases().entries()) {
      if (n % of !== share || existsSync(fileOf(c.key))) continue;
      const started = Date.now();
      const { found, algs } = searchCase(t, c.key);
      const ms = Date.now() - started;
      let seed = 5200 + n;
      const rng = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 2 ** 32;
      };
      const scrambles: string[] = [];
      for (let i = 0; i < 8; i++)
        scrambles.push(await ollcpScramble(puzzle, c.key, rng, solve333));
      const row: Row = { found, ms, algs, scrambles };
      const part = new URL(`${c.key}.part`, cache);
      writeFileSync(part, JSON.stringify(row));
      renameSync(part, fileOf(c.key));
      process.stdout.write(`${c.label}: ${found} found, ${ms} ms\n`);
    }
  }, 86_400_000);
});

describe.runIf(process.env.ALGS_SEARCH === "1")("OLLCP merge", () => {
  it("writes the candidates and the scrambles once every case is searched", () => {
    const searched: Record<string, string[]> = {};
    const scrambles: Record<string, string[]> = {};
    const none: string[] = [];
    let found = 0;
    let ms = 0;
    for (const c of ollcpCases()) {
      expect(existsSync(fileOf(c.key)), `${c.label} is not searched`).toBe(
        true,
      );
      const row = JSON.parse(readFileSync(fileOf(c.key), "utf8")) as Row;
      searched[c.key] = row.algs;
      scrambles[c.key] = row.scrambles;
      found += row.found;
      ms += row.ms;
      if (row.algs.length === 0) none.push(c.label);
    }
    process.stdout.write(
      `OLLCP: ${found} found, ${Math.round(ms / 1000)} s of search, without an algorithm: ${none.join(", ") || "none"}\n`,
    );
    for (const [name, data] of [
      ["ollcp-search", searched],
      ["ollcp-scrambles", scrambles],
    ] as const)
      writeFileSync(
        new URL(`./candidates/${name}.json`, import.meta.url),
        `${JSON.stringify(data, null, 2)}\n`,
      );
  });
});
