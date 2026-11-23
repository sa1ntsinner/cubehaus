import type { Folder, Session } from "@cubehaus/core";
import { expect, test } from "vitest";
import {
  cleanName,
  folderPreview,
  gridMove,
  layoutRows,
  lonelyFolders,
  moveTo,
  placeAt,
  rowStep,
} from "./session-grid";
import { tree } from "./session-order";

let key = 0;
const session = (
  id: string,
  folderId: string | null = null,
  event: Session["event"] = "333",
): Session => ({
  id,
  name: id,
  event,
  orderKey: `a${String(key++).padStart(3, "0")}`,
  folderId,
  archived: false,
  createdAt: 0,
});
const folder = (id: string, orderKey: string): Folder => ({
  id,
  name: id,
  orderKey,
  collapsed: false,
});

/** A, [F: B, C], D: the folder stands where its key puts it, between A and D. */
function sample() {
  key = 0;
  const a = session("A");
  const b = session("B", "F");
  const c = session("C", "F");
  const d = session("D");
  const f = folder("F", "a0005");
  a.orderKey = "a0001";
  d.orderKey = "a0009";
  return tree([a, b, c, d], [f]);
}

test("a place by index counts the container without the item", () => {
  const nodes = sample();
  // A to the third place of the top level (after F, before D) goes before D.
  expect(placeAt(nodes, { kind: "session", id: "A" }, null, 1)).toEqual({
    parent: null,
    before: "D",
  });
  expect(placeAt(nodes, { kind: "session", id: "A" }, null, 2)).toEqual({
    parent: null,
    before: null,
  });
  // D into the folder, first.
  expect(placeAt(nodes, { kind: "session", id: "D" }, "F", 0)).toEqual({
    parent: "F",
    before: "B",
  });
  // Where it already stands: nothing to do.
  expect(placeAt(nodes, { kind: "session", id: "A" }, null, 0)).toBeNull();
  expect(placeAt(nodes, { kind: "session", id: "C" }, "F", 1)).toBeNull();
  // Folders do not nest.
  expect(placeAt(nodes, { kind: "folder", id: "F" }, "F", 0)).toBeNull();
});

test("Alt with an arrow moves a tile one place or a row, and out of its folder at the edges", () => {
  const nodes = sample();
  expect(gridMove(nodes, { kind: "session", id: "A" }, 1)).toEqual({
    parent: null,
    before: "D",
  });
  expect(gridMove(nodes, { kind: "session", id: "D" }, -1)).toEqual({
    parent: null,
    before: "F",
  });
  // A row of three down from A: past the end, so last.
  expect(gridMove(nodes, { kind: "session", id: "A" }, 3)).toEqual({
    parent: null,
    before: null,
  });
  expect(gridMove(nodes, { kind: "session", id: "A" }, -1)).toBeNull();
  expect(gridMove(nodes, { kind: "folder", id: "F" }, 1)).toEqual({
    parent: null,
    before: null,
  });
  // Inside a folder: among its own, then out before or after the folder's tile.
  expect(gridMove(nodes, { kind: "session", id: "B" }, 1)).toEqual({
    parent: "F",
    before: null,
  });
  expect(gridMove(nodes, { kind: "session", id: "B" }, -1)).toEqual({
    parent: null,
    before: "F",
  });
  expect(gridMove(nodes, { kind: "session", id: "C" }, 1)).toEqual({
    parent: null,
    before: "D",
  });
});

test("a folder left with one session lets it go where the folder stood", () => {
  key = 0;
  const a = session("A");
  const b = session("B", "F");
  const g1 = session("G1", "G");
  const g2 = session("G2", "G");
  const nodes = tree(
    [a, b, g1, g2],
    [folder("F", "a0100"), folder("G", "a0200")],
  );
  expect(lonelyFolders(nodes, ["F", "G"])).toEqual([
    { folderId: "F", sessionId: "B", place: { parent: null, before: "F" } },
  ]);
  // Only a folder a session just left: one made for a single session stays.
  expect(lonelyFolders(nodes, ["G"])).toEqual([]);
});

test("a folder shows the pictures of its first four sessions", () => {
  key = 0;
  const held = [
    session("1", "F", "333"),
    session("2", "F", "222"),
    session("3", "F", "444"),
    session("4", "F", "pyram"),
    session("5", "F", "clock"),
  ];
  expect(folderPreview(held)).toEqual(["333", "222", "444", "pyram"]);
});

test("a name is trimmed, its spaces joined, cut at 64 characters; empty keeps the old one", () => {
  expect(cleanName("  Home   3×3 ")).toBe("Home 3×3");
  expect(cleanName("   ")).toBeNull();
  expect(cleanName("\n\t")).toBeNull();
  expect(cleanName("x".repeat(80))).toBe("x".repeat(64));
  expect(cleanName("Same", "Same")).toBeNull();
});

test("Move to… lists a new folder, the other folders and the way out", () => {
  const nodes = sample();
  expect(moveTo(nodes, { kind: "session", id: "A" })).toEqual([
    { kind: "new" },
    { kind: "folder", id: "F", name: "F" },
  ]);
  expect(moveTo(nodes, { kind: "session", id: "B" })).toEqual([
    { kind: "out", place: { parent: null, before: "D" } },
  ]);
});

test("an open folder's tiles stand in rows of their own under the folder's row", () => {
  // Five tiles in rows of three, the folder f open after its row: a b f / x y / c d.
  const rows = layoutRows(["a", "b", "f", "c", "d"], 3, {
    after: "f",
    keys: ["x", "y"],
  });
  expect(rows).toEqual([
    ["a", "b", "f"],
    ["x", "y"],
    ["c", "d"],
  ]);
  expect(rowStep(rows, "f", "down")).toBe("y");
  expect(rowStep(rows, "b", "down")).toBe("y");
  expect(rowStep(rows, "y", "down")).toBe("d");
  expect(rowStep(rows, "x", "up")).toBe("a");
  expect(rowStep(rows, "f", "right")).toBe("x");
  expect(rowStep(rows, "x", "left")).toBe("f");
  expect(rowStep(rows, "d", "right")).toBe("d");
  expect(rowStep(rows, "a", "end")).toBe("d");
  expect(rowStep(rows, "zz", "down")).toBe("a");
  expect(layoutRows([], 3)).toEqual([]);
});
