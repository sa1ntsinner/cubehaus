import {
  EVENTS,
  type EventId,
  type Folder,
  type Session,
} from "@cubehaus/core";
import type { TrashEntry } from "@cubehaus/storage";
import { tree } from "./session-order";

/** A matched stretch of a row's label: [start, end) in its characters. */
export type Mark = [number, number];

/**
 * A line of the session switch: a session to open, a puzzle with no session yet (picking
 * it makes one named after it), or a new session named by the query.
 */
export type SwitchRow =
  | {
      kind: "session";
      id: string;
      label: string;
      event: EventId;
      marks: Mark[];
      folderId: string | null;
      /** 1 under its folder's row, 0 at the top level or in a search. */
      depth: 0 | 1;
      archived: boolean;
    }
  | {
      kind: "folder";
      id: string;
      label: string;
      /** The first session's event. */
      event: EventId;
      marks: Mark[];
      collapsed: boolean;
      count: number;
    }
  | { kind: "event"; id: EventId; label: string; event: EventId; marks: Mark[] }
  | { kind: "create"; id: "create"; label: string; event: EventId; marks: [] }
  /** The archive or the trash, last in the list while it holds anything. */
  | {
      kind: "view";
      id: "archive" | "trash";
      label: string;
      event: EventId;
      marks: [];
      count: number;
    }
  /** A thing in the trash: picking it puts it back. */
  | {
      kind: "trashed";
      id: string;
      label: string;
      event: EventId;
      marks: [];
      entry: TrashEntry;
    };

// What cubers type for a puzzle, beside its short label and official names.
const aliases: Record<EventId, readonly string[]> = {
  "333": ["3", "3x3", "333", "3x3x3", "три"],
  "222": ["2", "2x2", "222", "2x2x2", "два"],
  "444": ["4", "4x4", "444", "4x4x4"],
  "555": ["5", "5x5", "555", "5x5x5"],
  "666": ["6", "6x6", "666", "6x6x6"],
  "777": ["7", "7x7", "777", "7x7x7"],
  "333bf": ["bld", "3bld", "333bf", "blind", "слепую", "вслепую"],
  "333fm": ["fmc", "fm", "333fm", "fewest", "ходы"],
  "333oh": ["oh", "333oh", "one-handed", "одной"],
  clock: ["clock", "часы", "клок"],
  minx: ["mega", "minx", "megaminx", "мега"],
  pyram: ["pyra", "pyr", "pyram", "pyraminx", "пира"],
  skewb: ["skewb", "скьюб", "скьюб"],
  sq1: ["sq1", "sq", "square", "square-1", "скваер"],
  "444bf": ["4bld", "444bf"],
  "555bf": ["5bld", "555bf"],
  "333mbf": ["mbld", "multi", "multiblind", "333mbf", "мульти"],
  fto: ["fto", "octahedron"],
};

const ranked = [...EVENTS].sort((x, y) => x.rank - y.rank);

/**
 * Lower case, the times sign and the Cyrillic х read as x, ё as е. Each character maps to
 * one character, so a match's position is its position in the label.
 */
export function normalizeQuery(text: string): string {
  return text.trim().toLowerCase().replace(/[×х]/g, "x").replace(/ё/g, "е");
}

function fold(text: string): string {
  return text.toLowerCase().replace(/[×х]/g, "x").replace(/ё/g, "е");
}

/** Whole puzzle names and aliases also identify an exported session. */
export function eventNamed(name: string): EventId | undefined {
  const query = normalizeQuery(name);
  return ranked.find(({ id }) => terms(id).includes(query))?.id;
}

function terms(id: EventId): string[] {
  const info = ranked.find((event) => event.id === id);
  return [
    ...(aliases[id] ?? []),
    ...(info ? [info.label, info.name, info.nameRu] : []),
  ].map(fold);
}

/** A puzzle answers to a query that starts one of its names, or sits inside a long one. */
function eventMatches(id: EventId, query: string): boolean {
  return terms(id).some(
    (term) =>
      term.startsWith(query) || (query.length >= 3 && term.includes(query)),
  );
}

/** A session answers to its puzzle only for a whole alias (or a long prefix). */
function sessionEventMatches(id: EventId, query: string): boolean {
  return terms(id).some(
    (term) => term === query || (query.length >= 3 && term.startsWith(query)),
  );
}

function mark(label: string, query: string): Mark[] {
  const at = fold(label).indexOf(query);
  return at < 0 ? [] : [[at, at + query.length]];
}

/**
 * The switch's rows for a query: sessions whose name holds it, then sessions of a puzzle
 * it names (archived ones after the rest), then puzzles it names that have no session,
 * then, unless a session already has exactly that name, a new session called by it in
 * the current puzzle. With no query: every session in order but the archived ones (the
 * open session shows even so), then every puzzle that has none, in WCA order.
 */
export function findSwitchRows(
  query: string,
  sessions: readonly Session[],
  currentId: string | null,
  language: "en" | "ru",
  currentEvent: EventId = "333",
  folders: readonly Folder[] = [],
  /** Folders shown open whatever they store (the one holding the open session). */
  opened: ReadonlySet<string> = new Set(),
): SwitchRow[] {
  const q = normalizeQuery(query);
  const official = (id: EventId) => {
    const info = ranked.find((event) => event.id === id);
    return info ? (language === "ru" ? info.nameRu : info.name) : id;
  };
  // An archived session leaves its puzzle free: picking the puzzle makes a new one.
  const listed = sessions.filter(
    ({ id, archived }) => !archived || id === currentId,
  );
  const taken = new Set(
    sessions.filter(({ archived }) => !archived).map(({ event }) => event),
  );
  const free = ranked.filter(({ id }) => !taken.has(id));
  const sessionRow = (
    { id, name, event, folderId, archived }: Session,
    depth: 0 | 1,
    marks: Mark[] = [],
  ): SwitchRow => ({
    kind: "session",
    id,
    label: name,
    event,
    marks,
    folderId,
    depth,
    archived,
  });
  if (!q)
    return [
      ...tree(listed, folders).flatMap((node): SwitchRow[] => {
        if (node.kind === "session") return [sessionRow(node.session, 0)];
        const { folder, sessions: held } = node;
        const collapsed = folder.collapsed && !opened.has(folder.id);
        return [
          {
            kind: "folder",
            id: folder.id,
            label: folder.name,
            event: held[0]?.event ?? "333",
            marks: [],
            collapsed,
            count: held.length,
          },
          ...(collapsed ? [] : held.map((session) => sessionRow(session, 1))),
        ];
      }),
      ...free.map(
        ({ id }): SwitchRow => ({
          kind: "event",
          id,
          label: official(id),
          event: id,
          marks: [],
        }),
      ),
    ];

  // In a search sessions stand alone, in list order: by name, then by their folder's
  // name, then by their puzzle.
  const ordered = tree(sessions, folders).flatMap((node) =>
    node.kind === "folder" ? node.sessions : [node.session],
  );
  const folderName = new Map(folders.map(({ id, name }) => [id, fold(name)]));
  const byName = ordered.filter(({ name }) => fold(name).includes(q));
  const byFolder = ordered.filter(
    (session) =>
      !byName.includes(session) &&
      session.folderId !== null &&
      (folderName.get(session.folderId) ?? "").includes(q),
  );
  const byEvent = ordered.filter(
    (session) =>
      !byName.includes(session) &&
      !byFolder.includes(session) &&
      sessionEventMatches(session.event, q),
  );
  const matched = [...byName, ...byFolder, ...byEvent];
  const rows: SwitchRow[] = [
    ...[
      ...matched.filter(({ archived }) => !archived),
      ...matched.filter(({ archived }) => archived),
    ].map((session) => sessionRow(session, 0, mark(session.name, q))),
    ...free
      .filter(({ id }) => eventMatches(id, q))
      .map(({ id }): SwitchRow => {
        const label = official(id);
        return { kind: "event", id, label, event: id, marks: mark(label, q) };
      }),
  ];
  if (!sessions.some(({ name }) => normalizeQuery(name) === q))
    rows.push({
      kind: "create",
      id: "create",
      label: query.trim(),
      event: currentEvent,
      marks: [],
    });
  return rows;
}

/**
 * Where solves of one puzzle can go: the other sessions of that puzzle in list order
 * (the archived only in a search, after the rest), then a new session named by the query.
 */
export function findMoveRows(
  query: string,
  sessions: readonly Session[],
  currentId: string | null,
  event: EventId,
  folders: readonly Folder[] = [],
): SwitchRow[] {
  const q = normalizeQuery(query);
  const candidates = tree(sessions, folders)
    .flatMap((node) =>
      node.kind === "folder" ? node.sessions : [node.session],
    )
    .filter((session) => session.event === event && session.id !== currentId);
  const row = (session: Session, marks: Mark[]): SwitchRow => ({
    kind: "session",
    id: session.id,
    label: session.name,
    event,
    marks,
    folderId: session.folderId,
    depth: 0,
    archived: session.archived,
  });
  if (!q)
    return candidates
      .filter(({ archived }) => !archived)
      .map((session) => row(session, []));
  const folderName = new Map(folders.map(({ id, name }) => [id, fold(name)]));
  const byName = candidates.filter(({ name }) => fold(name).includes(q));
  const byFolder = candidates.filter(
    (session) =>
      !byName.includes(session) &&
      session.folderId !== null &&
      (folderName.get(session.folderId) ?? "").includes(q),
  );
  const matched = [...byName, ...byFolder];
  const rows = [
    ...matched.filter(({ archived }) => !archived),
    ...matched.filter(({ archived }) => archived),
  ].map((session) => row(session, mark(session.name, q)));
  if (
    !sessions.some(
      (session) =>
        session.event === event && normalizeQuery(session.name) === q,
    )
  )
    rows.push({
      kind: "create",
      id: "create",
      label: query.trim(),
      event,
      marks: [],
    });
  return rows;
}

/**
 * The row Enter takes before any arrow is pressed: with no query the session open before
 * this one (so S, Enter goes back and forth), else the open one; with a query the first.
 */
export function defaultIndex(
  rows: readonly SwitchRow[],
  query: string,
  previousId: string | null,
  currentId: string | null,
): number {
  if (normalizeQuery(query)) return 0;
  const at = (id: string | null) =>
    id === null
      ? -1
      : rows.findIndex((row) => row.kind === "session" && row.id === id);
  const index = at(previousId);
  return index >= 0 ? index : Math.max(0, at(currentId));
}

export function enterRow(
  rows: readonly SwitchRow[],
  query: string,
  previousId: string | null,
  currentId: string | null,
): SwitchRow | undefined {
  return rows[defaultIndex(rows, query, previousId, currentId)];
}

/** The next puzzle in WCA order (Tab on the new-session row), wrapping round. */
export function nextEvent(event: EventId, step: 1 | -1 = 1): EventId {
  const index = ranked.findIndex(({ id }) => id === event);
  const next = ranked[(index + step + ranked.length) % ranked.length];
  return next?.id ?? "333";
}
