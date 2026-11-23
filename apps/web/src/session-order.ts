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
