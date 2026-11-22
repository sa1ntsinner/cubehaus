import { expect, test, vi } from "vitest";
import { createUndoStack } from "./undo";

test("undo is last in, first out and drops the oldest at the limit", async () => {
  const stack = createUndoStack(2);
  const undo = vi.fn(async (_label: string) => {});
  for (const label of ["one", "two", "three"]) {
    stack.push({ label, undo: () => undo(label) });
  }
  expect(stack.size).toBe(2);
  expect(await stack.undo()).toBe("three");
  expect(await stack.undo()).toBe("two");
  expect(await stack.undo()).toBeNull();
  expect(undo.mock.calls).toEqual([["three"], ["two"]]);
});

test("a failed undo remains available to retry", async () => {
  const stack = createUndoStack();
  const undo = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error("write"));
  stack.push({ label: "edit", undo });
  await expect(stack.undo()).rejects.toThrow("write");
  expect(stack.size).toBe(1);
  expect(await stack.undo()).toBe("edit");
});
