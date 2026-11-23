import { defineConfig } from "@playwright/test";

// The performance spec measures budgets under a CPU throttle and checks that the throttle
// took effect; a second browser beside it skews both. It has a project of its own that
// waits for every other project, so a full run gives it the machine alone. To run it by
// itself: `playwright test --project=perf --no-deps`.
const perfSpec = /perf\.spec\.ts$/;
const gpu = { args: ["--use-angle=metal"] };

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
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
    // 27 ("Could not find profile folder"), so it runs in the Linux image there
    // (docs/release/0.1-acceptance.md). The GPU flag above is Chromium's.
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
      testIgnore: perfSpec,
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
    command: "VITE_TEST_HOOKS=1 pnpm build && pnpm preview",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
