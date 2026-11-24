import { defineConfig } from "@playwright/test";

// The performance spec measures budgets under a CPU throttle and checks that the throttle
// took effect; a second browser beside it skews both. It has a project of its own that
// waits for every other project, so a full run gives it the machine alone. To run it by
// itself: `playwright test --project=perf --no-deps`.
const perfSpec = /perf\.spec\.ts$/;
const gpu = { args: ["--use-angle=metal"] };
// 4173 unless PW_PORT names another, for a run beside a preview that holds it.
const port = Number(process.env.PW_PORT ?? 4173);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  // Two at most on the dev Mac: Chromium's tests beside WebKit's one.
  workers: 2,
  use: { baseURL: origin, trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      testIgnore: perfSpec,
      use: {
        browserName: "chromium",
        // Render on the GPU: the CPU is the scarce resource on the dev Mac.
        launchOptions: gpu,
      },
    },
    // Firefox, opt-in with PW_FIREFOX=1: Playwright's Firefox build does not start on macOS
    // 27 ("Could not find profile folder"), so it runs in the Linux image there.
    // The GPU flag above is Chromium's.
    ...(process.env.PW_FIREFOX === "1"
      ? [
          {
            name: "firefox",
            testIgnore: perfSpec,
            use: { browserName: "firefox" as const },
          },
        ]
      : []),
    {
      name: "webkit",
      // Only what depends on the engine: touch and gestures, the timer's input, layout,
      // storage, offline and the theme's first paint. The rest is the same code in both,
      // and Chromium runs it (axe and the keyboard walks too: one engine is enough).
      testMatch: /(ios|gestures|timer|layout|storage|offline|theme)\.spec\.ts$/,
      use: { browserName: "webkit" },
      // WebKit keeps an origin's file system outside the profile, shared by every WebKit
      // process on the machine (e2e/fixtures.ts): two workers' tests would open, and clear,
      // one database. Chromium's tests still run in parallel.
      workers: 1,
    },
    {
      name: "perf",
      testMatch: perfSpec,
      use: { browserName: "chromium", launchOptions: gpu },
      dependencies: ["chromium", "webkit"],
      workers: 1,
    },
  ],
  webServer: {
    command: `VITE_TEST_HOOKS=1 pnpm build && pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: origin,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
