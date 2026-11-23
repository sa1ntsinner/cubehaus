import { EVENTS, type EventId, eventInfo, type Session } from "@cubehaus/core";
import { holdingFaces } from "@cubehaus/cube/holding";
import type { TrashEntry } from "@cubehaus/storage";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AppState, AppView } from "../app-state";
import { actionKey } from "../keys/keymap";
import {
  cleanName,
  containerIds,
  folderPreview,
  type GridKey,
  gridMove,
  layoutRows,
  moveTo,
  NAME_LIMIT,
  parentOf,
  placeAt,
  rowStep,
} from "../session-grid";
import { type LayoutItem, listed, type TopNode, tree } from "../session-order";
import {
  findSwitchRows,
  type Mark,
  nextEvent,
  normalizeQuery,
} from "../session-switch";
import type { Text } from "../text";
import { formatFileResult } from "./file-result";
import { FolderGlyph, PuzzleGlyph } from "./PuzzleGlyph";
import { officialNote } from "./SessionSwitch";

/** What the screen shows: the sessions, the archive, the trash, the puzzle picker for a
 * new session, or the sessions picked ones can merge into. */
type Place = "list" | "archive" | "trash" | "new" | "merge";

type Tile =
  | {
      kind: "session";
      key: string;
      id: string;
      name: string;
      event: EventId;
      parent: string | null;
      archived: boolean;
      marks: Mark[];
    }
  | {
      kind: "folder";
      key: string;
      id: string;
      name: string;
      events: EventId[];
      count: number;
      marks: Mark[];
    }
  | { kind: "add"; key: "add" }
  | {
      kind: "event";
      key: string;
      event: EventId;
      name: string;
      note: string | null;
      marks: Mark[];
    }
  | { kind: "create"; key: "create"; name: string; event: EventId }
  | {
      kind: "trashed";
      key: string;
      event: EventId;
      name: string;
      note: string;
      left: string;
      entry: TrashEntry;
    };

type Movable = Extract<Tile, { kind: "session" | "folder" }>;
const movable = (tile: Tile | undefined): tile is Movable =>
  tile?.kind === "session" || tile?.kind === "folder";
const itemOf = (tile: Movable): LayoutItem => ({
  kind: tile.kind,
  id: tile.id,
});
const mod = (event: { metaKey: boolean; ctrlKey: boolean }) =>
  /Mac|iPhone|iPad/.test(navigator.platform) ? event.metaKey : event.ctrlKey;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const hasKeys = () => matchMedia("(hover: hover)").matches;
const ranked = [...EVENTS].sort((x, y) => x.rank - y.rank);
/** Up to this many sessions a touch screen's grid shows no `Find`: three phone rows. */
const FIND_FROM = 12;
/** The WCA's name of a puzzle in the language in use. */
const officialName = (event: EventId, language: "en" | "ru") => {
  const info = eventInfo(event);
  return language === "ru" ? info.nameRu : info.name;
};

function marked(label: string, marks: readonly Mark[]): ReactNode {
  const [mark] = marks;
  if (!mark) return label;
  const [start, end] = mark;
  return (
    <>
      {label.slice(0, start)}
      <mark>{label.slice(start, end)}</mark>
      {label.slice(end)}
    </>
  );
}

/** How long until the trash lets go: whole days, or hours on the last day. */
function timeLeft(ms: number, language: "en" | "ru"): string {
  const hours = Math.max(1, Math.ceil(ms / 3_600_000));
  const [value, unit] =
    hours < 24 ? [hours, "hour"] : [Math.ceil(hours / 24), "day"];
  return new Intl.NumberFormat(language, {
    style: "unit",
    unit,
    unitDisplay: "long",
  }).format(value);
}

/** Where a dragged tile would land: a place in a container, onto a tile, or the trash. */
type Target =
  | { kind: "place"; parent: string | null; index: number }
  | { kind: "on"; key: string }
  | { kind: "trash" };

interface Drag {
  key: string;
  item: LayoutItem;
  /** The place the tiles make room at; kept while the pointer is over a tile's middle. */
  place: { parent: string | null; index: number } | null;
  target: Target | null;
}

/** A press on a tile, from the pointer's first contact. */
interface Gesture {
  pointerId: number;
  touch: boolean;
  x: number;
  y: number;
  /** Where in the tile the pointer took it, so the tile hangs from that point. */
  dx: number;
  dy: number;
  /** The tile's width, which the hanging copy keeps. */
  width: number;
  tile: Movable;
  /** The pointer now. */
  px: number;
  py: number;
  lifted: boolean;
  moved: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

const sessionTile = (
  session: Session,
  parent: string | null,
  marks: Mark[] = [],
): Tile => ({
  kind: "session",
  key: `session:${session.id}`,
  id: session.id,
  name: session.name,
  event: session.event,
  parent,
  archived: session.archived,
  marks,
});

/** The tiles with one item moved to a place: what the grid shows while it is dragged. */
function preview(
  nodes: readonly TopNode[],
  item: LayoutItem,
  place: { parent: string | null; index: number } | null,
): TopNode[] {
  if (!place) return [...nodes];
  let lifted: TopNode | Session | undefined;
  const without = nodes.flatMap((node): TopNode[] => {
    if (node.kind === "session" && node.session.id === item.id) {
      lifted = node;
      return [];
    }
    if (node.kind === "folder") {
      if (node.folder.id === item.id) {
        lifted = node;
        return [];
      }
      const at = node.sessions.findIndex(({ id }) => id === item.id);
      if (at >= 0) {
        lifted = node.sessions[at];
        return [
          {
            ...node,
            sessions: node.sessions.filter(({ id }) => id !== item.id),
          },
        ];
      }
    }
    return [node];
  });
  if (!lifted) return [...nodes];
  const session =
    "kind" in lifted
      ? lifted.kind === "session"
        ? lifted.session
        : null
      : lifted;
  if (place.parent === null) {
    const node: TopNode = session
      ? { kind: "session", session }
      : (lifted as TopNode);
    without.splice(Math.min(place.index, without.length), 0, node);
    return without;
  }
  if (!session) return [...nodes];
  return without.map((node) =>
    node.kind === "folder" && node.folder.id === place.parent
      ? {
          ...node,
          sessions: [
            ...node.sessions.slice(0, place.index),
            session,
            ...node.sessions.slice(place.index),
          ],
        }
      : node,
  );
}

/**
 * The session switch as a grid of tiles (DESIGN.md section 10, the grid): each session is
 * its puzzle's picture with its name under it, handled directly. A click, a tap or Enter
 * opens it; F2 or the tile's menu (right click, long press, the menu key) renames it in
 * place; a drag (a long press on a touch screen) or Alt with an arrow moves it, dropped on
 * another session it makes a folder, which opens in place under its row; Backspace or a
 * drop on the trash deletes it, with an undo. The `+` tile makes a new session from a
 * picker of puzzles. Typing anywhere finds. The archive and the trash are two words at the
 * foot, opening the same grid. A modal dialog: the page behind takes no input.
 */
export function SessionGrid({
  app,
  view,
  words,
  renameCurrent = false,
  startIn = "list",
  onClose,
}: {
  app: AppState;
  view: AppView;
  words: Text;
  /** Opened by F2: the open session's name is ready to edit. */
  renameCurrent?: boolean;
  startIn?: "list" | "archive" | "trash";
  /** `picked`: a session was chosen, so the keyboard goes to the timer, not the opener. */
  onClose(picked?: boolean): void;
}) {
  const t = words.switcher;
  const language = view.settings.language;
  const current = view.current;
  const currentId = current?.id ?? null;
  // The pictures take the colours the person holds on top and in front (Settings).
  const holding = view.settings.holding;
  const faces = useMemo(() => holdingFaces(holding), [holding]);
  const [place, setPlace] = useState<Place>(startIn);
  const [query, setQuery] = useState("");
  // On a touch screen the find line shows only after `Find`; with keys, once typed into.
  const [finding, setFinding] = useState(false);
  const [createEvent, setCreateEvent] = useState<EventId>(
    current?.event ?? "333",
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{
    kind: "session" | "folder";
    id: string;
    name: string;
  } | null>(
    renameCurrent && current
      ? { kind: "session", id: current.id, name: current.name }
      : null,
  );
  const [menu, setMenu] = useState<{
    key: string;
    page: "main" | "move";
  } | null>(null);
  const menuByKeys = useRef(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const [merging, setMerging] = useState<{
    ids: readonly string[];
    names: readonly string[];
    event: EventId;
  } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [trash, setTrash] = useState<TrashEntry[] | null>(null);
  const [trashRead, setTrashRead] = useState(0);
  const [notice, setNotice] = useState<{ text: string; undo: boolean } | null>(
    null,
  );
  const [columns, setColumns] = useState(5);
  const busy = useRef(false);
  const gesture = useRef<Gesture | null>(null);
  const swallowClick = useRef(false);
  const editing = useRef(renaming !== null);
  const closeAfterRename = useRef(renameCurrent);
  const focusTile = useRef(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dialog = useRef<HTMLDialogElement>(null);
  const grid = useRef<HTMLUListElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const trashTarget = useRef<HTMLParagraphElement>(null);
  const queryInput = useRef<HTMLInputElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  // Where each tile stood at the last layout, in the sheet's content coordinates.
  const laidOut = useRef(new Map<string, { x: number; y: number }>());
  // A tile let go of: it flies from where the hand left it into its new place.
  const landing = useRef<{ key: string; x: number; y: number } | null>(null);
  // While a tile is held near the sheet's top or the trash, the grid scrolls on its own.
  const autoScroll = useRef(0);
  // The tile a delete took the selection from, for Undo to give it back.
  const restoreKey = useRef<string | null>(null);
  // The tile selected before typing started a find, for Esc to go back to.
  const beforeFind = useRef<string | null>(null);

  const sessionsKey = view.sessions
    .map(({ id, archived, folderId }) => `${id}:${archived}:${folderId}`)
    .join("|");
  useEffect(() => {
    let live = true;
    void sessionsKey;
    void trashRead;
    void app.trash().then((entries) => {
      if (live) setTrash(entries);
    });
    return () => {
      live = false;
    };
  }, [app, sessionsKey, trashRead]);

  const nodes = useMemo(
    () => tree(listed(view.sessions, currentId), view.folders),
    [view.sessions, view.folders, currentId],
  );
  const shownNodes = useMemo(
    () => (drag ? preview(nodes, drag.item, drag.place) : nodes),
    [nodes, drag],
  );

  // The folder open in place: the one holding the session S, Enter goes back to, else the
  // open one's, until it is closed or another is opened.
  const [openFolder, setOpenFolder] = useState<string | null>(() => {
    const by = (id: string | null) =>
      view.sessions.find((session) => session.id === id)?.folderId ?? null;
    return by(view.previousId) ?? by(currentId);
  });
  const folderOpen =
    openFolder !== null &&
    shownNodes.some(
      (node) => node.kind === "folder" && node.folder.id === openFolder,
    )
      ? openFolder
      : null;

  const searching = place === "list" && normalizeQuery(query) !== "";
  /** The top level's tiles, and the open folder's. */
  const { top, inside } = useMemo((): { top: Tile[]; inside: Tile[] } => {
    if (place === "list" && !searching) {
      const top = shownNodes.map(
        (node): Tile =>
          node.kind === "session"
            ? sessionTile(node.session, null)
            : {
                kind: "folder",
                key: `folder:${node.folder.id}`,
                id: node.folder.id,
                name: node.folder.name,
                events: folderPreview(node.sessions),
                count: node.sessions.length,
                marks: [],
              },
      );
      const host = shownNodes.find(
        (node) => node.kind === "folder" && node.folder.id === folderOpen,
      );
      return {
        // The `+` stays while a tile is held: on a phone the grid stands at the foot,
        // and a row given up would drop it under the finger.
        top: [...top, { kind: "add", key: "add" }],
        inside:
          host?.kind === "folder"
            ? host.sessions.map((session) =>
                sessionTile(session, host.folder.id),
              )
            : [],
      };
    }
    if (place === "list") {
      const rows = findSwitchRows(
        query,
        view.sessions,
        currentId,
        language,
        createEvent,
        view.folders,
      );
      const byId = new Map(view.sessions.map((s) => [s.id, s]));
      return {
        top: rows.flatMap((row): Tile[] => {
          if (row.kind === "session") {
            const session = byId.get(row.id);
            return session ? [sessionTile(session, null, row.marks)] : [];
          }
          if (row.kind === "event")
            return [
              {
                kind: "event",
                key: `event:${row.id}`,
                event: row.id,
                // Found by name: the WCA's own, with what matched marked.
                name: row.label,
                note: null,
                marks: row.marks,
              },
            ];
          if (row.kind === "create")
            return [
              {
                kind: "create",
                key: "create",
                name: row.label,
                event: row.event,
              },
            ];
          return [];
        }),
        inside: [],
      };
    }
    if (place === "new")
      return {
        top: ranked.map(
          ({ id, label }): Tile => ({
            kind: "event",
            key: `event:${id}`,
            event: id,
            name: label,
            note: officialNote(eventInfo(id), words),
            marks: [],
          }),
        ),
        inside: [],
      };
    if (place === "merge" && merging)
      return {
        top: nodes
          .flatMap((node) =>
            node.kind === "folder" ? node.sessions : [node.session],
          )
          .filter(
            (session) =>
              session.event === merging.event &&
              !session.archived &&
              !merging.ids.includes(session.id),
          )
          .map((session) => sessionTile(session, null)),
        inside: [],
      };
    if (place === "archive")
      return {
        top: view.sessions
          .filter(({ archived }) => archived)
          .map((session) => sessionTile(session, null)),
        inside: [],
      };
    return {
      top: (trash ?? []).map(
        (entry): Tile => ({
          kind: "trashed",
          key: `trashed:${entry.kind}:${entry.id}`,
          event:
            entry.kind === "session" ? entry.session.event : entry.solve.event,
          name:
            entry.kind === "session"
              ? entry.session.name
              : formatFileResult(entry.solve),
          note:
            entry.kind === "session"
              ? t.solves(entry.count)
              : entry.sessionName,
          left: t.left(timeLeft(entry.expiresAt - Date.now(), language)),
          entry,
        }),
      ),
      inside: [],
    };
  }, [
    place,
    searching,
    shownNodes,
    folderOpen,
    query,
    view.sessions,
    view.folders,
    currentId,
    language,
    createEvent,
    words,
    merging,
    nodes,
    trash,
    t,
  ]);

  const tiles = useMemo(() => [...top, ...inside], [top, inside]);
  const rows = useMemo(
    () =>
      layoutRows(
        top.map(({ key }) => key),
        columns,
        folderOpen && inside.length
          ? {
              after: `folder:${folderOpen}`,
              keys: inside.map(({ key }) => key),
            }
          : undefined,
      ),
    [top, inside, columns, folderOpen],
  );
  const order = useMemo(() => rows.flat(), [rows]);
  const byKey = useMemo(
    () => new Map(tiles.map((tile) => [tile.key, tile])),
    [tiles],
  );

  /** Enter's tile before any arrow: the session open before this one (S, Enter goes
   * back), else the open one; in a search, the first. */
  const defaultKey = (): string | undefined => {
    if (place === "list" && !searching)
      for (const id of [view.previousId, currentId])
        if (id && byKey.has(`session:${id}`)) return `session:${id}`;
    return order[0];
  };
  const selected =
    selectedKey !== null && byKey.has(selectedKey) ? selectedKey : defaultKey();
  const selectedTile = selected ? byKey.get(selected) : undefined;

  // ---- the sheet opens: modal, focus on the tile Enter takes ----
  useLayoutEffect(() => {
    const sheet = dialog.current;
    if (!sheet || sheet.open) return;
    if (typeof sheet.showModal === "function") sheet.showModal();
    else sheet.setAttribute("open", "");
    if (editing.current) return;
    // A keyboard is at hand: it starts on the tile Enter takes. A touch screen shows no
    // ring; the sheet itself holds focus.
    if (hasKeys()) focusTile.current = true;
    else sheet.focus({ preventScroll: true });
  }, []);
  // Columns follow the grid's width.
  useLayoutEffect(() => {
    const list = grid.current;
    if (!list) return;
    const measure = () => {
      const count = getComputedStyle(list)
        .gridTemplateColumns.split(" ")
        .filter(Boolean).length;
      if (count > 0) setColumns(count);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);
  const renamingKey = renaming ? `${renaming.kind}:${renaming.id}` : null;
  useLayoutEffect(() => {
    if (renamingKey !== null) renameInput.current?.focus();
  }, [renamingKey]);
  // The keyboard follows the selected tile when the keys moved it.
  useEffect(() => {
    if (renaming) return;
    // Focus left on a tile the selection moved off (the sessions arrived after it), or
    // dropped when its tile went or moved into or out of a folder.
    const active = document.activeElement;
    const stale =
      active?.matches('[data-action="switch-pick"]') &&
      active.closest("li[data-key]:not([data-selected])");
    const lost =
      hasKeys() &&
      !menu &&
      !showFind &&
      (active === null ||
        active === document.body ||
        active === dialog.current);
    if (!focusTile.current && !stale && !lost) return;
    focusTile.current = false;
    const button = dialog.current?.querySelector<HTMLElement>(
      'li[data-selected] > [data-action="switch-pick"]',
    );
    if (button) {
      button.focus({ preventScroll: true });
      button.scrollIntoView({ block: "nearest" });
    } else dialog.current?.focus({ preventScroll: true });
  });
  const showFind = place === "list" && (finding || query !== "");
  useLayoutEffect(() => {
    if (showFind && document.activeElement !== queryInput.current) {
      const input = queryInput.current;
      if (!input) return;
      input.focus({ preventScroll: true });
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }
    // Only when the find line appears.
  }, [showFind]);
  // A menu stays on screen: moved in from a side, or above its tile near the foot.
  useLayoutEffect(() => {
    if (!menu) return;
    const element = dialog.current?.querySelector<HTMLElement>(
      '[data-part="switch-menu"]',
    );
    if (!element) return;
    element.style.removeProperty("--shift");
    element.style.removeProperty("--lift");
    delete element.dataset.above;
    const box = element.getBoundingClientRect();
    const margin = 8;
    const shift =
      box.left < margin
        ? margin - box.left
        : box.right > innerWidth - margin
          ? innerWidth - margin - box.right
          : 0;
    if (shift) element.style.setProperty("--shift", `${shift}px`);
    if (box.bottom > innerHeight - margin) {
      element.dataset.above = "";
      // A short window (a phone on its side): above does not fit either, so it stands
      // as low as it can while its top stays on screen.
      const above = element.getBoundingClientRect();
      if (above.top < margin)
        element.style.setProperty("--lift", `${margin - above.top}px`);
    }
  }, [menu]);
  useEffect(() => {
    if (!menu || !menuByKeys.current) return;
    menuByKeys.current = false;
    dialog.current
      ?.querySelector<HTMLButtonElement>('[data-part="switch-menu"] button')
      ?.focus();
  }, [menu]);
  // Once a tile is lifted the finger drags it; the sheet does not scroll under it.
  useEffect(() => {
    const sheet = dialog.current;
    if (!sheet) return;
    const hold = (event: TouchEvent) => {
      if (gesture.current?.lifted) event.preventDefault();
    };
    sheet.addEventListener("touchmove", hold, { passive: false });
    return () => sheet.removeEventListener("touchmove", hold);
  }, []);
  useEffect(
    () => () => {
      if (gesture.current?.timer) clearTimeout(gesture.current.timer);
      cancelAnimationFrame(autoScroll.current);
      clearTimeout(noticeTimer.current);
    },
    [],
  );

  // The lifted tile hangs from the pointer from its first frame.
  const lifting = drag !== null;
  useLayoutEffect(() => {
    const press = gesture.current;
    const element = ghost.current;
    if (lifting && press && element) {
      // `translate`, not `transform`: the lift's `scale` would scale a transform's offset
      // too, and the tile would drift from the hand the further it is from the corner.
      element.style.translate = `${press.px - press.dx}px ${press.py - press.dy}px`;
      element.style.width = `${press.width}px`;
    }
  }, [lifting]);

  // ---- motion: tiles that change place glide there from where they were seen ----
  useLayoutEffect(() => {
    const sheet = dialog.current;
    if (!sheet) return;
    const scroll = sheet.scrollTop;
    const next = new Map<string, { x: number; y: number }>();
    const moving = !reduced();
    for (const li of sheet.querySelectorAll<HTMLElement>(
      'li[data-key], [data-part="switch-places"]',
    )) {
      const parent = li.offsetParent;
      if (!(parent instanceof HTMLElement)) continue;
      const box = parent.getBoundingClientRect();
      const at = {
        x: box.left + li.offsetLeft,
        y: box.top + li.offsetTop + scroll,
      };
      const key = li.dataset.key ?? "places";
      next.set(key, at);
      if (!moving) continue;
      // The tile let go of flies home once it shows again (while the hand's copy is up
      // it is hidden in its place).
      const land =
        !drag && landing.current?.key === key ? landing.current : null;
      const before = land ?? laidOut.current.get(key);
      if (!before) continue;
      // Its place did not change (a notice, a selection): a glide under way goes on as
      // it was, rather than starting again from where it is seen.
      if (
        !land &&
        Math.abs(before.x - at.x) < 0.5 &&
        Math.abs(before.y - at.y) < 0.5
      )
        continue;
      // Interrupted on its way: start from where it is seen now.
      const seen = li.getBoundingClientRect();
      const drift = land
        ? { x: 0, y: 0 }
        : {
            x: seen.left - box.left - li.offsetLeft,
            y: seen.top - box.top - li.offsetTop,
          };
      const dx = before.x + drift.x - at.x;
      const dy = before.y + drift.y - at.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      for (const animation of li.getAnimations()) animation.cancel();
      // The tile let go of flies over its neighbours: the tiles after it in the page
      // would paint their grounds over it on the way.
      li.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, zIndex: land ? 2 : 1 },
          { transform: "translate(0, 0)", zIndex: land ? 2 : 1 },
        ],
        {
          duration: land ? 220 : 180,
          easing: "cubic-bezier(0.23, 1, 0.32, 1)",
        },
      );
    }
    if (!drag) landing.current = null;
    laidOut.current = next;
  });

  // ---- actions ----

  function say(text: string, undo = true) {
    restoreKey.current = null;
    setNotice({ text, undo });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  }
  function changed(work: Promise<unknown>, text = t.moved) {
    void work.then(() => say(text));
  }
  function undo() {
    setNotice(null);
    clearTimeout(noticeTimer.current);
    const back = restoreKey.current;
    restoreKey.current = null;
    void app.undo().then(() => {
      // A delete undone: the tile that came back has the selection again.
      if (back) select(back);
    });
  }
  function clearPicks() {
    anchor.current = null;
    setPicked((now) => (now.size ? new Set() : now));
  }
  function select(key: string | undefined, byKeys = true) {
    if (!key) return;
    setSelectedKey(key);
    if (byKeys) focusTile.current = true;
  }

  function goTo(next: Place) {
    setPlace(next);
    setMenu(null);
    setNotice(null);
    clearPicks();
    setQuery("");
    setFinding(false);
    if (next !== "merge") setMerging(null);
    setSelectedKey(null);
    focusTile.current = true;
  }

  function startRename(kind: "session" | "folder", id: string, name: string) {
    editing.current = true;
    setMenu(null);
    setRenaming({ kind, id, name });
  }
  function endRename() {
    editing.current = false;
    setRenaming(null);
    if (closeAfterRename.current) onClose();
    else focusTile.current = true;
    closeAfterRename.current = false;
  }
  function saveRename(name: string) {
    if (!editing.current || !renaming) return;
    if (renaming.kind === "folder") {
      const before = view.folders.find(({ id }) => id === renaming.id)?.name;
      const clean = cleanName(name, before);
      if (clean) void app.renameFolder(renaming.id, clean);
    } else {
      const before = view.sessions.find(({ id }) => id === renaming.id)?.name;
      const clean = cleanName(name, before);
      if (clean) void app.renameSession(renaming.id, clean);
    }
    endRename();
  }

  async function makeFolder(sessionIds: readonly string[]) {
    const id = await app.groupSessions(sessionIds, t.folder);
    if (id === null) return;
    say(t.moved);
    setOpenFolder(id);
    setSelectedKey(`folder:${id}`);
    startRename("folder", id, t.folder);
  }

  function remove(ids: readonly string[]) {
    if (!ids.length) return;
    // The tile after the last one goes takes the selection.
    const keys = ids.map((id) => `session:${id}`);
    const after = order.slice(order.indexOf(keys.at(-1) ?? "") + 1);
    const before = order.slice(0, order.indexOf(keys[0] ?? ""));
    const next =
      after.find((key) => !keys.includes(key) && key !== "add") ??
      before.reverse().find((key) => !keys.includes(key));
    clearPicks();
    setMenu(null);
    if (next) select(next);
    void app.deleteSessions(ids).then(() => {
      say(t.trashed);
      restoreKey.current = keys[0] ?? null;
    });
  }

  function archive(tile: Extract<Tile, { kind: "session" }>) {
    setMenu(null);
    changed(
      app.archiveSession(tile.id, !tile.archived),
      tile.archived ? t.unarchived : t.archived,
    );
  }

  function startMerge(tile: { id: string; event: EventId }) {
    setMenu(null);
    const going = picked.has(tile.id) ? picked : new Set([tile.id]);
    const chosen = view.sessions.filter(({ id }) => going.has(id));
    if (chosen.some(({ event }) => event !== tile.event)) {
      say(t.notMerged.event, false);
      return;
    }
    setMerging({
      ids: chosen.map(({ id }) => id),
      names: chosen.map(({ name }) => name),
      event: tile.event,
    });
    goTo("merge");
  }
  function mergeable(tile: { id: string; event: EventId }) {
    const going = picked.has(tile.id) ? picked : new Set([tile.id]);
    return view.sessions.some(
      ({ id, event, archived }) =>
        event === tile.event && !archived && !going.has(id),
    );
  }

  function restore(tile: Extract<Tile, { kind: "trashed" }>) {
    const { entry } = tile;
    setTrash((now) => now?.filter((item) => item !== entry) ?? null);
    void app.restoreFromTrash(entry).then(() => {
      setTrashRead((n) => n + 1);
      say(t.restored(tile.name), false);
    });
  }

  function pick(tile: Tile | undefined) {
    if (!tile || busy.current) return;
    if (place === "merge" && merging) {
      if (tile.kind !== "session") return;
      const { ids } = merging;
      goTo("list");
      setSelectedKey(tile.key);
      void app.mergeSessions(ids, tile.id).then((result) => {
        if ("into" in result) say(t.merged(result.into.name));
        else say(t.notMerged[result.error], false);
      });
      return;
    }
    switch (tile.kind) {
      case "folder":
        setOpenFolder((now) => (now === tile.id ? null : tile.id));
        select(tile.key, false);
        return;
      case "add":
        goTo("new");
        return;
      case "trashed":
        restore(tile);
        return;
      case "event":
        if (place === "new") {
          // The new tile stands last, its name ready to type over.
          void app.createSession(tile.name, tile.event).then((id) => {
            if (!id) return;
            goTo("list");
            setOpenFolder(null);
            setSelectedKey(`session:${id}`);
            startRename("session", id, tile.name);
          });
          return;
        }
        busy.current = true;
        onClose(true);
        void app.openEvent(tile.event, eventInfo(tile.event).label);
        return;
      case "create":
        busy.current = true;
        onClose(true);
        void app.newSession(tile.name, tile.event);
        return;
      case "session":
        busy.current = true;
        onClose(true);
        if (tile.id !== currentId) void app.selectSession(tile.id);
        return;
    }
  }

  function back() {
    if (drag) {
      swallowClick.current = true;
      endGesture();
    } else if (menu) {
      setMenu(null);
      focusTile.current = true;
    } else if (picked.size) clearPicks();
    else if (query || finding) {
      setQuery("");
      setFinding(false);
      if (beforeFind.current) setSelectedKey(beforeFind.current);
      beforeFind.current = null;
      focusTile.current = true;
    } else if (place !== "list") goTo("list");
    else if (folderOpen) {
      setOpenFolder(null);
      select(`folder:${folderOpen}`);
    } else onClose();
  }

  /** The session tiles from one key to another as laid out, both in. */
  function span(from: string, to: string): string[] {
    const a = order.indexOf(from);
    const b = order.indexOf(to);
    if (a < 0 || b < 0) return [];
    return order.slice(Math.min(a, b), Math.max(a, b) + 1).flatMap((key) => {
      const tile = byKey.get(key);
      return tile?.kind === "session" ? [tile.id] : [];
    });
  }
  function extendPick(direction: GridKey) {
    if (!selected) return;
    const next = rowStep(rows, selected, direction);
    if (!next) return;
    select(next);
    const from =
      anchor.current ?? (selectedTile?.kind === "session" ? selected : null);
    if (from === null) return;
    anchor.current = from;
    setPicked(new Set(span(from, next)));
  }
  function pickByClick(
    tile: Extract<Tile, { kind: "session" }>,
    range: boolean,
  ) {
    setSelectedKey(tile.key);
    setMenu(null);
    if (range && anchor.current) {
      setPicked(new Set(span(anchor.current, tile.key)));
      return;
    }
    anchor.current = tile.key;
    setPicked((now) => {
      const next = new Set(now);
      if (next.has(tile.id)) next.delete(tile.id);
      else next.add(tile.id);
      return next;
    });
  }

  // ---- dragging: a mouse lifts a tile once it moves, a finger after a long press ----

  const arranging = place === "list" && !searching;

  function endGesture() {
    if (gesture.current?.timer) clearTimeout(gesture.current.timer);
    gesture.current = null;
    cancelAnimationFrame(autoScroll.current);
    autoScroll.current = 0;
    setDrag(null);
  }

  function lift(press: Gesture) {
    press.lifted = true;
    setMenu(null);
    setSelectedKey(press.tile.key);
    const parent = parentOf(nodes, itemOf(press.tile)) ?? null;
    const index = containerIds(nodes, parent).indexOf(press.tile.id);
    setDrag({
      key: press.tile.key,
      item: itemOf(press.tile),
      place: { parent, index },
      target: null,
    });
    navigator.vibrate?.(10);
    cancelAnimationFrame(autoScroll.current);
    autoScroll.current = requestAnimationFrame(() => handlers.current.scroll());
  }

  /**
   * Near the sheet's top, or just above the trash at its foot, the grid scrolls under the
   * held tile, faster the deeper the pointer goes into that edge, while the hand stays
   * still; what lies under the pointer is read again as the tiles pass.
   */
  function scrollStep() {
    const press = gesture.current;
    const sheet = dialog.current;
    if (!press?.lifted || !sheet) {
      autoScroll.current = 0;
      return;
    }
    const zone = 72;
    const edge = sheet.getBoundingClientRect();
    const floor =
      trashTarget.current?.getBoundingClientRect().top ?? edge.bottom;
    const up = edge.top + zone - press.py;
    const down = press.py - (floor - zone);
    const speed = (depth: number) => Math.ceil(Math.min(1, depth / zone) * 14);
    const step =
      up > 0 ? -speed(up) : down > 0 && press.py < floor ? speed(down) : 0;
    if (step) {
      const before = sheet.scrollTop;
      sheet.scrollTop += step;
      if (sheet.scrollTop !== before) retarget(press.px, press.py);
    }
    autoScroll.current = requestAnimationFrame(() => handlers.current.scroll());
  }

  /** What lies under the pointer, read again: the place the tiles make room at. */
  function retarget(x: number, y: number) {
    setDrag((now) => {
      if (!now) return now;
      const target = targetAt(x, y, now);
      const place =
        target?.kind === "place"
          ? { parent: target.parent, index: target.index }
          : now.place;
      const same =
        JSON.stringify(target) === JSON.stringify(now.target) &&
        JSON.stringify(place) === JSON.stringify(now.place);
      return same ? now : { ...now, target, place };
    });
  }

  function moveGhost(x: number, y: number) {
    const press = gesture.current;
    const element = ghost.current;
    if (!press || !element) return;
    element.style.translate = `${x - press.dx}px ${y - press.dy}px`;
  }

  /** What lies under the pointer: a tile's middle, one of its sides, the trash. */
  function targetAt(x: number, y: number, current: Drag): Target | null {
    const bin = trashTarget.current?.getBoundingClientRect();
    if (
      bin &&
      current.item.kind === "session" &&
      x >= bin.left &&
      x <= bin.right &&
      y >= bin.top - 16 &&
      y <= bin.bottom
    )
      return { kind: "trash" };
    const sheet = dialog.current;
    if (!sheet) return null;
    for (const li of sheet.querySelectorAll<HTMLLIElement>(
      "li[data-key][data-tile]",
    )) {
      const parent = li.offsetParent;
      if (!(parent instanceof HTMLElement)) continue;
      const box = parent.getBoundingClientRect();
      const left = box.left + li.offsetLeft;
      const top = box.top + li.offsetTop;
      const width = li.offsetWidth;
      const height = li.offsetHeight;
      if (x < left || x > left + width || y < top || y > top + height) continue;
      const key = li.dataset.key ?? "";
      if (key === current.key)
        return current.place ? placeTarget(current) : null;
      const tile = byKey.get(key);
      if (!tile) return null;
      if (tile.kind === "add")
        return {
          kind: "place",
          parent: null,
          index: containerIds(nodes, null).filter(
            (id) => id !== current.item.id,
          ).length,
        };
      if (!movable(tile)) return null;
      const container = tile.kind === "session" ? tile.parent : null;
      // A folder stays at the top level: over a folder's tiles it stands by the folder.
      if (current.item.kind === "folder" && container !== null) return null;
      // The picture's middle: onto it.
      const middle =
        x > left + width * 0.2 &&
        x < left + width * 0.8 &&
        y < top + height * 0.66;
      if (middle && current.item.kind === "session") return { kind: "on", key };
      const ids = containerIds(shownNodes, container).filter(
        (id) => id !== current.item.id,
      );
      const at = ids.indexOf(tile.id);
      return {
        kind: "place",
        parent: container,
        index: at + (x > left + width / 2 ? 1 : 0),
      };
    }
    // Over the open folder's own ground: last in it.
    const band = sheet.querySelector<HTMLElement>('[data-part="switch-band"]');
    const area = band?.getBoundingClientRect();
    if (
      area &&
      folderOpen &&
      current.item.kind === "session" &&
      x >= area.left &&
      x <= area.right &&
      y >= area.top &&
      y <= area.bottom
    )
      return {
        kind: "place",
        parent: folderOpen,
        index: containerIds(shownNodes, folderOpen).filter(
          (id) => id !== current.item.id,
        ).length,
      };
    return null;
  }
  const placeTarget = (current: Drag): Target | null =>
    current.place ? { kind: "place", ...current.place } : null;

  function onPointerDown(tile: Movable, down: PointerEvent<HTMLButtonElement>) {
    if (down.button !== 0 || renaming || !arranging) return;
    if (down.shiftKey || mod(down)) return;
    swallowClick.current = false;
    endGesture();
    const box = down.currentTarget.getBoundingClientRect();
    const press: Gesture = {
      pointerId: down.pointerId,
      touch: down.pointerType !== "mouse",
      x: down.clientX,
      y: down.clientY,
      dx: down.clientX - box.left,
      dy: down.clientY - box.top,
      width: box.width,
      tile,
      px: down.clientX,
      py: down.clientY,
      lifted: false,
      moved: false,
    };
    gesture.current = press;
    // The page follows the pointer: the tile's own node may move while others make room.
    const move = (event: globalThis.PointerEvent) =>
      handlers.current.move(event);
    const up = (event: globalThis.PointerEvent) => {
      handlers.current.up(event);
      stop();
    };
    const cancel = () => {
      handlers.current.cancel();
      stop();
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    if (press.touch)
      press.timer = setTimeout(() => {
        if (gesture.current === press && !press.moved) lift(press);
      }, 450);
  }

  function onPointerMove(move: {
    pointerId: number;
    clientX: number;
    clientY: number;
  }) {
    const press = gesture.current;
    if (!press || press.pointerId !== move.pointerId) return;
    const far = Math.hypot(move.clientX - press.x, move.clientY - press.y);
    if (!press.lifted) {
      if (far > (press.touch ? 8 : 4)) {
        press.moved = true;
        if (press.touch) {
          if (press.timer) clearTimeout(press.timer);
          gesture.current = null;
        } else lift(press);
      }
      if (!press.lifted) return;
    }
    press.moved = press.moved || far > 4;
    press.px = move.clientX;
    press.py = move.clientY;
    moveGhost(move.clientX, move.clientY);
    retarget(move.clientX, move.clientY);
  }

  function onPointerUp(up: { pointerId: number }) {
    const press = gesture.current;
    if (!press || press.pointerId !== up.pointerId) return;
    if (press.timer) clearTimeout(press.timer);
    if (!press.lifted) {
      gesture.current = null;
      return;
    }
    swallowClick.current = true;
    const now = drag;
    const seen = ghost.current?.getBoundingClientRect();
    gesture.current = null;
    cancelAnimationFrame(autoScroll.current);
    autoScroll.current = 0;
    if (!press.moved || !now) {
      // A long press without a drag: the tile's menu.
      setDrag(null);
      setMenu({ key: press.tile.key, page: "main" });
      return;
    }
    const target = now.target;
    const item = now.item;
    const finish = () => setDrag(null);
    if (target?.kind === "trash") {
      finish();
      remove([item.id]);
      return;
    }
    if (target?.kind === "on") {
      const onto = byKey.get(target.key);
      finish();
      if (onto?.kind === "folder")
        changed(app.placeItem(item, { parent: onto.id, before: null }));
      else if (onto?.kind === "session" && onto.parent !== null) {
        const ids = containerIds(nodes, onto.parent).filter(
          (id) => id !== item.id,
        );
        changed(
          app.placeItem(item, {
            parent: onto.parent,
            before: ids[ids.indexOf(onto.id) + 1] ?? null,
          }),
        );
      } else if (onto?.kind === "session") void makeFolder([onto.id, item.id]);
      return;
    }
    const goal = now.place
      ? placeAt(nodes, item, now.place.parent, now.place.index)
      : null;
    if (seen) {
      const sheet = dialog.current;
      landing.current = {
        key: now.key,
        x: seen.left,
        y: seen.top + (sheet?.scrollTop ?? 0),
      };
    }
    if (!goal) {
      finish();
      return;
    }
    // The tiles keep the new order until the stored one arrives.
    void app.placeItem(item, goal).then(() => {
      finish();
      say(t.moved);
    });
  }

  const handlers = useRef({
    move: onPointerMove,
    up: onPointerUp,
    cancel: endGesture,
    // The auto-scroll's frames read this render's tiles, not those of the lift.
    scroll: scrollStep,
  });
  handlers.current = {
    move: onPointerMove,
    up: onPointerUp,
    cancel: endGesture,
    scroll: scrollStep,
  };

  // ---- keys ----

  function onKeys(event: KeyboardEvent) {
    if (renaming || event.defaultPrevented || event.nativeEvent.isComposing)
      return;
    const inQuery = event.target === queryInput.current;
    const typingText =
      inQuery && event.key.length === 1 && !event.metaKey && !event.ctrlKey;
    const editingQuery = inQuery && query !== "";
    const key = (id: string) =>
      !typingText && actionKey(view.keymap, id, event);
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    const actions =
      event.target instanceof Element
        ? event.target.closest('[data-part="switch-menu"]')
        : null;
    if (actions) {
      const step = key("sheet-menu.previous")
        ? -1
        : key("sheet-menu.next")
          ? 1
          : undefined;
      if (step !== undefined) {
        handled();
        const buttons = [...actions.querySelectorAll("button")];
        const at = buttons.indexOf(event.target as HTMLButtonElement);
        buttons[(at + step + buttons.length) % buttons.length]?.focus();
        return;
      }
      if (key("sheet.close")) {
        handled();
        back();
      }
      return;
    }
    const tile = selectedTile;
    const go = (direction: GridKey) => {
      handled();
      if (!selected) return select(order[0]);
      select(rowStep(rows, selected, direction));
    };
    const moveBy = (step: "left" | "right" | "up" | "down") => {
      handled();
      if (!movable(tile)) return;
      const n = step === "left" ? -1 : step === "right" ? 1 : columns;
      const place = gridMove(nodes, itemOf(tile), step === "up" ? -n : n);
      focusTile.current = true;
      if (place) changed(app.placeItem(itemOf(tile), place));
    };
    if (key("sheet.close")) {
      handled();
      back();
    } else if (key("sheet.menu") && movable(tile) && place !== "merge") {
      handled();
      menuByKeys.current = true;
      setMenu({ key: tile.key, page: "main" });
    } else if (arranging && !editingQuery && key("sheet.moveUp")) moveBy("up");
    else if (arranging && !editingQuery && key("sheet.moveDown"))
      moveBy("down");
    else if (arranging && !editingQuery && key("sheet.moveLeft"))
      moveBy("left");
    else if (arranging && !editingQuery && key("sheet.moveRight"))
      moveBy("right");
    else if (
      (place === "list" || place === "archive") &&
      (key("sheet.selectPrevious") ||
        key("sheet.selectNext") ||
        (!editingQuery &&
          (key("sheet.selectLeft") || key("sheet.selectRight"))))
    ) {
      handled();
      extendPick(
        key("sheet.selectPrevious")
          ? "up"
          : key("sheet.selectNext")
            ? "down"
            : key("sheet.selectLeft")
              ? "left"
              : "right",
      );
    } else if (key("sheet.previous")) go("up");
    else if (key("sheet.next")) go("down");
    else if (!editingQuery && key("sheet.collapse")) go("left");
    else if (!editingQuery && key("sheet.expand")) go("right");
    else if (key("sheet.pick")) {
      handled();
      pick(tile);
    } else if (
      (key("sheet.eventNext") || key("sheet.eventPrevious")) &&
      tile?.kind === "create"
    ) {
      handled();
      setCreateEvent((now) =>
        nextEvent(now, key("sheet.eventPrevious") ? -1 : 1),
      );
    } else if (
      key("sheet.archive") &&
      !editingQuery &&
      tile?.kind === "session" &&
      place !== "merge"
    ) {
      handled();
      archive(tile);
    } else if (
      key("sheet.delete") &&
      !inQuery &&
      (place === "list" || place === "archive") &&
      tile?.kind === "session"
    ) {
      handled();
      remove(picked.has(tile.id) ? [...picked] : [tile.id]);
    } else if (key("sheet.rename") && movable(tile) && place !== "merge") {
      handled();
      startRename(tile.kind, tile.id, tile.name);
    } else if (key("sheet.group") && arranging && tile?.kind === "session") {
      handled();
      void makeFolder(picked.size ? [...picked] : [tile.id]);
    } else if (key("sheet.undo") && !editingQuery && place !== "merge") {
      handled();
      undo();
    } else if (
      !inQuery &&
      place === "list" &&
      event.key.length === 1 &&
      event.key !== " " &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      // Typing anywhere finds: the letter starts the find line.
      handled();
      beforeFind.current = selected ?? null;
      setQuery(event.key);
      setSelectedKey(null);
      setMenu(null);
    }
  }

  // ---- drawing ----

  const liveCount = view.sessions.filter(({ archived }) => !archived).length;
  const archivedCount = view.sessions.filter(
    ({ id, archived }) => archived && id !== currentId,
  ).length;
  const dragged = drag ? byKey.get(drag.key) : undefined;

  function tileLabel(tile: Tile): string {
    switch (tile.kind) {
      case "folder":
        return t.folderTile(tile.name, tile.count);
      case "add":
        return t.newSession;
      case "create":
        return `${t.create(tile.name)}, ${eventInfo(tile.event).label}`;
      case "trashed":
        return t.restore(tile.name, tile.left);
      case "session":
        return `${tile.name}, ${eventInfo(tile.event).label}`;
      case "event":
        return place === "new"
          ? [tile.name, officialName(tile.event, language), tile.note]
              .filter(Boolean)
              .join(", ")
          : `${t.create(tile.name)}`;
    }
  }

  function picture(tile: Tile): ReactNode {
    if (tile.kind === "folder")
      return <FolderGlyph events={tile.events} faces={faces} />;
    if (tile.kind === "add" || tile.kind === "create")
      return <span data-part="tile-plus">+</span>;
    return <PuzzleGlyph event={tile.event} faces={faces} />;
  }

  function renderMenu(tile: Movable) {
    if (menu?.key !== tile.key) return null;
    if (menu.page === "move" && tile.kind === "session") {
      const choices = moveTo(nodes, itemOf(tile));
      return (
        <div data-part="switch-menu" role="menu">
          {choices.map((choice) => (
            <button
              key={choice.kind === "folder" ? choice.id : choice.kind}
              type="button"
              role="menuitem"
              data-action={
                choice.kind === "new"
                  ? "switch-group"
                  : choice.kind === "out"
                    ? "switch-out"
                    : "switch-join"
              }
              onClick={() => {
                setMenu(null);
                focusTile.current = true;
                if (choice.kind === "new") void makeFolder([tile.id]);
                else if (choice.kind === "out")
                  changed(app.placeItem(itemOf(tile), choice.place));
                else
                  changed(
                    app.placeItem(itemOf(tile), {
                      parent: choice.id,
                      before: null,
                    }),
                  );
              }}
            >
              {choice.kind === "new"
                ? t.newFolder
                : choice.kind === "out"
                  ? t.moveOut
                  : choice.name}
            </button>
          ))}
        </div>
      );
    }
    return (
      <div data-part="switch-menu" role="menu">
        <button
          type="button"
          role="menuitem"
          data-action="switch-rename"
          onClick={() => startRename(tile.kind, tile.id, tile.name)}
        >
          {t.rename}
        </button>
        {tile.kind === "session" && place === "list" && (
          <button
            type="button"
            role="menuitem"
            data-action="switch-move"
            onClick={() => {
              menuByKeys.current = true;
              setMenu({ key: tile.key, page: "move" });
            }}
          >
            {t.moveTo}
          </button>
        )}
        {tile.kind === "folder" && (
          <button
            type="button"
            role="menuitem"
            data-action="switch-ungroup"
            onClick={() => {
              setMenu(null);
              focusTile.current = true;
              changed(app.ungroupFolder(tile.id));
            }}
          >
            {t.ungroup}
          </button>
        )}
        {tile.kind === "session" && mergeable(tile) && (
          <button
            type="button"
            role="menuitem"
            data-action="switch-merge"
            onClick={() => startMerge(tile)}
          >
            {t.merge}
          </button>
        )}
        {tile.kind === "session" && (
          <button
            type="button"
            role="menuitem"
            data-action={tile.archived ? "switch-unarchive" : "switch-archive"}
            onClick={() => archive(tile)}
          >
            {tile.archived ? t.unarchive : t.archive}
          </button>
        )}
        {tile.kind === "session" && (
          <button
            type="button"
            role="menuitem"
            data-action="switch-delete"
            onClick={() =>
              remove(picked.has(tile.id) ? [...picked] : [tile.id])
            }
          >
            {t.delete}
          </button>
        )}
      </div>
    );
  }

  function renderTile(tile: Tile) {
    const isSelected = tile.key === selected;
    const isCurrent = tile.kind === "session" && tile.id === currentId;
    const holdsCurrent =
      tile.kind === "folder" && current?.folderId === tile.id;
    const common = {
      key: tile.key,
      "data-key": tile.key,
      "data-tile": tile.kind,
      "data-id":
        tile.kind === "session" || tile.kind === "folder" ? tile.id : undefined,
      "data-event":
        "event" in tile ? (tile as { event: EventId }).event : undefined,
      "data-selected": isSelected || undefined,
      "data-current": isCurrent || holdsCurrent || undefined,
    };
    if (
      movable(tile) &&
      renaming?.id === tile.id &&
      renaming.kind === tile.kind
    )
      return (
        <li {...common} data-renaming>
          <span data-part="tile-picture">{picture(tile)}</span>
          <input
            ref={renameInput}
            data-part="switch-rename"
            aria-label={tile.kind === "folder" ? t.folder : words.sessionName}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="done"
            maxLength={NAME_LIMIT}
            value={renaming.name}
            onFocus={(focus) => focus.currentTarget.select()}
            onChange={(change) =>
              setRenaming({ ...renaming, name: change.target.value })
            }
            onKeyDown={(key) => {
              if (actionKey(view.keymap, "sheet-rename.save", key)) {
                key.preventDefault();
                saveRename(renaming.name);
              } else if (actionKey(view.keymap, "sheet-rename.cancel", key)) {
                key.preventDefault();
                key.stopPropagation();
                endRename();
              }
            }}
            onBlur={() => saveRename(renaming.name)}
          />
        </li>
      );
    const name =
      tile.kind === "add"
        ? null
        : tile.kind === "create"
          ? t.create(tile.name)
          : "marks" in tile
            ? marked(tile.name, tile.marks)
            : tile.name;
    return (
      <li
        {...common}
        data-picked={
          (tile.kind === "session" && picked.has(tile.id)) || undefined
        }
        data-archived={
          (tile.kind === "session" && tile.archived && place === "list") ||
          undefined
        }
        data-open={
          (tile.kind === "folder" && tile.id === folderOpen) || undefined
        }
        data-lifted={drag?.key === tile.key || undefined}
        data-drop={
          drag?.target?.kind === "on" && drag.target.key === tile.key
            ? "on"
            : undefined
        }
        data-menu={menu?.key === tile.key || undefined}
      >
        <button
          type="button"
          data-action="switch-pick"
          tabIndex={isSelected ? 0 : -1}
          aria-label={tileLabel(tile)}
          aria-current={isCurrent || undefined}
          aria-expanded={
            tile.kind === "folder" ? tile.id === folderOpen : undefined
          }
          aria-haspopup={tile.kind === "add" ? "dialog" : undefined}
          onFocus={() => {
            if (!isSelected) setSelectedKey(tile.key);
          }}
          onPointerDown={
            movable(tile) ? (down) => onPointerDown(tile, down) : undefined
          }
          onContextMenu={(event) => {
            if (!movable(tile) || place === "merge" || searching) return;
            event.preventDefault();
            if (gesture.current?.touch) return;
            setSelectedKey(tile.key);
            setMenu({ key: tile.key, page: "main" });
          }}
          onClick={(click) => {
            if (swallowClick.current) {
              swallowClick.current = false;
              return;
            }
            if (
              tile.kind === "session" &&
              (place === "list" || place === "archive") &&
              (click.shiftKey || mod(click))
            ) {
              pickByClick(tile, click.shiftKey);
              return;
            }
            // The open session's name, clicked with a pointer, is its field: as in a file
            // manager, the name of what is already chosen renames. Its picture still goes
            // back to the timer.
            if (
              isCurrent &&
              tile.kind === "session" &&
              arranging &&
              hasKeys() &&
              click.detail > 0 &&
              click.target instanceof Element &&
              click.target.closest('[data-part="switch-label"]')
            ) {
              setSelectedKey(tile.key);
              startRename("session", tile.id, tile.name);
              return;
            }
            pick(tile);
          }}
        >
          <span data-part="tile-picture">{picture(tile)}</span>
          {name !== null && <span data-part="switch-label">{name}</span>}
          {tile.kind === "event" && tile.note && (
            <span data-part="switch-note">{tile.note}</span>
          )}
          {tile.kind === "trashed" && (
            <span data-part="switch-note">{tile.note}</span>
          )}
          {tile.kind === "trashed" && (
            <span data-part="switch-left">{tile.left}</span>
          )}
          {tile.kind === "session" && tile.archived && place === "list" && (
            <span data-part="switch-note">{t.archivedMark}</span>
          )}
        </button>
        {tile.kind === "create" && (
          <button
            type="button"
            data-action="switch-event"
            aria-label={t.event(eventInfo(tile.event).label)}
            onClick={() => setCreateEvent((now) => nextEvent(now))}
          >
            {eventInfo(tile.event).label}
          </button>
        )}
        {movable(tile) && renderMenu(tile)}
      </li>
    );
  }

  const openName = folderOpen
    ? view.folders.find(({ id }) => id === folderOpen)?.name
    : undefined;
  const heading =
    place === "archive"
      ? t.archiveView
      : place === "trash"
        ? t.trashView
        : place === "new"
          ? t.newSession
          : place === "merge" && merging
            ? t.mergeQuery(merging.names)
            : null;

  return (
    <dialog
      ref={dialog}
      tabIndex={-1}
      data-part="switch"
      data-layout="grid"
      data-no-timer
      data-dragging={drag ? "" : undefined}
      data-onto={drag?.target?.kind === "on" || undefined}
      data-searching={showFind || undefined}
      data-view={place === "list" ? undefined : place}
      data-purpose={place === "merge" ? "merge" : undefined}
      aria-label={place === "merge" ? t.mergeTitle : words.sessions}
      onKeyDown={onKeys}
      onCancel={(cancel) => {
        cancel.preventDefault();
        if (!renaming) back();
      }}
      onClick={(click) => {
        if (
          !renaming &&
          (click.target === click.currentTarget ||
            click.target === grid.current)
        ) {
          if (menu) setMenu(null);
          else back();
        }
      }}
    >
      <button
        type="button"
        data-action="dialog-close"
        onClick={() => onClose()}
      >
        {words.backToTimer}
      </button>
      {heading !== null ? (
        <p data-part="switch-find">
          <button
            type="button"
            data-action="switch-back"
            aria-label={t.back}
            onClick={() => goTo("list")}
          >
            <span aria-hidden="true">‹</span>
            {heading}
          </button>
        </p>
      ) : (
        showFind && (
          <label data-part="switch-find">
            <span aria-hidden="true">›</span>
            <input
              ref={queryInput}
              type="search"
              data-part="switch-query"
              aria-controls="switch-grid"
              aria-label={t.query}
              placeholder={t.query}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="go"
              value={query}
              onChange={(change) => {
                const value = change.target.value;
                setQuery(value);
                setSelectedKey(null);
                setMenu(null);
                // Emptied with keys at hand: the line goes and the tiles take the keys.
                if (!value && hasKeys()) {
                  setFinding(false);
                  focusTile.current = true;
                }
              }}
            />
          </label>
        )
      )}
      <ul
        ref={grid}
        id="switch-grid"
        data-part="switch-grid"
        aria-label={heading ?? words.sessions}
      >
        {top.map((tile) => {
          const tileNode = renderTile(tile);
          const row = rows.find((r) => r.includes(tile.key));
          const endsRow =
            folderOpen !== null &&
            inside.length > 0 &&
            row?.at(-1) === tile.key &&
            row.includes(`folder:${folderOpen}`);
          if (!endsRow) return tileNode;
          return [
            tileNode,
            <li key="band" data-part="switch-band">
              {renaming?.kind === "folder" &&
              renaming.id === folderOpen ? null : (
                <button
                  type="button"
                  data-action="switch-folder-name"
                  aria-label={`${t.rename}: ${openName ?? ""}`}
                  onClick={() =>
                    folderOpen &&
                    startRename("folder", folderOpen, openName ?? t.folder)
                  }
                >
                  {openName}
                </button>
              )}
              <ul data-part="switch-band-tiles">{inside.map(renderTile)}</ul>
            </li>,
          ];
        })}
      </ul>
      {place === "trash" && (
        <p data-part="switch-foot">{top.length ? t.trashNote : t.trashEmpty}</p>
      )}
      {place === "merge" && merging && top.length === 0 && (
        <p data-part="switch-foot">
          {t.mergeNone(eventInfo(merging.event).label)}
        </p>
      )}
      {place === "list" && !showFind && (
        // While a tile is held the words keep their room, hidden: the grid stands at
        // the foot on a phone, and would drop under the finger if they went.
        <p data-part="switch-places" data-hidden={drag ? "" : undefined}>
          {/* A touch screen has no typing to start a find; with a few rows the grid
              is seen whole, and `Find` would only be one more word. */}
          {liveCount > FIND_FROM && (
            <button
              type="button"
              data-action="switch-find"
              onClick={() => {
                beforeFind.current = selected ?? null;
                setFinding(true);
              }}
            >
              {t.find}
            </button>
          )}
          {archivedCount > 0 && (
            <button
              type="button"
              data-action="switch-view"
              data-id="archive"
              onClick={() => goTo("archive")}
            >
              {t.archiveView}
            </button>
          )}
          {(trash?.length ?? 0) > 0 && (
            <button
              type="button"
              data-action="switch-view"
              data-id="trash"
              onClick={() => goTo("trash")}
            >
              {t.trashView}
            </button>
          )}
        </p>
      )}
      {drag && drag.item.kind === "session" && (
        <p
          ref={trashTarget}
          data-part="switch-drop-trash"
          data-over={drag.target?.kind === "trash" || undefined}
        >
          {t.trashView}
        </p>
      )}
      {drag && dragged && (
        <div ref={ghost} data-part="switch-ghost" aria-hidden="true">
          <span data-part="tile-picture">{picture(dragged)}</span>
          <span data-part="switch-label">
            {"name" in dragged ? dragged.name : ""}
          </span>
        </div>
      )}
      {picked.size > 0 && !notice && place !== "merge" && (
        <p data-part="switch-picked">
          <button
            type="button"
            data-action="switch-merge-picked"
            onClick={() => {
              const first = view.sessions.find(({ id }) => picked.has(id));
              if (first) startMerge(first);
            }}
          >
            {t.mergePicked(picked.size)}
          </button>
          <button
            type="button"
            data-action="switch-delete-picked"
            onClick={() => remove([...picked])}
          >
            {t.deletePicked(picked.size)}
          </button>
          <button
            type="button"
            data-action="switch-picked-clear"
            aria-label={words.clearSelection}
            onClick={clearPicks}
          >
            ×
          </button>
        </p>
      )}
      {notice && (
        <p data-part="switch-undo" role="status">
          {notice.text}
          {notice.undo && (
            <button type="button" data-action="switch-undo" onClick={undo}>
              {t.undo}
            </button>
          )}
        </p>
      )}
    </dialog>
  );
}
