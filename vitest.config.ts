import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "apps/*/scripts/**/*.test.mjs",
    ],
    exclude: ["**/node_modules/**", "**/*.browser.test.ts"],
    environment: "node",
    passWithNoTests: true,
  },
});
