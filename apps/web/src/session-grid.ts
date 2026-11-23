import type { EventId, Session } from "@cubehaus/core";
import type { LayoutItem, Place, TopNode } from "./session-order";

/**
 * The session grid's own rules (DESIGN.md section 10, the grid): how the arrows walk the
 * tiles, where a tile moved by keys or a drag lands, which folder a move leaves with one
 * session (and so dissolves), and what a name may be.
 */

export type GridKey = "left" | "right" | "up" | "down" | "home" | "end";

const nodeId = (node: TopNode) =>
  node.kind === "folder" ? node.folder.id : node.session.id;

/** The ids of a container as shown: the top level (null) or one folder's sessions. */
export function containerIds(
  nodes: readonly TopNode[],
  parent: string | null,
): string[] {
  if (parent === null) return nodes.map(nodeId);
  const host = nodes.find(
    (node) => node.kind === "folder" && node.folder.id === parent,
  );
  return host?.kind === "folder" ? host.sessions.map(({ id }) => id) : [];
}

/** The container an item stands in now: null for the top level; undefined if absent. */
export function parentOf(
  nodes: readonly TopNode[],
  item: LayoutItem,
): string | null | undefined {
  for (const node of nodes) {
    if (nodeId(node) === item.id) return null;
    if (
      node.kind === "folder" &&
      item.kind === "session" &&
      node.sessions.some(({ id }) => id === item.id)
    )
      return node.folder.id;
  }
  return undefined;
}

/**
 * Where an item goes to stand at `index` of a container, counted without the item. Null
 * when it already stands there or cannot go there (folders do not nest).
 */
export function placeAt(
  nodes: readonly TopNode[],
  item: LayoutItem,
  parent: string | null,
  index: number,
): Place | null {
  if (item.kind === "folder" && parent !== null) return null;
  const others = containerIds(nodes, parent).filter((id) => id !== item.id);
  const at = Math.max(0, Math.min(others.length, index));
  const place: Place = { parent, before: others[at] ?? null };
  const from = parentOf(nodes, item);
  if (from === parent) {
    const now = containerIds(nodes, parent).filter((id) => id !== item.id);
    const own = containerIds(nodes, parent).indexOf(item.id);
    if (own === at && now.length === others.length) return null;
  }
  return place;
}

/**
 * Alt with an arrow: `step` places along the item's own container (±1 sideways, ±columns
 * up and down), held at its ends. A session at a folder's edge steps out of it, before
 * or after the folder's tile. Null when there is nowhere to go.
 */
export function gridMove(
  nodes: readonly TopNode[],
  item: LayoutItem,
  step: number,
): Place | null {
  const parent = parentOf(nodes, item);
  if (parent === undefined || step === 0) return null;
  const ids = containerIds(nodes, parent);
  const at = ids.indexOf(item.id);
  const target = at + step;
  if (parent !== null && (target < 0 || target >= ids.length)) {
    const top = containerIds(nodes, null);
    const host = top.indexOf(parent);
    return target < 0
      ? { parent: null, before: parent }
      : { parent: null, before: top[host + 1] ?? null };
  }
  const index = Math.max(0, Math.min(ids.length - 1, target));
  if (index === at) return null;
  return placeAt(nodes, item, parent, index);
}

/**
 * Folders that the given ones were and now hold one session: it steps out to where the
 * folder stood, and the folder, left empty, goes. A folder made for one session on
 * purpose is not among those a session just left, so it stays.
 */
export function lonelyFolders(
  nodes: readonly TopNode[],
  left: readonly (string | null)[],
): { folderId: string; sessionId: string; place: Place }[] {
  const leaving = new Set(left);
  return nodes.flatMap((node) => {
    if (node.kind !== "folder" || !leaving.has(node.folder.id)) return [];
    const [only, ...rest] = node.sessions;
    if (!only || rest.length) return [];
    return [
      {
        folderId: node.folder.id,
        sessionId: only.id,
        place: { parent: null, before: node.folder.id },
      },
    ];
  });
}

/** A folder's tile shows its first four sessions' puzzles. */
export function folderPreview(sessions: readonly Session[]): EventId[] {
  return sessions.slice(0, 4).map(({ event }) => event);
}

export const NAME_LIMIT = 64;

/**
 * A typed name as it is kept: trimmed, runs of spaces joined, at most 64 characters.
 * Null when nothing would change: empty (the old name stays) or the same as `before`.
 */
export function cleanName(raw: string, before?: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, NAME_LIMIT).trim();
  if (!name || name === before) return null;
  return name;
}

export type MoveChoice =
  | { kind: "new" }
  | { kind: "folder"; id: string; name: string }
  | { kind: "out"; place: Place };

/**
 * Move to…, the way to group without a drag: a session at the top level can start a
 * folder or join one; one in a folder can leave it or join another.
 */
export function moveTo(
  nodes: readonly TopNode[],
  item: LayoutItem,
): MoveChoice[] {
  if (item.kind !== "session") return [];
  const parent = parentOf(nodes, item);
  if (parent === undefined) return [];
  const folders = nodes.flatMap((node): MoveChoice[] =>
    node.kind === "folder" && node.folder.id !== parent
      ? [{ kind: "folder", id: node.folder.id, name: node.folder.name }]
      : [],
  );
  if (parent === null) return [{ kind: "new" }, ...folders];
  const top = containerIds(nodes, null);
  return [
    {
      kind: "out",
      place: { parent: null, before: top[top.indexOf(parent) + 1] ?? null },
    },
    ...folders,
  ];
}

/**
 * The tiles as they stand on screen: rows of `columns`, an open folder's own tiles in
 * rows under the row that holds the folder.
 */
export function layoutRows(
  keys: readonly string[],
  columns: number,
  open?: { after: string; keys: readonly string[] },
): string[][] {
  const cols = Math.max(1, columns);
  const chunk = (list: readonly string[]) => {
    const rows: string[][] = [];
    for (let i = 0; i < list.length; i += cols)
      rows.push(list.slice(i, i + cols));
    return rows;
  };
  const rows = chunk(keys);
  if (!open) return rows;
  const at = rows.findIndex((row) => row.includes(open.after));
  if (at < 0) return rows;
  return [...rows.slice(0, at + 1), ...chunk(open.keys), ...rows.slice(at + 1)];
}

/** The tile an arrow goes to in rows as laid out; an unknown key starts at the first. */
export function rowStep(
  rows: readonly (readonly string[])[],
  key: string,
  direction: GridKey,
): string | undefined {
  const flat = rows.flat();
  const index = flat.indexOf(key);
  if (index < 0) return flat[0];
  if (direction === "left") return flat[Math.max(0, index - 1)];
  if (direction === "right") return flat[Math.min(flat.length - 1, index + 1)];
  if (direction === "home") return flat[0];
  if (direction === "end") return flat.at(-1);
  const row = rows.findIndex((r) => r.includes(key));
  const col = (rows[row] as readonly string[]).indexOf(key);
  const next = rows[row + (direction === "up" ? -1 : 1)];
  if (!next) return key;
  return next[Math.min(col, next.length - 1)];
}
