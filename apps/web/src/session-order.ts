import type { Folder, Session } from "@cubehaus/core";

/**
 * The top level of the session list: folders and the sessions outside them, in one key
 * order. A folder holds sessions only, in their own key order. A folder with no session
 * left to show is not part of the list.
 */
export type TopNode =
  | { kind: "folder"; folder: Folder; sessions: Session[] }
  | { kind: "session"; session: Session };

/** Where a session or folder goes: into `parent` (null: the top level) before `before`. */
export interface Place {
  parent: string | null;
  before: string | null;
}

export interface LayoutItem {
  kind: "folder" | "session";
  id: string;
}

const byKey = (a: { orderKey: string; id: string }, b: typeof a) =>
  a.orderKey < b.orderKey
    ? -1
    : a.orderKey > b.orderKey
      ? 1
      : a.id < b.id
        ? -1
        : Number(a.id > b.id);

export function tree(
  sessions: readonly Session[],
  folders: readonly Folder[],
): TopNode[] {
  const inside = new Map<string, Session[]>(folders.map(({ id }) => [id, []]));
  const top: (TopNode & { orderKey: string; id: string })[] = [];
  for (const session of [...sessions].sort(byKey)) {
    const host =
      session.folderId === null ? undefined : inside.get(session.folderId);
    if (host) host.push(session);
    else
      top.push({
        kind: "session",
        session,
        orderKey: session.orderKey,
        id: session.id,
      });
  }
  for (const folder of folders) {
    const held = inside.get(folder.id) ?? [];
    if (held.length)
      top.push({
        kind: "folder",
        folder,
        sessions: held,
        orderKey: folder.orderKey,
        id: folder.id,
      });
  }
  return top
    .sort(byKey)
    .map(({ orderKey: _key, id: _id, ...node }) => node as TopNode);
}

/**
 * The sessions the list shows: all but the archived ones, though the open session shows
 * wherever it stands. What [ ], Alt+1–9 and Alt+arrows step through.
 */
export function listed<T extends Pick<Session, "id" | "archived">>(
  sessions: readonly T[],
  currentId: string | null | undefined,
): T[] {
  return sessions.filter(({ id, archived }) => !archived || id === currentId);
}

/** Every session in list order, folders opened: the order of [ ] and Alt+1–9. */
export function sessionOrder(nodes: readonly TopNode[]): Session[] {
  return nodes.flatMap((node) =>
    node.kind === "folder" ? node.sessions : [node.session],
  );
}

const nodeId = (node: TopNode) =>
  node.kind === "folder" ? node.folder.id : node.session.id;

/** Where an item stands now, as a place: its parent and the row after it. */
export function placeOf(
  nodes: readonly TopNode[],
  item: LayoutItem,
): Place | null {
  for (const [index, node] of nodes.entries()) {
    if (nodeId(node) === item.id)
      return {
        parent: null,
        before: nodes[index + 1] ? nodeId(nodes[index + 1] as TopNode) : null,
      };
    if (node.kind === "folder" && item.kind === "session") {
      const at = node.sessions.findIndex(({ id }) => id === item.id);
      if (at >= 0)
        return {
          parent: node.folder.id,
          before: node.sessions[at + 1]?.id ?? null,
        };
    }
  }
  return null;
}

/**
 * Alt+Up or Alt+Down: one step through the rows as they are shown. A session at the edge
 * of a folder steps out of it; one beside an open folder steps into it, past a closed one
 * over it. A folder steps over its neighbour. Null when there is nowhere to go.
 */
export function stepPlace(
  nodes: readonly TopNode[],
  item: LayoutItem,
  step: 1 | -1,
): Place | null {
  const topIndex = nodes.findIndex((node) => nodeId(node) === item.id);
  const after = (index: number) => {
    const node = nodes[index];
    return node ? nodeId(node) : null;
  };
  if (topIndex >= 0) {
    const neighbour = nodes[topIndex + step];
    if (!neighbour) return null;
    if (
      item.kind === "session" &&
      neighbour.kind === "folder" &&
      !neighbour.folder.collapsed
    )
      return step < 0
        ? { parent: neighbour.folder.id, before: null }
        : {
            parent: neighbour.folder.id,
            before: neighbour.sessions[0]?.id ?? null,
          };
    return step < 0
      ? { parent: null, before: nodeId(neighbour) }
      : { parent: null, before: after(topIndex + 2) };
  }
  if (item.kind === "folder") return null;
  for (const [index, node] of nodes.entries()) {
    if (node.kind !== "folder") continue;
    const at = node.sessions.findIndex(({ id }) => id === item.id);
    if (at < 0) continue;
    const parent = node.folder.id;
    if (step < 0)
      return at > 0
        ? { parent, before: node.sessions[at - 1]?.id ?? null }
        : { parent: null, before: parent };
    return at < node.sessions.length - 1
      ? { parent, before: node.sessions[at + 2]?.id ?? null }
      : { parent: null, before: after(index + 1) };
  }
  return null;
}

/** What a drop does: put the item somewhere, or make a folder of it and the target. */
export type Drop =
  | ({ kind: "place" } & Place)
  | { kind: "group"; target: string };

/**
 * A drop on a row (`on`) or between rows (`before`, `after` the row `over`). On a session
 * at the top level a session makes a folder of the two; on a session in a folder it joins
 * that folder after it; on a folder it goes in last. Folders do not nest, so a folder
 * dropped among a folder's sessions goes beside that folder. Null when the drop would
 * change nothing or is not allowed.
 */
export function dropPlace(
  nodes: readonly TopNode[],
  item: LayoutItem,
  over: LayoutItem,
  zone: "before" | "on" | "after",
): Drop | null {
  if (over.id === item.id) return null;
  const host = (id: string) =>
    nodes.find(
      (node): node is Extract<TopNode, { kind: "folder" }> =>
        node.kind === "folder" && node.sessions.some((s) => s.id === id),
    );
  const topIndex = (id: string) => nodes.findIndex((n) => nodeId(n) === id);
  const nextTop = (id: string) => {
    const next = nodes[topIndex(id) + 1];
    return next ? nodeId(next) : null;
  };
  let drop: Drop | null = null;
  if (over.kind === "folder") {
    const folder = nodes[topIndex(over.id)];
    if (folder?.kind !== "folder") return null;
    if (zone === "on")
      drop =
        item.kind === "session"
          ? { kind: "place", parent: over.id, before: null }
          : null;
    else if (zone === "before")
      drop = { kind: "place", parent: null, before: over.id };
    else
      drop =
        item.kind === "session" && !folder.folder.collapsed
          ? {
              kind: "place",
              parent: over.id,
              before: folder.sessions[0]?.id ?? null,
            }
          : { kind: "place", parent: null, before: nextTop(over.id) };
  } else {
    const folder = host(over.id);
    if (folder) {
      const siblings = folder.sessions;
      const at = siblings.findIndex(({ id }) => id === over.id);
      if (item.kind === "folder" && zone === "on") return null;
      if (item.kind === "folder")
        drop = {
          kind: "place",
          parent: null,
          before:
            zone === "before" ? folder.folder.id : nextTop(folder.folder.id),
        };
      else
        drop = {
          kind: "place",
          parent: folder.folder.id,
          before: zone === "before" ? over.id : (siblings[at + 1]?.id ?? null),
        };
    } else if (zone === "on") {
      drop =
        item.kind === "session" ? { kind: "group", target: over.id } : null;
    } else {
      drop = {
        kind: "place",
        parent: null,
        before: zone === "before" ? over.id : nextTop(over.id),
      };
    }
  }
  if (drop?.kind === "place") {
    const now = placeOf(nodes, item);
    if (
      drop.before === item.id ||
      (now && now.parent === drop.parent && now.before === drop.before)
    )
      return null;
  }
  return drop;
}
