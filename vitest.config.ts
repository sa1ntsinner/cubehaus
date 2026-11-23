import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "apps/*/scripts/**/*.test.mjs",
    ],
    // Performance budgets run on their own, one file at a time: `pnpm test:perf`.
    exclude: [
      "**/node_modules/**",
      "**/*.browser.test.ts",
      "**/*.perf.test.ts",
    ],
    environment: "node",
    passWithNoTests: true,
    // The dev Mac has 8 performance and 4 efficiency cores and is in use while the suite
    // runs. One worker per core starved the searches and timed them out; six leaves room
    // for the person at the keyboard and finishes in about the same time.
    maxWorkers: 6,
    // A wall-clock limit proves nothing about correctness. The default is generous so a
    // loaded machine does not fail a correct test; searches set their own, longer limits.
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
