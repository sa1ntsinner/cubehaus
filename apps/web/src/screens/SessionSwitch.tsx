import {
  type EventId,
  type EventInfo,
  eventInfo,
  type Session,
  type Solve,
} from "@cubehaus/core";
import {
  type KeyboardEvent,
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
  defaultIndex,
  findMoveRows,
  type Mark,
  type SwitchRow,
} from "../session-switch";
import type { Text } from "../text";
import { formatFileResult } from "./file-result";

type Row = Session & { last: Solve | null };

const keyOf = (row: SwitchRow) => `${row.kind}:${row.id}`;

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

/**
 * Where solves go (M; DESIGN.md section 10, *Moving solves*): the switch's list, kept
 * for this one choice since the sessions became a grid. The query line asks where to,
 * the list holds the other sessions of the solves' puzzle with their last results
 * (archived ones only in a search), and a typed name offers a new session of that
 * puzzle. ↑ ↓ move, Enter or a click moves the solves and closes, Esc or a click on the
 * empty ground closes. A modal dialog: the page behind takes no focus and no input.
 */
export function SessionSwitch({
  app,
  view,
  words,
  moving,
  onClose,
}: {
  app: AppState;
  view: AppView;
  words: Text;
  moving: {
    count: number;
    event: EventId;
    onPick(to: string | { name: string }): void;
  };
  onClose(): void;
}) {
  const t = words.switcher;
  const current = view.current;
  const currentId = current?.id ?? null;
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState<Row[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Once the query is touched the column stays at the top, clear of the keyboard.
  const [searching, setSearching] = useState(false);
  const busy = useRef(false);
  const reveal = useRef(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const queryInput = useRef<HTMLInputElement>(null);

  // The last results come from one read when the sheet opens, and again when the
  // sessions change under it (they may still be loading as it opens).
  const sessionsKey = view.sessions
    .map(({ id, archived }) => `${id}:${archived}`)
    .join("|");
  useEffect(() => {
    let live = true;
    void sessionsKey;
    void app.switchRows().then((rows) => {
      if (live) setLoaded(rows);
    });
    return () => {
      live = false;
    };
  }, [app, sessionsKey]);
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

  const rows = useMemo(
    () => findMoveRows(query, sessions, currentId, moving.event, view.folders),
    [query, sessions, currentId, moving.event, view.folders],
  );
  const found =
    selectedKey === null
      ? -1
      : rows.findIndex((row) => keyOf(row) === selectedKey);
  const active = Math.min(
    found >= 0 ? found : defaultIndex(rows, query, view.previousId, currentId),
    rows.length - 1,
  );
  const highlighted = rows[active];

  useLayoutEffect(() => {
    const sheet = dialog.current;
    if (!sheet || sheet.open) return;
    if (typeof sheet.showModal === "function") sheet.showModal();
    else sheet.setAttribute("open", "");
    // A keyboard at hand: the query takes the typing. A touch screen gets the list first.
    if (queryInput.current && matchMedia("(hover: hover)").matches)
      queryInput.current.focus();
    else sheet.focus({ preventScroll: true });
  }, []);
  // The highlighted row stays in view when the keys move it, and on opening.
  useEffect(() => {
    if (!reveal.current) return;
    reveal.current = false;
    list.current
      ?.querySelector("[data-selected]")
      ?.scrollIntoView({ block: "nearest" });
  });

  function pick(row: SwitchRow | undefined) {
    if (!row || busy.current) return;
    if (row.kind !== "session" && row.kind !== "create") return;
    busy.current = true;
    onClose();
    moving.onPick(row.kind === "session" ? row.id : { name: row.label });
  }

  function onKeys(event: KeyboardEvent) {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    const typingText =
      event.target === queryInput.current &&
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey;
    const key = (id: string) =>
      !typingText && actionKey(view.keymap, id, event);
    // The sheet answers its own keys; none reaches the timer's table.
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    const move = (step: number) => {
      handled();
      reveal.current = true;
      const next = rows[Math.max(0, Math.min(rows.length - 1, active + step))];
      if (next) setSelectedKey(keyOf(next));
    };
    if (key("sheet.close")) {
      handled();
      onClose();
    } else if (key("sheet.next")) move(1);
    else if (key("sheet.previous")) move(-1);
    else if (key("sheet.pick")) {
      handled();
      pick(highlighted);
    }
  }

  const ask = t.moveQuery(moving.count);
  return (
    <dialog
      ref={dialog}
      tabIndex={-1}
      data-part="switch"
      data-no-timer
      data-searching={searching || undefined}
      data-purpose="move"
      aria-label={t.moveTitle}
      onKeyDown={onKeys}
      // Esc is answered above; this is the system's back gesture.
      onCancel={(cancel) => {
        cancel.preventDefault();
        onClose();
      }}
      // The empty ground around the column is the backdrop.
      onClick={(click) => {
        if (
          click.target === click.currentTarget ||
          click.target === list.current
        )
          onClose();
      }}
    >
      <button
        type="button"
        data-action="dialog-close"
        onClick={() => onClose()}
      >
        {words.backToTimer}
      </button>
      <label data-part="switch-find">
        <span aria-hidden="true">›</span>
        <input
          ref={queryInput}
          type="search"
          data-part="switch-query"
          aria-controls="switch-list"
          aria-label={ask}
          placeholder={ask}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          value={query}
          onFocus={() => setSearching(true)}
          onChange={(change) => {
            setQuery(change.target.value);
            setSelectedKey(null);
            reveal.current = true;
          }}
        />
      </label>
      <ul ref={list} id="switch-list" data-part="switch-list">
        {rows.map((row, index) => {
          const key = keyOf(row);
          const isSelected = index === active;
          const result = row.kind === "session" ? last.get(row.id) : null;
          const archived = row.kind === "session" && row.archived;
          return (
            <li
              key={key}
              id={`switch-${row.kind}-${row.id}`}
              data-key={key}
              data-row={row.kind}
              data-id={row.id}
              data-event={row.event}
              data-archived={archived || undefined}
              data-selected={isSelected || undefined}
              onPointerMove={(pointer) => {
                if (pointer.pointerType === "mouse" && !isSelected)
                  setSelectedKey(key);
              }}
            >
              <button
                type="button"
                data-action="switch-pick"
                onClick={() => pick(row)}
              >
                <span data-part="switch-label">
                  {row.kind === "create"
                    ? t.create(row.label)
                    : marked(row.label, row.marks)}
                </span>
                {archived && (
                  <span data-part="switch-note">{t.archivedMark}</span>
                )}
                {result && (
                  <span data-part="switch-last">
                    {formatFileResult(result)}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {rows.length === 0 && (
        <p data-part="switch-foot">
          {t.moveNone(eventInfo(moving.event).label)}
        </p>
      )}
    </dialog>
  );
}
