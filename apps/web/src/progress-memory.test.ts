import { expect, test } from "vitest";
import { recallProgress, rememberProgress } from "./progress-memory";

const sessions = [
  { id: "a", folderId: "f1" },
  { id: "b", folderId: "f2" },
];
const folders = [{ id: "f1" }, { id: "f2" }];

test("Progress opens on the scope last looked at, unless it is gone", () => {
  const folder = rememberProgress({
    mode: "folder",
    selection: "a",
    folderId: "f2",
    event: "222",
    included: undefined,
  });
  expect(recallProgress(folder, sessions, folders)).toEqual({
    mode: "folder",
    selection: "a",
    folderId: "f2",
    event: "222",
    included: undefined,
  });
  // The folder was deleted: back to the open session.
  expect(recallProgress(folder, sessions, [{ id: "f1" }])).toBeNull();
  const picked = rememberProgress({
    mode: "selection",
    selection: "b",
    folderId: "",
    event: "333",
    included: ["a", "gone"],
  });
  expect(recallProgress(picked, sessions, folders)?.included).toEqual(["a"]);
  expect(
    recallProgress(
      rememberProgress({
        mode: "session",
        selection: "gone",
        folderId: "",
        event: undefined,
        included: undefined,
      }),
      sessions,
      folders,
    ),
  ).toBeNull();
  expect(recallProgress("not json", sessions, folders)).toBeNull();
  expect(recallProgress(null, sessions, folders)).toBeNull();
  expect(recallProgress('{"mode":"weird"}', sessions, folders)).toBeNull();
});
