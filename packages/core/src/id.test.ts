import { expect, test } from "vitest";
import { newId } from "./index";

test("generates a UUIDv7", () => {
  expect(newId(1_700_000_000_000)).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});
test("sorts by timestamp", () => {
  expect(newId(1000) < newId(2000)).toBe(true);
});
test("generates distinct IDs in the same millisecond", () => {
  expect(new Set(Array.from({ length: 1000 }, () => newId(5000))).size).toBe(
    1000,
  );
});
