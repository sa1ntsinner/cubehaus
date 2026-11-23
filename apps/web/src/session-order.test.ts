import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Folder, Session } from "@cubehaus/core";
import { createStore, type Db, migrate } from "@cubehaus/storage";
import { createNodeDb } from "@cubehaus/storage/node";
import { expect, test } from "vitest";
import { type AppView, createAppState } from "./app-state";
import { createPendingJournal, memoryStorage } from "./db/pending";
import { dropPlace, listed, stepPlace, tree } from "./session-order";

/** The top level as listed, a folder as `[name: its sessions]`. */
function shape(view: AppView): string[] {
  return tree(listed(view.sessions, view.current?.id), view.folders).map(
    (node) =>
      node.kind === "folder"
        ? `[${node.folder.name}${node.folder.collapsed ? " ▸" : ""}: ${node.sessions
            .map(({ name }) => name)
            .join(", ")}]`
        : node.session.name,
  );
}

test("group two sessions and undo their order", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cubehaus-order-"));
  const path = join(dir, "order.sqlite");
  let db: Db | undefined = createNodeDb(path);
  try {
    await migrate(db);
    let app = createAppState(createPendingJournal(memoryStorage()), () => {});
    await app.open({ kind: "persistent", store: createStore(db) });
    // The starter session is A; B and C follow.
    await app.renameSession(app.view.sessions[0]?.id ?? "", "A");
    await app.newSession("B", "222");
    await app.newSession("C", "444");
    const id = (name: string) =>
      app.view.sessions.find((session) => session.name === name)?.id ?? "";
    expect(shape(app.view)).toEqual(["A", "B", "C"]);

    // Drop A on B: one folder where B stood, holding B then A.
    const nodes = tree(app.view.sessions, app.view.folders);
    expect(
      dropPlace(
        nodes,
        { kind: "session", id: id("A") },
        { kind: "session", id: id("B") },
        "on",
      ),
    ).toEqual({ kind: "group", target: id("B") });
    const folder = await app.groupSessions([id("B"), id("A")], "F");
    expect(folder).toEqual(expect.any(String));
    expect(shape(app.view)).toEqual(["[F: B, A]", "C"]);
    // [ ] and Alt+1–9 follow the list as shown.
    expect(app.view.sessions.map(({ name }) => name)).toEqual(["B", "A", "C"]);

    // A to the top level before C: the folder is left with B alone and lets it go
    // where the folder stood. Then Alt+Down past C.
    await app.placeItem(
      { kind: "session", id: id("A") },
      { parent: null, before: id("C") },
    );
    expect(shape(app.view)).toEqual(["B", "A", "C"]);
    expect(app.view.folders).toEqual([]);
    await app.stepItem({ kind: "session", id: id("A") }, 1);
    expect(shape(app.view)).toEqual(["B", "C", "A"]);

    // Each change undoes on its own, newest first; the folder comes back whole.
    await app.undo();
    expect(shape(app.view)).toEqual(["B", "A", "C"]);
    await app.undo();
    expect(shape(app.view)).toEqual(["[F: B, A]", "C"]);
    await app.undo();
    expect(shape(app.view)).toEqual(["A", "B", "C"]);
    expect(app.view.folders).toEqual([]);

    // Again with all three, then A out of it, rename and close the folder; it all
    // survives reopening.
    const again =
      (await app.groupSessions([id("B"), id("A"), id("C")], "F")) ?? "";
    await app.stepItem({ kind: "session", id: id("A") }, 1);
    await app.stepItem({ kind: "session", id: id("A") }, 1);
    expect(shape(app.view)).toEqual(["[F: B, C]", "A"]);
    await app.renameFolder(again, "Two by two");
    await app.collapseFolder(again, true);
    expect(shape(app.view)).toEqual(["[Two by two ▸: B, C]", "A"]);
    await db.close();
    db = createNodeDb(path);
    app = createAppState(createPendingJournal(memoryStorage()), () => {});
    await app.open({ kind: "persistent", store: createStore(db) });
    expect(shape(app.view)).toEqual(["[Two by two ▸: B, C]", "A"]);

    // A folder dropped on itself or into a folder is refused and changes nothing.
    const reopened = tree(app.view.sessions, app.view.folders);
    expect(
      dropPlace(
        reopened,
        { kind: "folder", id: again },
        { kind: "folder", id: again },
        "on",
      ),
    ).toBeNull();
    const rows = await db.all("SELECT * FROM session ORDER BY id");
    await expect(
      createStore(db).folders.place({ kind: "folder", id: again }, again, null),
    ).rejects.toThrow(RangeError);
    expect(await db.all("SELECT * FROM session ORDER BY id")).toEqual(rows);
  } finally {
    await db?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

const session = (
  id: string,
  orderKey: string,
  folderId: string | null = null,
): Session => ({
  id,
  name: id,
  event: "333",
  orderKey,
  folderId,
  archived: false,
  createdAt: 1,
});
const folder = (id: string, orderKey: string, collapsed = false): Folder => ({
  id,
  name: id,
  orderKey,
  collapsed,
});

test("Alt+Up and Alt+Down step through the rows as shown, in and out of folders", () => {
  // Top level: F (open: x, y), a, G (closed: z), b.
  const nodes = tree(
    [
      session("x", "a0", "F"),
      session("y", "a1", "F"),
      session("a", "a2"),
      session("z", "a0", "G"),
      session("b", "a4"),
    ],
    [folder("F", "a1"), folder("G", "a3", true)],
  );
  const s = (id: string) => ({ kind: "session" as const, id });
  // Out of the folder at its edges.
  expect(stepPlace(nodes, s("x"), -1)).toEqual({ parent: null, before: "F" });
  expect(stepPlace(nodes, s("y"), 1)).toEqual({ parent: null, before: "a" });
  expect(stepPlace(nodes, s("x"), 1)).toEqual({ parent: "F", before: null });
  // Into an open folder, over a closed one.
  expect(stepPlace(nodes, s("a"), -1)).toEqual({ parent: "F", before: null });
  expect(stepPlace(nodes, s("a"), 1)).toEqual({ parent: null, before: "b" });
  expect(stepPlace(nodes, s("b"), -1)).toEqual({ parent: null, before: "G" });
  // A folder steps over its neighbour; nothing past the ends.
  expect(stepPlace(nodes, { kind: "folder", id: "G" }, -1)).toEqual({
    parent: null,
    before: "a",
  });
  expect(stepPlace(nodes, { kind: "folder", id: "F" }, -1)).toBeNull();
  expect(stepPlace(nodes, s("b"), 1)).toBeNull();
  // An empty folder is not shown.
  expect(
    tree([session("a", "a0")], [folder("E", "a1")]).map(({ kind }) => kind),
  ).toEqual(["session"]);
});

test("drops between rows place, on a row group or join, and a no-op is nothing", () => {
  const nodes = tree(
    [session("x", "a0", "F"), session("y", "a1", "F"), session("a", "a2")],
    [folder("F", "a1")],
  );
  const s = (id: string) => ({ kind: "session" as const, id });
  const f = { kind: "folder" as const, id: "F" };
  // On a session in a folder: join after it. On a folder: last inside.
  expect(dropPlace(nodes, s("a"), s("x"), "on")).toEqual({
    kind: "place",
    parent: "F",
    before: "y",
  });
  expect(dropPlace(nodes, s("a"), f, "on")).toEqual({
    kind: "place",
    parent: "F",
    before: null,
  });
  // Just under an open folder's name is its first place.
  expect(dropPlace(nodes, s("a"), f, "after")).toEqual({
    kind: "place",
    parent: "F",
    before: "x",
  });
  // A folder among a folder's sessions goes beside that folder; never inside.
  expect(dropPlace(nodes, f, s("x"), "on")).toBeNull();
  expect(dropPlace(nodes, f, s("a"), "after")).toEqual({
    kind: "place",
    parent: null,
    before: null,
  });
  // Where it already is: nothing.
  expect(dropPlace(nodes, s("y"), s("x"), "after")).toBeNull();
  expect(dropPlace(nodes, s("a"), f, "before")).toEqual({
    kind: "place",
    parent: null,
    before: "F",
  });
});
