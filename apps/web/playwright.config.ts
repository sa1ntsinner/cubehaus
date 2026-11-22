import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        // Render on the GPU: the CPU is the scarce resource on the dev Mac.
        launchOptions: { args: ["--use-angle=metal"] },
      },
    },
    // Firefox, opt-in with PW_FIREFOX=1: Playwright's Firefox build does not start on macOS
    // 27 ("Could not find profile folder"), so it runs in the Linux image there
    // (docs/release/0.1-acceptance.md). The GPU flag above is Chromium's.
    ...(process.env.PW_FIREFOX === "1"
      ? [{ name: "firefox", use: { browserName: "firefox" as const } }]
      : []),
    {
      name: "webkit",
      use: { browserName: "webkit" },
      // WebKit keeps an origin's file system outside the profile, shared by every WebKit
      // process on the machine (e2e/fixtures.ts): two workers' tests would open, and clear,
      // one database. Chromium's tests still run in parallel.
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
