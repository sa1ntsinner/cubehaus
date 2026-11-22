import { expect, test, vi } from "vitest";
import { readTestHooks } from "./hooks";

test("normal builds ignore both query hooks", () => {
  vi.stubEnv("VITE_TEST_HOOKS", "0");
  expect(readTestHooks("?dbDelay=1500&dbDrop=1")).toEqual({
    delay: 0,
    drop: false,
  });
  vi.unstubAllEnvs();
});
test("test builds enable the hooks only for valid values", () => {
  vi.stubEnv("VITE_TEST_HOOKS", "1");
  expect(readTestHooks("?dbDelay=1500&dbDrop=1")).toEqual({
    delay: 1500,
    drop: true,
  });
  expect(readTestHooks("?dbDelay=bad&dbDrop=no")).toEqual({
    delay: 0,
    drop: false,
  });
  vi.unstubAllEnvs();
});
