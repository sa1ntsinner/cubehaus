import {
  type EventId,
  type EventInfo,
  eventInfo,
  type Session,
  type Solve,
} from "@cubehaus/core";
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
import { dropPlace, type LayoutItem, listed, tree } from "../session-order";
import {
  defaultIndex,
  findMoveRows,
  findSwitchRows,
  type Mark,
  nextEvent,
  normalizeQuery,
  type SwitchRow,
} from "../session-switch";
import type { Text } from "../text";
import { formatFileResult } from "./file-result";

type Row = Session & { last: Solve | null };
type Zone = "before" | "on" | "after";
type Movable = Extract<SwitchRow, { kind: "session" | "folder" }>;
/** What the sheet lists: sessions, the archived ones, or the trash. */
type Place = "list" | "archive" | "trash";

const keyOf = (row: SwitchRow) => `${row.kind}:${row.id}`;
const movable = (row: SwitchRow | undefined): row is Movable =>
  row?.kind === "session" || row?.kind === "folder";
const itemOf = (row: Movable): LayoutItem => ({ kind: row.kind, id: row.id });
const mod = (event: { metaKey: boolean; ctrlKey: boolean }) =>
  /Mac|iPhone|iPad/.test(navigator.platform) ? event.metaKey : event.ctrlKey;

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

/** When an event is not official yet on this day, or will stop being (FTO, Clock). */
export function officialNote(
  info: EventInfo,
  text: Text,
  today = new Date(),
): string | null {
  const day = (iso: string) =>
    new Intl.DateTimeFormat(text.language === "en" ? "en-GB" : "ru", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${iso}T00:00:00Z`));
  const now = today.toISOString().slice(0, 10);
  if (info.officialFrom && now < info.officialFrom)
    return text.officialFrom(day(info.officialFrom));
  if (info.officialUntil && now <= info.officialUntil)
    return text.officialUntil(day(info.officialUntil));
  return null;
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

/** A press or drag on a row, from the pointer's first contact. */
interface Gesture {
  pointerId: number;
  touch: boolean;
  x: number;
  y: number;
  row: Movable;
  lifted: boolean;
  moved: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * The session switch (DESIGN.md section 10): the query line, folders and sessions with
 * their last results, then each puzzle that has no session yet. Typing filters; Enter
 * picks the highlighted row, which starts on the session open before this one; Tab
 * changes the puzzle of a new session; F2, a swipe to the right or the row's menu renames
 * in place; Mod+Backspace, a swipe to the left or the menu archives; Alt+Up and Alt+Down
 * move a row, a drag (a long press on a touch screen) moves it or, dropped on a session,
 * makes a folder of the two; Left and Right close and open a folder; Shift with an arrow
 * or a click, or Mod with a click, picks sessions together, which the row's menu (also
 * the menu key or Shift+F10) merges into another of their puzzle; Mod+Z undoes; Esc,
 * or a click on the empty ground, closes. The archive and the trash are lists of their
 * own, reached from the last rows. A modal dialog: the page behind takes no focus and no
 * input.
 */
export function SessionSwitch({
  app,
  view,
  words,
  renameCurrent = false,
  startIn = "list",
  moving,
  onClose,
}: {
  app: AppState;
  view: AppView;
  words: Text;
  /** Opened by F2: the open session's name is ready to edit. */
  renameCurrent?: boolean;
  /** Where the sheet opens: the sessions, the archive or the trash. */
  startIn?: Place;
  /**
   * Picking where solves go (M) instead of a session to open: only the other sessions of
   * their puzzle, or a new one by name; nothing is arranged here.
   */
  moving?: {
    count: number;
    event: EventId;
    onPick(to: string | { name: string }): void;
  };
  onClose(): void;
}) {
  const t = words.switcher;
  const language = view.settings.language;
  const current = view.current;
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState<Row[] | null>(null);
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
  const [menu, setMenu] = useState<string | null>(null);
  // The menu opened from the keyboard takes the focus to its first word.
  const menuByKeys = useRef(false);
  // Sessions picked together (Shift or Mod with a click or an arrow), and where a Shift
  // range starts.
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  // Choosing where picked sessions go: the other sessions of their puzzle.
  const [merging, setMerging] = useState<{
    ids: readonly string[];
    names: readonly string[];
    event: EventId;
  } | null>(null);
  // The folder holding the open session shows open, whatever it stores, until it is
  // closed or opened here.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => {
    const folder = view.folders.find(({ id }) => id === current?.folderId);
    return new Set(folder?.collapsed ? [folder.id] : []);
  });
  const [drag, setDrag] = useState<{
    key: string;
    item: LayoutItem;
    over: { key: string; item: LayoutItem; zone: Zone } | null;
  } | null>(null);
  const [place, setPlace] = useState<Place>(startIn);
  const [trash, setTrash] = useState<TrashEntry[] | null>(null);
  // What just changed, said once at the foot of the sheet, with its undo where it has one.
  const [notice, setNotice] = useState<{ text: string; undo: boolean } | null>(
    null,
  );
  // Once the query is touched the column stays at the top, clear of the keyboard: a jump
  // back when the field loses focus would move the row under a finger mid-tap.
  const [searching, setSearching] = useState(false);
  const busy = useRef(false);
  const gesture = useRef<Gesture | null>(null);
  // The click a drag, long press or swipe ends with picks nothing.
  const swallowClick = useRef(false);
  // A rename ends once: Enter, Esc or leaving the field, whichever comes first.
  const editing = useRef(renaming !== null);
  // F2 on the timer renames and goes back; a rename started here stays here.
  const closeAfterRename = useRef(renameCurrent);
  const reveal = useRef(true);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const queryInput = useRef<HTMLInputElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);

  // The last results come from one read when the switch opens and after a change here.
  const sessionsKey = view.sessions
    .map(
      ({ id, name, event, folderId, orderKey, archived }) =>
        `${id}:${name}:${event}:${folderId}:${orderKey}:${archived}`,
    )
    .join("|");
  // A solve put back from the trash changes no session; it reads the trash again.
  const [trashRead, setTrashRead] = useState(0);
  useEffect(() => {
    let live = true;
    void sessionsKey;
    void trashRead;
    void app.switchRows().then((rows) => {
      if (live) setLoaded(rows);
    });
    void app.trash().then((entries) => {
      if (live) setTrash(entries);
    });
    return () => {
      live = false;
    };
  }, [app, sessionsKey, trashRead]);
  // Order and folders follow the view at once; the last results follow their read.
  const sessions: readonly Row[] = useMemo(() => {
    const last = new Map(loaded?.map(({ id, last }) => [id, last]));
    return view.sessions.map((session) => ({
      ...session,
      last: last.get(session.id) ?? null,
    }));
  }, [view.sessions, loaded]);
  const last = useMemo(
    () => new Map(sessions.map(({ id, last }) => [id, last])),
    [sessions],
  );

  const currentId = current?.id ?? null;
  const movingEvent = moving?.event;
  const rows = useMemo((): SwitchRow[] => {
    if (merging)
      return findMoveRows(
        query,
        sessions,
        null,
        merging.event,
        view.folders,
      ).filter(
        (row) => row.kind === "session" && !merging.ids.includes(row.id),
      );
    if (movingEvent)
      return findMoveRows(
        query,
        sessions,
        currentId,
        movingEvent,
        view.folders,
      );
    if (place === "trash")
      return (trash ?? []).map((entry) => ({
        kind: "trashed",
        id: `${entry.kind}:${entry.id}`,
        label:
          entry.kind === "session"
            ? entry.session.name
            : formatFileResult(entry.solve),
        event:
          entry.kind === "session" ? entry.session.event : entry.solve.event,
        marks: [],
        entry,
      }));
    if (place === "archive")
      return sessions
        .filter(({ archived }) => archived)
        .map(({ id, name, event, folderId }) => ({
          kind: "session",
          id,
          label: name,
          event,
          marks: [],
          folderId,
          depth: 0,
          archived: true,
        }));
    const found = findSwitchRows(
      query,
      sessions,
      currentId,
      language,
      createEvent,
      view.folders,
      opened,
    );
    if (normalizeQuery(query)) return found;
    // The archive and the trash after the sessions, before the puzzles with none, while
    // they hold anything.
    const archived = sessions.filter(
      ({ id, archived }) => archived && id !== currentId,
    ).length;
    const views: SwitchRow[] = [];
    if (archived)
      views.push({
        kind: "view",
        id: "archive",
        label: t.archiveView,
        event: "333",
        marks: [],
        count: archived,
      });
    if (trash?.length)
      views.push({
        kind: "view",
        id: "trash",
        label: t.trashView,
        event: "333",
        marks: [],
        count: trash.length,
      });
    const puzzles = found.findIndex(({ kind }) => kind === "event");
    return puzzles < 0
      ? [...found, ...views]
      : [...found.slice(0, puzzles), ...views, ...found.slice(puzzles)];
  }, [
    merging,
    movingEvent,
    place,
    trash,
    query,
    sessions,
    currentId,
    language,
    createEvent,
    view.folders,
    opened,
    t,
  ]);
  const found =
    selectedKey === null
      ? -1
      : rows.findIndex((row) => keyOf(row) === selectedKey);
  const active = Math.min(
    found >= 0
      ? found
      : defaultIndex(rows, query, view.previousId, current?.id ?? null),
    rows.length - 1,
  );
  const highlighted = rows[active];
  // Rows move among the rows as shown: the archived ones are not in the way.
  const nodes = useMemo(
    () => tree(listed(view.sessions, currentId), view.folders),
    [view.sessions, view.folders, currentId],
  );

  useLayoutEffect(() => {
    const sheet = dialog.current;
    if (!sheet || sheet.open) return;
    // Modal: the page behind is inert, so focus and clicks stay in the sheet.
    if (typeof sheet.showModal === "function") sheet.showModal();
    else sheet.setAttribute("open", "");
    // A keyboard is at hand on a desktop: the query takes the typing. On a touch screen
    // the list comes first and the keyboard only when the query is touched; the sheet
    // itself holds focus, not its first button.
    if (editing.current) return;
    if (queryInput.current && matchMedia("(hover: hover)").matches)
      queryInput.current.focus();
    else sheet.focus({ preventScroll: true });
  }, []);
  // A change of place moves focus once the new place is on screen: to the query where
  // there is one and a keyboard at hand, else to the sheet, which takes the keys.
  const firstPlace = useRef(true);
  useLayoutEffect(() => {
    void place;
    if (firstPlace.current) {
      firstPlace.current = false;
      return;
    }
    if (queryInput.current && matchMedia("(hover: hover)").matches)
      queryInput.current.focus({ preventScroll: true });
    else dialog.current?.focus({ preventScroll: true });
  }, [place]);
  // After the sheet has taken focus, so opening it never pulls focus off the field.
  const renamingKey = renaming ? `${renaming.kind}:${renaming.id}` : null;
  useLayoutEffect(() => {
    if (renamingKey !== null) renameInput.current?.focus();
  }, [renamingKey]);
  // The highlighted row stays in view when the keys move it, and on opening; a pointer
  // that moves it is already over it.
  useEffect(() => {
    if (!reveal.current) return;
    reveal.current = false;
    list.current
      ?.querySelector("[data-selected]")
      ?.scrollIntoView({ block: "nearest" });
  });
  useEffect(() => {
    if (!menu || !menuByKeys.current) return;
    menuByKeys.current = false;
    list.current
      ?.querySelector<HTMLButtonElement>(
        'li[data-menu] [data-part="switch-menu"] button',
      )
      ?.focus();
  }, [menu]);
  // Once a row is lifted the finger drags it; the list does not scroll under it.
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
      clearTimeout(noticeTimer.current);
    },
    [],
  );

  /** Rows that can be arranged here: renamed, dragged, given a menu. */
  const arrange = (row: SwitchRow | undefined): row is Movable =>
    !moving && !merging && movable(row);

  function pick(row: SwitchRow | undefined) {
    if (!row || busy.current) return;
    if (merging) {
      if (row.kind !== "session") return;
      const { ids } = merging;
      setMerging(null);
      setQuery("");
      clearPicks();
      setSelectedKey(keyOf(row));
      reveal.current = true;
      void app.mergeSessions(ids, row.id).then((result) => {
        if ("into" in result) say(t.merged(result.into.name));
        else say(t.notMerged[result.error], false);
      });
      return;
    }
    if (moving) {
      if (row.kind !== "session" && row.kind !== "create") return;
      busy.current = true;
      onClose();
      moving.onPick(row.kind === "session" ? row.id : { name: row.label });
      return;
    }
    if (row.kind === "folder") {
      toggleFolder(row, !row.collapsed);
      return;
    }
    if (row.kind === "view") {
      goTo(row.id);
      return;
    }
    if (row.kind === "trashed") {
      restore(row);
      return;
    }
    busy.current = true;
    onClose();
    if (row.kind === "session") {
      if (row.id !== current?.id) void app.selectSession(row.id);
    } else if (row.kind === "event") {
      void app.openEvent(row.event, eventInfo(row.event).label);
    } else {
      void app.newSession(row.label, row.event);
    }
  }

  function toggleFolder(
    row: Extract<SwitchRow, { kind: "folder" }>,
    close: boolean,
  ) {
    setSelectedKey(keyOf(row));
    if (opened.has(row.id))
      setOpened((now) => new Set([...now].filter((id) => id !== row.id)));
    void app.collapseFolder(row.id, close);
  }

  function say(text: string, undo = true) {
    setNotice({ text, undo });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  }

  function clearPicks() {
    anchor.current = null;
    setPicked((now) => (now.size ? new Set() : now));
  }

  /** The session rows from one key to another as listed, both in. */
  function span(from: string, to: string): string[] {
    const a = rows.findIndex((row) => keyOf(row) === from);
    const b = rows.findIndex((row) => keyOf(row) === to);
    if (a < 0 || b < 0) return [];
    return rows
      .slice(Math.min(a, b), Math.max(a, b) + 1)
      .flatMap((row) => (row.kind === "session" ? [row.id] : []));
  }

  /** Shift+Up / Shift+Down: the pick runs from where it started to the next row. */
  function extendPick(step: number) {
    const next = rows[Math.max(0, Math.min(rows.length - 1, active + step))];
    if (!next) return;
    reveal.current = true;
    setSelectedKey(keyOf(next));
    const from =
      anchor.current ??
      (highlighted?.kind === "session" ? keyOf(highlighted) : null);
    if (from === null) return;
    anchor.current = from;
    setPicked(new Set(span(from, keyOf(next))));
  }

  /** Mod+click adds or drops one session; Shift+click picks the run to it. */
  function pickByClick(
    row: Extract<SwitchRow, { kind: "session" }>,
    range: boolean,
  ) {
    const key = keyOf(row);
    setSelectedKey(key);
    setMenu(null);
    if (range && anchor.current) {
      setPicked(new Set(span(anchor.current, key)));
      return;
    }
    anchor.current = key;
    setPicked((now) => {
      const next = new Set(now);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }

  /** Another live session of this puzzle to take what is merged. */
  function mergeable(row: { id: string; event: EventId }) {
    const going = picked.has(row.id) ? picked : new Set([row.id]);
    return sessions.some(
      ({ id, event, archived }) =>
        event === row.event && !archived && !going.has(id),
    );
  }

  /** The row's session, or every picked one when it is picked, to merge somewhere. */
  function startMerge(row: { id: string; event: EventId }) {
    setMenu(null);
    const going = picked.has(row.id) ? picked : new Set([row.id]);
    const chosen = sessions.filter(({ id }) => going.has(id));
    if (chosen.some(({ event }) => event !== row.event)) {
      // The pick stays as it was, to change it.
      say(t.notMerged.event, false);
      return;
    }
    if (!picked.has(row.id)) clearPicks();
    setMerging({
      ids: chosen.map(({ id }) => id),
      names: chosen.map(({ name }) => name),
      event: row.event,
    });
    setPlace("list");
    setQuery("");
    setSelectedKey(null);
    setNotice(null);
    reveal.current = true;
    if (matchMedia("(hover: hover)").matches)
      queryInput.current?.focus({ preventScroll: true });
    else dialog.current?.focus({ preventScroll: true });
  }

  /** A change from here: say it, with its undo, for a few seconds. */
  function changed(work: Promise<unknown>, text = t.moved) {
    void work.then(() => say(text));
  }

  function undo() {
    setNotice(null);
    clearTimeout(noticeTimer.current);
    void app.undo();
  }

  function archive(row: Extract<SwitchRow, { kind: "session" }>) {
    setMenu(null);
    changed(
      app.archiveSession(row.id, !row.archived),
      row.archived ? t.unarchived : t.archived,
    );
  }

  /** Into the archive or the trash, or back to the sessions. */
  function goTo(next: Place) {
    const from = place;
    setPlace(next);
    setMenu(null);
    setNotice(null);
    clearPicks();
    setQuery("");
    reveal.current = true;
    // Back on the row it was reached from.
    setSelectedKey(next === "list" ? `view:${from}` : null);
  }

  function restore(row: Extract<SwitchRow, { kind: "trashed" }>) {
    const { entry } = row;
    // The row goes at once; the read after the write confirms it.
    setTrash((now) => now?.filter((item) => item !== entry) ?? null);
    void app.restoreFromTrash(entry).then(() => {
      setTrashRead((n) => n + 1);
      say(t.restored(row.label), false);
    });
  }

  async function makeFolder(sessionIds: readonly string[]) {
    const id = await app.groupSessions(sessionIds, t.folder);
    if (id === null) return;
    say(t.moved);
    // The new folder's name is ready to type over.
    setSelectedKey(`folder:${id}`);
    startRename("folder", id, t.folder);
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
    else if (place === "list")
      queryInput.current?.focus({ preventScroll: true });
    else dialog.current?.focus({ preventScroll: true });
    closeAfterRename.current = false;
  }

  function saveRename(name: string) {
    if (!editing.current || !renaming) return;
    const trimmed = name.trim();
    if (renaming.kind === "folder") {
      if (trimmed) void app.renameFolder(renaming.id, trimmed);
    } else {
      const before = sessions.find(({ id }) => id === renaming.id)?.name;
      if (trimmed && trimmed !== before)
        void app.renameSession(renaming.id, trimmed);
    }
    endRename();
  }

  function back() {
    if (drag) {
      // The release that follows ends nothing.
      swallowClick.current = true;
      endGesture();
    } else if (menu) {
      setMenu(null);
      // From a word of the menu, back to where the keys were.
      if (list.current?.contains(document.activeElement)) {
        if (place === "list" && matchMedia("(hover: hover)").matches)
          queryInput.current?.focus({ preventScroll: true });
        else dialog.current?.focus({ preventScroll: true });
      }
    } else if (merging) {
      setMerging(null);
      setQuery("");
      setSelectedKey(null);
    } else if (picked.size) clearPicks();
    else if (place !== "list") goTo("list");
    else onClose();
  }

  // ---- dragging: a mouse moves a row at once, a finger after a long press ----

  function endGesture() {
    if (gesture.current?.timer) clearTimeout(gesture.current.timer);
    gesture.current = null;
    setDrag(null);
  }

  function lift(press: Gesture) {
    press.lifted = true;
    setMenu(null);
    setSelectedKey(keyOf(press.row));
    setDrag({ key: keyOf(press.row), item: itemOf(press.row), over: null });
  }

  function onPointerDown(row: Movable, down: PointerEvent<HTMLButtonElement>) {
    if (down.button !== 0 || query || renaming) return;
    // The archive has no order of its own: a press there is a pick or a swipe.
    const still = place !== "list";
    swallowClick.current = false;
    endGesture();
    const press: Gesture = {
      pointerId: down.pointerId,
      touch: down.pointerType !== "mouse",
      x: down.clientX,
      y: down.clientY,
      row,
      lifted: false,
      moved: false,
    };
    gesture.current = press;
    // A finger is held by the row it pressed already; a mouse is caught here.
    if (still) {
      if (!press.touch) gesture.current = null;
    } else if (press.touch)
      press.timer = setTimeout(() => {
        if (gesture.current === press && !press.moved) lift(press);
      }, 450);
    else down.currentTarget.setPointerCapture(down.pointerId);
  }

  function onPointerMove(move: PointerEvent<HTMLButtonElement>) {
    const press = gesture.current;
    if (!press || press.pointerId !== move.pointerId) return;
    const dx = move.clientX - press.x;
    const dy = move.clientY - press.y;
    const far = Math.hypot(dx, dy);
    if (!press.lifted) {
      if (far > (press.touch ? 8 : 4)) {
        press.moved = true;
        if (press.touch) {
          if (press.timer) clearTimeout(press.timer);
        } else lift(press);
      }
      if (!press.lifted) return;
    }
    press.moved = press.moved || far > 4;
    // The row under the pointer, and where on it: its top quarter, middle or bottom.
    const under = document
      .elementFromPoint(move.clientX, move.clientY)
      ?.closest<HTMLLIElement>("li[data-row]");
    const row = rows.find((item) => under && keyOf(item) === under.dataset.key);
    let over: NonNullable<typeof drag>["over"] = null;
    if (under && movable(row) && keyOf(row) !== keyOf(press.row)) {
      const box = under.getBoundingClientRect();
      const at = (move.clientY - box.top) / box.height;
      const middle = press.row.kind === "session";
      const zone: Zone = middle
        ? at < 0.25
          ? "before"
          : at > 0.75
            ? "after"
            : "on"
        : at < 0.5
          ? "before"
          : "after";
      over = { key: keyOf(row), item: itemOf(row), zone };
    }
    setDrag((now) =>
      now && (now.over?.key !== over?.key || now.over?.zone !== over?.zone)
        ? { ...now, over }
        : now,
    );
    // Near the sheet's top or bottom edge the list scrolls under the row.
    const sheet = dialog.current;
    if (sheet) {
      const edge = sheet.getBoundingClientRect();
      if (move.clientY < edge.top + 64) sheet.scrollBy(0, -12);
      else if (move.clientY > edge.bottom - 64) sheet.scrollBy(0, 12);
    }
  }

  function onPointerUp(up: PointerEvent<HTMLButtonElement>) {
    const press = gesture.current;
    if (!press || press.pointerId !== up.pointerId) return;
    if (press.timer) clearTimeout(press.timer);
    const dx = up.clientX - press.x;
    const dy = up.clientY - press.y;
    if (press.lifted) {
      swallowClick.current = true;
      const target = drag?.over;
      endGesture();
      if (!press.moved) {
        // A long press without a drag: the row's menu.
        setMenu(keyOf(press.row));
        return;
      }
      if (!target) return;
      const drop = dropPlace(
        nodes,
        itemOf(press.row),
        target.item,
        target.zone,
      );
      if (!drop) return;
      if (drop.kind === "group") void makeFolder([drop.target, press.row.id]);
      else changed(app.placeItem(itemOf(press.row), drop));
      return;
    }
    gesture.current = null;
    // A sideways swipe on a touch screen: to the right renames the row in place, to the
    // left puts a session into the archive (or, in the archive, back).
    if (press.touch && Math.abs(dx) >= 60 && Math.abs(dx) > 2 * Math.abs(dy)) {
      swallowClick.current = true;
      if (dx > 0) startRename(press.row.kind, press.row.id, press.row.label);
      else if (press.row.kind === "session") archive(press.row);
    }
  }

  function onKeys(event: KeyboardEvent) {
    if (renaming || event.defaultPrevented || event.nativeEvent.isComposing)
      return;
    const typingText =
      event.target === queryInput.current &&
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey;
    const key = (id: string) =>
      !typingText && actionKey(view.keymap, id, event);
    // The switch answers its own keys; none reaches the timer's table.
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    // In an open menu the arrows go from word to word, round the ends (Tab does not
    // reach buttons in every browser).
    const actions =
      event.target instanceof Element
        ? event.target.closest('[data-part="switch-menu"]')
        : null;
    const step = key("sheet-menu.previous")
      ? -1
      : key("sheet-menu.next")
        ? 1
        : undefined;
    if (actions && step !== undefined) {
      handled();
      const buttons = [...actions.querySelectorAll("button")];
      const at = buttons.indexOf(event.target as HTMLButtonElement);
      buttons[(at + step + buttons.length) % buttons.length]?.focus();
      return;
    }
    const move = (step: number) => {
      handled();
      reveal.current = true;
      const next = rows[Math.max(0, Math.min(rows.length - 1, active + step))];
      if (next) setSelectedKey(keyOf(next));
    };
    // In the archive and the trash the sheet itself takes the keys; there is no query.
    const inQuery =
      event.target === queryInput.current ||
      (place !== "list" && event.target === dialog.current);
    const tidy = !query && place === "list" && !moving && !merging;
    if (key("sheet.close")) {
      handled();
      back();
    } else if (
      (key("sheet.moveUp") || key("sheet.moveDown")) &&
      tidy &&
      arrange(highlighted)
    ) {
      handled();
      reveal.current = true;
      setSelectedKey(keyOf(highlighted));
      changed(app.stepItem(itemOf(highlighted), key("sheet.moveUp") ? -1 : 1));
    } else if (
      (key("sheet.selectPrevious") || key("sheet.selectNext")) &&
      !moving &&
      !merging &&
      place !== "trash"
    ) {
      handled();
      extendPick(key("sheet.selectPrevious") ? -1 : 1);
    } else if (key("sheet.menu") && arrange(highlighted)) {
      handled();
      menuByKeys.current = true;
      setSelectedKey(keyOf(highlighted));
      setMenu(keyOf(highlighted));
    } else if (key("sheet.next")) move(1);
    else if (key("sheet.previous")) move(-1);
    else if (
      (key("sheet.collapse") || key("sheet.expand")) &&
      tidy &&
      inQuery &&
      highlighted
    ) {
      const close = key("sheet.collapse");
      if (highlighted.kind === "folder") {
        handled();
        if (highlighted.collapsed !== close) toggleFolder(highlighted, close);
      } else if (close && highlighted.kind === "session" && highlighted.depth) {
        // Left from a session in a folder goes to its folder's row.
        handled();
        reveal.current = true;
        setSelectedKey(`folder:${highlighted.folderId}`);
      }
    } else if (key("sheet.pick")) {
      if (!inQuery) return;
      handled();
      pick(highlighted);
    } else if (
      (key("sheet.eventNext") || key("sheet.eventPrevious")) &&
      inQuery &&
      !moving &&
      !merging &&
      highlighted?.kind === "create"
    ) {
      handled();
      setCreateEvent((now) =>
        nextEvent(now, key("sheet.eventPrevious") ? -1 : 1),
      );
    } else if (
      key("sheet.archive") &&
      !query &&
      !moving &&
      !merging &&
      highlighted?.kind === "session"
    ) {
      // With text in the query the keys keep their editing meaning.
      handled();
      archive(highlighted);
    } else if (
      key("sheet.rename") &&
      arrange(highlighted) &&
      place !== "trash"
    ) {
      handled();
      startRename(highlighted.kind, highlighted.id, highlighted.label);
    } else if (key("sheet.group") && tidy && highlighted?.kind === "session") {
      handled();
      void makeFolder([highlighted.id]);
    } else if (
      key("sheet.undo") &&
      !moving &&
      !merging &&
      !(inQuery && query)
    ) {
      handled();
      undo();
    }
  }

  return (
    <dialog
      ref={dialog}
      tabIndex={-1}
      data-part="switch"
      data-no-timer
      data-dragging={drag ? "" : undefined}
      data-searching={searching || undefined}
      data-view={place === "list" ? undefined : place}
      data-purpose={moving ? "move" : merging ? "merge" : undefined}
      aria-label={
        moving ? t.moveTitle : merging ? t.mergeTitle : words.sessions
      }
      onKeyDown={onKeys}
      // Esc is answered above; this is the system's back gesture.
      onCancel={(cancel) => {
        cancel.preventDefault();
        if (!renaming) back();
      }}
      // The empty ground around the column is the backdrop.
      onClick={(click) => {
        if (
          !renaming &&
          (click.target === click.currentTarget ||
            click.target === list.current)
        )
          back();
      }}
    >
      <button type="button" data-action="dialog-close" onClick={onClose}>
        {words.backToTimer}
      </button>
      {place !== "list" ? (
        <p data-part="switch-find">
          <button
            type="button"
            data-action="switch-back"
            aria-label={t.back}
            onClick={() => goTo("list")}
          >
            <span aria-hidden="true">‹</span>
            {place === "trash" ? t.trashView : t.archiveView}
          </button>
        </p>
      ) : (
        <label data-part="switch-find">
          <span aria-hidden="true">›</span>
          <input
            ref={queryInput}
            type="search"
            data-part="switch-query"
            aria-controls="switch-list"
            aria-label={
              moving
                ? t.moveQuery(moving.count)
                : merging
                  ? t.mergeQuery(merging.names)
                  : t.query
            }
            placeholder={
              moving
                ? t.moveQuery(moving.count)
                : merging
                  ? t.mergeQuery(merging.names)
                  : t.query
            }
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
            value={query}
            onFocus={() => setSearching(true)}
            onChange={(change) => {
              setQuery(change.target.value);
              setSelectedKey(null);
              setMenu(null);
              reveal.current = true;
            }}
          />
        </label>
      )}
      <ul ref={list} id="switch-list" data-part="switch-list">
        {rows.map((row, index) => {
          const key = keyOf(row);
          const isSelected = index === active;
          const isCurrent = row.kind === "session" && row.id === current?.id;
          const id = `switch-${row.kind}-${row.id}`;
          const depth = row.kind === "session" ? row.depth : undefined;
          const holdsCurrent =
            row.kind === "folder" &&
            row.collapsed &&
            current?.folderId === row.id;
          if (
            arrange(row) &&
            renaming?.id === row.id &&
            renaming.kind === row.kind
          )
            return (
              <li
                key={key}
                id={id}
                data-key={key}
                data-row={row.kind}
                data-id={row.id}
                data-depth={depth || undefined}
                data-selected
                data-current={isCurrent || undefined}
                data-renaming
              >
                <input
                  ref={renameInput}
                  data-part="switch-rename"
                  aria-label={
                    row.kind === "folder" ? t.folder : words.sessionName
                  }
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="done"
                  value={renaming.name}
                  onFocus={(focus) => focus.currentTarget.select()}
                  onChange={(change) =>
                    setRenaming({ ...renaming, name: change.target.value })
                  }
                  onKeyDown={(key) => {
                    if (actionKey(view.keymap, "sheet-rename.save", key)) {
                      key.preventDefault();
                      saveRename(renaming.name);
                    } else if (
                      actionKey(view.keymap, "sheet-rename.cancel", key)
                    ) {
                      key.preventDefault();
                      key.stopPropagation();
                      endRename();
                    }
                  }}
                  onBlur={() => saveRename(renaming.name)}
                />
              </li>
            );
          const result = row.kind === "session" ? last.get(row.id) : null;
          const note =
            row.kind === "event"
              ? officialNote(eventInfo(row.id), words)
              : row.kind === "session" && row.archived && place === "list"
                ? t.archivedMark
                : row.kind === "trashed"
                  ? row.entry.kind === "session"
                    ? t.solves(row.entry.count)
                    : row.entry.sessionName
                  : null;
          const left =
            row.kind === "trashed"
              ? t.left(timeLeft(row.entry.expiresAt - Date.now(), language))
              : null;
          const open = menu === key;
          return (
            <li
              key={key}
              id={id}
              data-key={key}
              data-row={row.kind}
              data-id={row.id}
              data-event={row.event}
              data-depth={depth || undefined}
              data-collapsed={
                row.kind === "folder" ? String(row.collapsed) : undefined
              }
              data-archived={
                (row.kind === "session" && row.archived) || undefined
              }
              data-selected={isSelected || undefined}
              data-picked={
                (row.kind === "session" && picked.has(row.id)) || undefined
              }
              data-current={isCurrent || holdsCurrent || undefined}
              data-menu={open || undefined}
              data-lifted={drag?.key === key || undefined}
              data-drop={drag?.over?.key === key ? drag.over.zone : undefined}
              onPointerMove={(pointer) => {
                if (pointer.pointerType === "mouse" && !isSelected && !drag)
                  setSelectedKey(key);
              }}
            >
              <button
                type="button"
                data-action="switch-pick"
                aria-current={isCurrent || undefined}
                aria-expanded={
                  row.kind === "folder" ? !row.collapsed : undefined
                }
                aria-label={
                  row.kind === "trashed" && left
                    ? t.restore(row.label, left)
                    : undefined
                }
                onPointerDown={
                  arrange(row) ? (down) => onPointerDown(row, down) : undefined
                }
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={endGesture}
                onContextMenu={(menuEvent) => {
                  if (!arrange(row)) return;
                  menuEvent.preventDefault();
                  // A finger's long press is the gesture's own; a right click opens it.
                  if (gesture.current?.touch) return;
                  setSelectedKey(key);
                  setMenu(key);
                }}
                onClick={(click) => {
                  if (swallowClick.current) {
                    swallowClick.current = false;
                    return;
                  }
                  if (
                    row.kind === "session" &&
                    !moving &&
                    !merging &&
                    place !== "trash" &&
                    (click.shiftKey || mod(click))
                  ) {
                    pickByClick(row, click.shiftKey);
                    return;
                  }
                  pick(row);
                }}
              >
                <span data-part="switch-label">
                  {row.kind === "create"
                    ? t.create(row.label)
                    : marked(row.label, row.marks)}
                </span>
                {(row.kind === "folder" || row.kind === "view") && (
                  <span data-part="switch-count">{row.count}</span>
                )}
                {note && <span data-part="switch-note">{note}</span>}
                {result && (
                  <span data-part="switch-last">
                    {formatFileResult(result)}
                  </span>
                )}
                {left && <span data-part="switch-left">{left}</span>}
              </button>
              {row.kind === "create" && !moving && (
                // Tab in the query does the same: the next event in WCA order.
                <button
                  type="button"
                  data-action="switch-event"
                  aria-label={t.event(eventInfo(row.event).label)}
                  onClick={() => setCreateEvent((now) => nextEvent(now))}
                >
                  {eventInfo(row.event).label}
                </button>
              )}
              {arrange(row) && open && (
                <span data-part="switch-menu">
                  <button
                    type="button"
                    data-action="switch-rename"
                    onClick={() => startRename(row.kind, row.id, row.label)}
                  >
                    {t.rename}
                  </button>
                  {row.kind === "session" && (
                    <button
                      type="button"
                      data-action={
                        row.archived ? "switch-unarchive" : "switch-archive"
                      }
                      onClick={() => archive(row)}
                    >
                      {row.archived ? t.unarchive : t.archive}
                    </button>
                  )}
                  {row.kind === "session" &&
                    row.folderId === null &&
                    place === "list" && (
                      <button
                        type="button"
                        data-action="switch-group"
                        onClick={() => {
                          setMenu(null);
                          void makeFolder([row.id]);
                        }}
                      >
                        {t.newFolder}
                      </button>
                    )}
                  {row.kind === "session" &&
                    row.folderId !== null &&
                    place === "list" && (
                      <button
                        type="button"
                        data-action="switch-out"
                        onClick={() => {
                          setMenu(null);
                          const host = nodes.findIndex(
                            (node) =>
                              node.kind === "folder" &&
                              node.folder.id === row.folderId,
                          );
                          const next = nodes[host + 1];
                          changed(
                            app.placeItem(itemOf(row), {
                              parent: null,
                              before: next
                                ? next.kind === "folder"
                                  ? next.folder.id
                                  : next.session.id
                                : null,
                            }),
                          );
                        }}
                      >
                        {t.moveOut}
                      </button>
                    )}
                  {row.kind === "session" && mergeable(row) && (
                    <button
                      type="button"
                      data-action="switch-merge"
                      onClick={() => startMerge(row)}
                    >
                      {t.merge}
                    </button>
                  )}
                  {row.kind === "session" && (
                    <button
                      type="button"
                      data-action="switch-delete"
                      onClick={() => {
                        setMenu(null);
                        changed(app.deleteSession(row.id), t.trashed);
                      }}
                    >
                      {t.delete}
                    </button>
                  )}
                </span>
              )}
              {arrange(row) && (
                <button
                  type="button"
                  data-action="switch-more"
                  aria-label={`${
                    row.kind === "folder"
                      ? t.folderActions
                      : words.sessionActions
                  }: ${row.label}`}
                  aria-expanded={open}
                  onClick={() => setMenu(open ? null : key)}
                />
              )}
            </li>
          );
        })}
      </ul>
      {merging && rows.length === 0 && (
        <p data-part="switch-foot">
          {t.mergeNone(eventInfo(merging.event).label)}
        </p>
      )}
      {picked.size > 0 && !merging && !notice && (
        <p data-part="switch-picked">
          <button
            type="button"
            data-action="switch-merge-picked"
            onClick={() => {
              const first = sessions.find(({ id }) => picked.has(id));
              if (first) startMerge(first);
            }}
          >
            {t.mergePicked(picked.size)}
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
      {moving && rows.length === 0 && (
        <p data-part="switch-foot">
          {t.moveNone(eventInfo(moving.event).label)}
        </p>
      )}
      {place === "trash" && (
        <p data-part="switch-foot">
          {rows.length ? t.trashNote : t.trashEmpty}
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
