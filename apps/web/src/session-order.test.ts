import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Folder, Session } from "@cubehaus/core";
import { createStore, type Db, migrate } from "@cubehaus/storage";
import { createNodeDb } from "@cubehaus/storage/node";
import { expect, test } from "vitest";
import { type AppView, createAppState } from "./app-state";
import { createPendingJournal, memoryStorage } from "./db/pending";
import { listed, tree } from "./session-order";

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

    // A dropped on B: one folder where B stood, holding B then A.
    const folder = await app.groupSessions([id("B"), id("A")], "F");
    expect(folder).toEqual(expect.any(String));
    expect(shape(app.view)).toEqual(["[F: B, A]", "C"]);
    // [ ] and Alt+1–9 follow the list as shown.
    expect(app.view.sessions.map(({ name }) => name)).toEqual(["B", "A", "C"]);

    // A to the top level before C: the folder is left with B alone and lets it go
    // where the folder stood. Then past C.
    await app.placeItem(
      { kind: "session", id: id("A") },
      { parent: null, before: id("C") },
    );
    expect(shape(app.view)).toEqual(["B", "A", "C"]);
    expect(app.view.folders).toEqual([]);
    await app.placeItem(
      { kind: "session", id: id("A") },
      { parent: null, before: null },
    );
    expect(shape(app.view)).toEqual(["B", "C", "A"]);

    // Each change undoes on its own, newest first; the folder comes back whole.
    await app.undo();
    expect(shape(app.view)).toEqual(["B", "A", "C"]);
    await app.undo();
    expect(shape(app.view)).toEqual(["[F: B, A]", "C"]);
    await app.undo();
    expect(shape(app.view)).toEqual(["A", "B", "C"]);
    expect(app.view.folders).toEqual([]);

    // Again with all three, then A out of it and the folder renamed; it all survives
    // reopening.
    const again =
      (await app.groupSessions([id("B"), id("A"), id("C")], "F")) ?? "";
    await app.placeItem(
      { kind: "session", id: id("A") },
      { parent: null, before: null },
    );
    expect(shape(app.view)).toEqual(["[F: B, C]", "A"]);
    await app.renameFolder(again, "Two by two");
    expect(shape(app.view)).toEqual(["[Two by two: B, C]", "A"]);
    await db.close();
    db = createNodeDb(path);
    app = createAppState(createPendingJournal(memoryStorage()), () => {});
    await app.open({ kind: "persistent", store: createStore(db) });
    expect(shape(app.view)).toEqual(["[Two by two: B, C]", "A"]);

    // A folder placed into a folder is refused and changes nothing.
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

test("an empty folder is not shown", () => {
  expect(
    tree([session("a", "a0")], [folder("E", "a1")]).map(({ kind }) => kind),
  ).toEqual(["session"]);
});
