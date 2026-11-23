import {
  type EventId,
  eventInfo,
  formatAverage,
  formatMoves,
  formatTime,
  hasTimePenalty,
  penaltyOf,
  type ResultKind,
  resultValue,
} from "@cubehaus/core";
import { parseStat, type StatId } from "@cubehaus/stats";
import {
  type CSSProperties,
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { AppState, AppView, Records, SolveRow } from "../app-state";
import { actionKey, type Keymap } from "../keys/keymap";
import { fitFile } from "../list/fit";
import {
  selectedSlots,
  solvesToGo,
  statId,
  supportsStat,
} from "../session-stats";

import type { Text } from "../text";

export { slotsFor } from "../session-stats";

// A past solve's numbers are as they stood; none of them is marked as a record.
const noRecords: Records = {
  best: false,
  ao5: false,
  ao12: false,
  mo3: false,
  ao100: false,
};

import { windowOf } from "../list/window";
import type { SessionStats } from "../session-stats";
import { formatFileResult } from "./file-result";

type InspectAverage = (
  name: StatId,
  best: boolean,
  opener: HTMLElement | null,
) => void;

export const SolveList = memo(function SolveList({
  app,
  view,
  words: text,
  onMove,
  onSplit,
  onStatPicker,
  onAverage,
  emptyHint,
}: {
  app: AppState;
  view: AppView;
  words: Text;
  /** Opens the sheet that picks where the solve on show, or the picked ones, go. */
  onMove(opener: HTMLElement): void;
  /** Everything before this solve into a new session. */
  onSplit(pivotId: string): void;
  onStatPicker?(open: boolean): void;
  onAverage?: InspectAverage;
  /** How to start an empty session, by keys and by touch; null: nothing to add. */
  emptyHint?: { keys: string | null; touch: string | null };
}) {
  const { layout, precision, recordCue } = view.settings;
  const filesVisible = layout !== "focus";
  const extendedFile = layout === "lift";
  const [editing, setEditing] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const newest = view.rows[0]?.solve;
  // A repeated solve keeps its line marked while its scramble is timed again.
  const shownId = view.repeat?.root.id ?? view.shown?.solve.id;
  const enabled =
    view.dbState?.kind === "persistent" || view.dbState?.kind === "memory";
  const count = enabled ? view.stats.count : view.rows.length;
  const list = useRef<HTMLOListElement>(null);
  const file = useRef<HTMLElement>(null);
  const rowHeight = useRef(0);
  const [range, setRange] = useState<ReturnType<typeof windowOf>>();
  const first = range?.first ?? 0;
  const last = Math.min(range?.last ?? 24, count);
  const [loaded, setLoaded] = useState<{
    first: number;
    rows: readonly SolveRow[];
  }>();

  useEffect(() => {
    if (!filesVisible || last <= view.rows.length) return;
    let stale = false;
    void app.page(view, first, last).then((rows) => {
      if (!stale && rows) setLoaded({ first, rows });
    });
    return () => {
      stale = true;
    };
  }, [app, view, first, last, filesVisible]);

  // Keep the previous window in place until the requested page arrives.
  const shown = !filesVisible
    ? { first: 0, rows: [] }
    : last <= view.rows.length
      ? { first, rows: view.rows.slice(first, last) }
      : (loaded ?? { first: 0, rows: view.rows.slice(0, 24) });

  const updateRange = useCallback(
    (element: HTMLOListElement) => {
      if (element.clientHeight === 0 || rowHeight.current === 0) return;
      const next = windowOf(
        -element.scrollTop,
        element.clientHeight,
        rowHeight.current,
        count,
      );
      setRange((previous) =>
        previous?.first === next.first &&
        previous.last === next.last &&
        previous.offset === next.offset
          ? previous
          : next,
      );
    },
    [count],
  );

  useLayoutEffect(() => {
    const element = list.current;
    if (!filesVisible || !element || count === 0) return;
    function sampleRow() {
      // An expanded comment editor and rows with comments can be taller.
      return element?.querySelector(
        extendedFile
          ? "li[data-solve-id]:not(:has([data-part=solve-comment], [data-part=comment-form]))"
          : "li[data-solve-id]",
      );
    }
    function measure() {
      if (!element) return;
      const sample =
        sampleRow() ??
        (rowHeight.current === 0
          ? element.querySelector("li[data-solve-id]")
          : null);
      const height = sample?.getBoundingClientRect().height;
      if (height) {
        rowHeight.current = height;
        // The top fade ends where the newest line starts (DESIGN §8).
        element.style.setProperty("--row", `${height}px`);
      }
      updateRange(element);
      fit();
    }
    // The file takes what the screen leaves it (a phone at large sizes): the totals give
    // way from the last, then the whole file, so nothing in it is cut or runs into the
    // averages or the actions.
    function fit() {
      const aside = file.current;
      if (!aside || !element) return;
      const parts = [...aside.children] as HTMLElement[];
      for (const part of parts) part.removeAttribute("data-fit-hidden");
      const totals = aside.querySelector<HTMLElement>(
        '[data-part="stats-totals"]',
      );
      for (const total of totals?.children ?? [])
        total.removeAttribute("data-fit-hidden");
      const shown = (part: Element) => part.getClientRects().length > 0;
      const gap = Number.parseFloat(getComputedStyle(aside).rowGap) || 0;
      const fixed = parts
        .filter((part) => part !== element && part !== totals && shown(part))
        .reduce((sum, part) => sum + part.offsetHeight + gap, 0);
      const rows = totals
        ? ([...totals.children] as HTMLElement[]).filter(shown)
        : [];
      const result = fitFile({
        room: aside.clientHeight,
        gap,
        row: rowHeight.current,
        fixed,
        totalsChrome:
          totals && rows.length > 0
            ? totals.offsetHeight -
              rows.reduce((sum, row) => sum + row.offsetHeight, 0)
            : 0,
        totals: rows.map((row) => row.offsetHeight),
      });
      element.style.setProperty("--room", `${result.list}px`);
      for (const row of rows.slice(result.totals))
        row.setAttribute("data-fit-hidden", "");
      if (totals && result.totals === 0)
        totals.setAttribute("data-fit-hidden", "");
      if (!result.lines)
        for (const part of parts) part.setAttribute("data-fit-hidden", "");
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (file.current) observer.observe(file.current);
    // A row changes height with the list's size (+ and −): observed, it is measured again.
    const sample = sampleRow();
    if (sample) observer.observe(sample);
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [count, extendedFile, filesVisible, updateRange]);

  // A past solve picked by the arrows stays in view, through every page that loads around
  // it, until a hand scrolls the file; back to now, the newest shows again.
  const shownNo = view.shown?.no;
  const followed = useRef(false);
  const follow = useRef<number | null>(null);
  const lastShown = useRef<number | undefined>(undefined);
  if (lastShown.current !== shownNo) {
    lastShown.current = shownNo;
    follow.current = shownNo ?? null;
  }
  useLayoutEffect(() => {
    const element = list.current;
    const height = rowHeight.current;
    if (!element || !height) return;
    if (shownNo === undefined) {
      if (followed.current) element.scrollTop = 0;
      followed.current = false;
      return;
    }
    if (follow.current !== shownNo) return;
    followed.current = true;
    const row = element.querySelector<HTMLElement>("li[data-shown]");
    if (row) {
      // On screen already: whole, clear of the fade at the file's top edge. A row taller
      // than the room (a comment on a phone's short file) keeps its number and time.
      const box = element.getBoundingClientRect();
      const at = row.getBoundingClientRect();
      // A phone's list holds whole lines only (its max-height is set to them): there the
      // line stands one whole line below the top, or at it when the list holds one.
      const whole = getComputedStyle(element).maxHeight !== "none";
      const top =
        box.top +
        (whole
          ? Math.max(0, Math.min(height, box.height - at.height))
          : Math.min(32, box.height / 3));
      const shift =
        at.top < top || at.height > box.bottom - top
          ? at.top - top
          : Math.max(0, at.bottom - box.bottom);
      // Runs on every render while it follows: settle, never swing between two edges.
      if (Math.abs(shift) >= 1) element.scrollTop += shift;
      return;
    }
    // Not drawn yet: jump near it (the list is reversed, the newest at its foot); the row
    // is set right once its page is drawn.
    const offset = count - shownNo;
    element.scrollTop = -Math.max(
      0,
      offset * height - element.clientHeight / 2,
    );
    updateRange(element);
  });

  const handsOn = () => {
    follow.current = null;
  };

  // Picking several lines: Shift+click a range, Mod+click one more; on a touch screen a
  // long press picks one, and while any are picked a tap picks or drops another.
  const picked = view.selected;
  const press = useRef<{
    id: string;
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const pressedBy = useRef<string>("mouse");
  const swallow = useRef(false);
  const endPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(
    () => () => {
      if (press.current) clearTimeout(press.current.timer);
    },
    [],
  );

  // The file is one tab stop, the line on show (else the newest); the arrows walk it:
  // up and down show the line before or after (the timer's own keys) and the keyboard
  // goes with it, left and right move between a line's time and its comment word.
  const focusId = shownId ?? newest?.id;
  const tabId = shown.rows.some(({ solve }) => solve.id === focusId)
    ? focusId
    : shown.rows[0]?.solve.id;
  const keyFollows = useRef(focusId);
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const element = list.current;
    const was = keyFollows.current;
    keyFollows.current = focusId;
    if (!element) return;
    const row = (id: string, action: string) =>
      element.querySelector<HTMLElement>(
        `li[data-solve-id="${CSS.escape(id)}"] [data-action="${action}"]`,
      );
    if (refocus.current && editing === null) {
      (
        row(refocus.current, "comment-edit") ??
        row(refocus.current, "solve-show")
      )?.focus();
      refocus.current = null;
      return;
    }
    const active = document.activeElement;
    if (was === focusId || !focusId || !active || !element.contains(active))
      return;
    if (active.closest("form")) return;
    row(focusId, "solve-show")?.focus({ preventScroll: true });
  });
  const walkRow = (key: ReactKeyboardEvent<HTMLOListElement>) => {
    if (key.altKey || key.metaKey || key.ctrlKey || key.shiftKey) return;
    if (key.key !== "ArrowLeft" && key.key !== "ArrowRight") return;
    const at = key.target as HTMLElement;
    const line = at.closest("li");
    if (!line || at.tagName !== "BUTTON") return;
    const stops = [
      ...line.querySelectorAll<HTMLElement>(
        '[data-action="solve-show"], [data-action="comment-edit"], [data-action="solve-split"]',
      ),
    ];
    const next = stops[stops.indexOf(at) + (key.key === "ArrowRight" ? 1 : -1)];
    if (!next) return;
    key.preventDefault();
    next.focus();
  };

  const height = rowHeight.current;
  const newer = shown.first;
  const older = Math.max(0, count - newer - shown.rows.length);
  // The actions and the slots answer for the solve on show, else the newest.
  const target = enabled
    ? (view.repeat?.shown ?? view.shown?.solve ?? newest)
    : undefined;
  const event = view.current?.event ?? "333";
  const timed = eventInfo(event).kind === "time";
  const past = view.shown;
  const stats = {
    stats: past ? { ...view.stats, ...past.stats } : view.stats,
    event,
    // While a scramble is repeated the newest solve is not the one set large.
    newestIsBest: past
      ? resultValue(past.solve) === past.stats.best
      : !view.repeat && view.newestIsBest,
    records: past || view.repeat || !recordCue ? noRecords : view.records,
    precision,
    slots: selectedSlots(event, view.settings.statSlots, layout),
    words: text,
  } as const;
  return (
    <>
      {filesVisible && (
        <aside
          ref={file}
          data-part="file"
          data-size-part="times"
          data-size={view.settings.sizes.times}
          aria-label={text.progress.solves}
        >
          <ol
            ref={list}
            data-part="solves"
            data-no-timer
            reversed
            start={count - newer}
            onScroll={(event) => updateRange(event.currentTarget)}
            onKeyDown={walkRow}
            onWheel={handsOn}
            onTouchStart={handsOn}
            onPointerDown={handsOn}
            style={{ overflowAnchor: "none" }}
          >
            <Spacer count={newer} height={height} />
            {shown.rows.map(({ solve, no, ao5, ao12, record }) => (
              <li
                key={solve.id}
                data-solve-id={solve.id}
                data-penalty={penaltyOf(solve)}
                data-plus2={solve.plus2}
                data-record={recordCue && !past && record ? true : undefined}
                data-shown={solve.id === shownId || undefined}
                data-selected={picked.has(solve.id) || undefined}
                aria-posinset={count - no + 1}
                aria-setsize={count}
                value={no}
                style={newer || older ? { flexShrink: 0 } : undefined}
              >
                <span data-part="solve-no">{no}</span>{" "}
                {/* The time shows the solve in the middle; the newest one is the live view. */}
                <button
                  type="button"
                  data-action="solve-show"
                  tabIndex={solve.id === tabId ? 0 : -1}
                  aria-pressed={solve.id === shownId}
                  onPointerDown={(down) => {
                    pressedBy.current = down.pointerType;
                    endPress();
                    swallow.current = false;
                    if (down.pointerType === "mouse" || !enabled) return;
                    const id = solve.id;
                    press.current = {
                      id,
                      x: down.clientX,
                      y: down.clientY,
                      timer: setTimeout(() => {
                        press.current = null;
                        swallow.current = true;
                        void app.toggleSelected(id);
                      }, 450),
                    };
                  }}
                  onPointerMove={(move) => {
                    const start = press.current;
                    if (
                      start &&
                      Math.hypot(
                        move.clientX - start.x,
                        move.clientY - start.y,
                      ) > 8
                    )
                      endPress();
                  }}
                  onPointerUp={endPress}
                  onPointerCancel={endPress}
                  onContextMenu={(menu) => {
                    // The long press is the pick; no system menu over it.
                    if (pressedBy.current !== "mouse") menu.preventDefault();
                  }}
                  onClick={(click) => {
                    if (swallow.current) {
                      swallow.current = false;
                      return;
                    }
                    if (!enabled) return;
                    if (click.shiftKey) void app.selectRange(solve.id);
                    else if (
                      click.metaKey ||
                      click.ctrlKey ||
                      (picked.size > 0 && pressedBy.current !== "mouse")
                    )
                      void app.toggleSelected(solve.id);
                    else
                      void (solve.id === newest?.id
                        ? app.live()
                        : app.showSolve(solve.id));
                  }}
                >
                  <span data-part="solve-time">
                    {formatFileResult(solve, precision)}
                  </span>
                </button>{" "}
                {solve.repeats ? (
                  <span
                    data-part="solve-repeats"
                    title={text.repeat.count(solve.repeats + 1)}
                  >
                    ×{solve.repeats + 1}
                  </span>
                ) : null}{" "}
                {extendedFile && timed && (
                  <>
                    <span data-part="solve-ao5">
                      {formatAverage(ao5, { precision })}
                    </span>{" "}
                    <span data-part="solve-ao12">
                      {formatAverage(ao12, { precision })}
                    </span>{" "}
                  </>
                )}
                {extendedFile && solve.comment !== null && (
                  <span data-part="solve-comment">
                    {text.commentPrefix}
                    {solve.comment}
                  </span>
                )}{" "}
                {extendedFile && editing === solve.id ? (
                  <form
                    data-part="comment-form"
                    onSubmit={(submit) => {
                      submit.preventDefault();
                      void app.setComment(solve, comment);
                      refocus.current = solve.id;
                      setEditing(null);
                    }}
                  >
                    <label>
                      {text.comment}
                      <textarea
                        data-part="comment-input"
                        // biome-ignore lint/a11y/noAutofocus: opened by its own button; the keyboard follows.
                        autoFocus
                        onKeyDown={(key) => {
                          if (key.key !== "Escape") return;
                          // Esc leaves the comment as it was and stays on the line.
                          key.preventDefault();
                          key.stopPropagation();
                          refocus.current = solve.id;
                          setEditing(null);
                        }}
                        value={comment}
                        onChange={(change) =>
                          setComment(change.currentTarget.value)
                        }
                      />
                    </label>
                    <button type="submit" data-action="comment-save">
                      {text.save}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        refocus.current = solve.id;
                        setEditing(null);
                      }}
                    >
                      {text.cancel}
                    </button>
                  </form>
                ) : picked.size === 1 && picked.has(solve.id) ? (
                  // One picked line is a place in the file: the session can part there.
                  <button
                    type="button"
                    data-action="solve-split"
                    tabIndex={-1}
                    onClick={() => onSplit(solve.id)}
                  >
                    {text.splitHere}
                  </button>
                ) : (
                  extendedFile &&
                  enabled && (
                    <button
                      type="button"
                      data-action="comment-edit"
                      tabIndex={-1}
                      onClick={() => {
                        setComment(solve.comment ?? "");
                        setEditing(solve.id);
                      }}
                    >
                      {text.comment}
                    </button>
                  )
                )}
              </li>
            ))}
            <Spacer count={older} height={height} />
          </ol>
          {enabled && count === 0 && emptyHint && (
            // Where the first line will stand, as a comment; one of the two shows (CSS).
            <p data-part="solves-empty">
              <span data-input="keys">
                {`// ${text.empty}.${emptyHint.keys ? ` ${emptyHint.keys}.` : ""}`}
              </span>
              <span data-input="touch">
                {`// ${text.empty}.${emptyHint.touch ? ` ${emptyHint.touch}.` : ""}`}
              </span>
              {/* The first visit (one session, nothing timed): old solves can come in.
                  Gone with the first solve, like the rest of the comment. */}
              {view.sessions.length === 1 && (
                <span data-part="solves-import">
                  {`// ${text.emptyImport} `}
                  <a href="#/settings/data" data-action="empty-import">
                    {`${text.settings.title} › ${text.settings.data}`}
                  </a>
                </span>
              )}
            </p>
          )}
          {count > view.rows.length && (
            <div data-no-timer>
              <button
                type="button"
                data-action="solves-more"
                disabled={last >= count}
                onClick={() => {
                  const element = list.current;
                  if (element) element.scrollTop -= element.clientHeight;
                }}
              >
                {text.moreSolves}
              </button>
            </div>
          )}
          {extendedFile && (
            <Stats
              {...stats}
              stats={view.stats}
              newestIsBest={
                past
                  ? resultValue(past.solve) === view.stats.best
                  : !view.repeat && view.newestIsBest
              }
              part="totals"
              onAverage={enabled ? onAverage : undefined}
            />
          )}
        </aside>
      )}
      <Stats
        {...stats}
        part="slots"
        size={view.settings.sizes.averages}
        onAverage={onAverage}
        today={
          view.settings.today && enabled && event !== "333mbf"
            ? view.today
            : undefined
        }
        picker={
          enabled
            ? { app, keymap: view.keymap, onOpen: onStatPicker }
            : undefined
        }
      />
      <div
        data-part="last-actions"
        data-no-timer
        data-penalty={target ? penaltyOf(target) : undefined}
        data-selecting={picked.size > 0 || undefined}
      >
        {picked.size > 0 ? (
          <>
            {/* The count rides on the actions: the picked lines show which. */}
            <button
              type="button"
              data-action="solve-move"
              onClick={(click) => onMove(click.currentTarget)}
            >
              {text.moveCount(picked.size)}
            </button>
            <button
              type="button"
              data-action="solve-delete"
              onClick={() => void app.deleteSelected()}
            >
              {text.deleteCount(picked.size)}
            </button>
            <button
              type="button"
              data-action="selection-clear"
              aria-label={text.clearSelection}
              onClick={() => void app.clearSelection()}
            >
              <span aria-hidden="true">×</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              data-action="penalty-ok"
              disabled={!target}
              onClick={() => target && void app.penalty(target, "ok")}
            >
              {text.penaltyOk}
            </button>
            {hasTimePenalty(event) && (
              <button
                type="button"
                data-action="penalty-plus2"
                disabled={!target}
                onClick={() => target && void app.penalty(target, "plus2")}
              >
                {text.penaltyPlus2}
              </button>
            )}
            <button
              type="button"
              data-action="penalty-dnf"
              disabled={!target}
              onClick={() => target && void app.penalty(target, "dnf")}
            >
              {text.penaltyDnf}
            </button>
            <button
              type="button"
              data-action="solve-delete"
              disabled={!target}
              onClick={() => target && void app.deleteSolve(target)}
            >
              {text.deleteSolve}
            </button>
            <button
              type="button"
              data-action="undo"
              disabled={!enabled || !view.canUndo}
              onClick={() => void app.undo()}
            >
              {text.undo}
            </button>
          </>
        )}
      </div>
    </>
  );
});

function Spacer({ count, height }: { count: number; height: number }) {
  if (!count || !height) return null;
  return (
    <li
      aria-hidden="true"
      style={{
        flex: `0 0 ${count * height}px`,
        padding: 0,
        pointerEvents: "none",
      }}
    />
  );
}

// The rolling stats printed in each timed solve's file row.
const fileColumns = [
  { name: "ao5", size: 5 },
  { name: "ao12", size: 12 },
] as const;

const availableStats = [
  "ao5",
  "ao12",
  "mo3",
  "ao50",
  "ao100",
  "best",
  "mean",
] as const;

function statLabel(name: StatId, words: Text): string {
  return name === "best" || name === "mean" ? words[name] : name;
}

function StatSlots({
  stats,
  event,
  newestIsBest,
  records,
  slots,
  words,
  picker,
  format,
  onAverage,
  today,
  size,
}: {
  today?: number | undefined;
  size: number;
  stats: SessionStats;
  event: EventId;
  newestIsBest: boolean;
  records: Records;
  slots: readonly StatId[];
  words: Text;
  picker:
    | {
        app: AppState;
        keymap: Keymap;
        onOpen: ((open: boolean) => void) | undefined;
      }
    | undefined;
  format(name: StatId, value: number): string;
  onAverage: InspectAverage | undefined;
}) {
  const tell = picker?.onOpen;
  const [choosing, setChoosing] = useState<{
    index: number;
    above: boolean;
    maxHeight: number;
  } | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const options = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState("");
  const [invalid, setInvalid] = useState(false);
  const choices = availableStats.filter((stat) => supportsStat(event, stat));
  const preview = choosing && picker ? picker.app.statPreview(choices) : null;
  useEffect(() => () => tell?.(false), [tell]);
  useLayoutEffect(() => {
    const panel = options.current;
    if (invalid && panel) panel.scrollTop = panel.scrollHeight;
  }, [invalid]);
  const chosenStat = choosing ? slots[choosing.index] : undefined;
  useLayoutEffect(() => {
    if (!chosenStat) return;
    const current = chosenStat;
    const selected = options.current?.querySelector<HTMLButtonElement>(
      `[data-stat-choice="${current}"]`,
    );
    (selected ?? options.current?.querySelector("button"))?.focus({
      preventScroll: true,
    });
  }, [chosenStat]);
  function close(restore: boolean) {
    setChoosing(null);
    tell?.(false);
    if (restore) opener.current?.focus({ preventScroll: true });
  }
  function pick(stat: StatId) {
    if (choosing) void picker?.app.setStatSlot(choosing.index, stat);
    close(true);
  }
  const windowName = chosenStat && parseStat(chosenStat) ? chosenStat : null;
  // An average still waiting for solves says how many, not a bare dash.
  const toGo = (name: StatId) => solvesToGo(name, stats.count);
  const inspect = (best: boolean) => {
    if (!windowName) return;
    close(true);
    onAverage?.(windowName, best, opener.current);
  };
  return (
    <section
      data-part="stats"
      data-size-part="averages"
      data-size={size}
      data-no-timer
      aria-label={words.stats}
      onBlur={(event) => {
        if (
          choosing &&
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          close(false);
      }}
    >
      {(slots.length > 0 || today !== undefined) && (
        <p data-part="stats-now">
          {slots.map((name, index) => {
            if (name === "best" && newestIsBest) return null;
            const slot = ["first", "second", "third", "fourth"][index];
            const value = (
              <>
                <span data-part="slot-name">{statLabel(name, words)}</span>{" "}
                <span data-stat={name} data-record={records[name] || undefined}>
                  {Number.isNaN(stats[name] ?? NaN) && toGo(name) !== null ? (
                    <span data-part="to-go">
                      {words.toGo(toGo(name) as number)}
                    </span>
                  ) : (
                    format(name, stats[name] ?? NaN)
                  )}
                </span>
              </>
            );
            return picker ? (
              <button
                type="button"
                key={slot}
                data-slot={name}
                aria-haspopup="dialog"
                aria-expanded={choosing?.index === index}
                onClick={(event) => {
                  if (choosing?.index === index) {
                    close(true);
                    return;
                  }
                  const button = event.currentTarget;
                  opener.current = button;
                  setCustom("");
                  setInvalid(false);
                  const rect = button.getBoundingClientRect();
                  const below = window.innerHeight - rect.bottom;
                  const above = below < 440 && rect.top > below;
                  setChoosing({
                    index,
                    above,
                    maxHeight: Math.max(90, (above ? rect.top : below) - 24),
                  });
                  tell?.(true);
                }}
              >
                {value}
              </button>
            ) : (
              <span key={slot} data-slot={name}>
                {value}
              </span>
            );
          })}
          {today !== undefined && (
            <span data-slot="today">
              {/* One line, centred in the slot's height as a button's is. */}
              <span>
                <span data-part="slot-name">{words.progress.today}</span>{" "}
                <span data-stat="today">{today}</span>
              </span>
            </span>
          )}
        </p>
      )}
      {choosing && picker && preview && (
        <div
          ref={options}
          data-part="stat-picker"
          data-side={choosing.above ? "above" : "below"}
          style={
            { "--picker-height": `${choosing.maxHeight}px` } as CSSProperties
          }
          role="dialog"
          aria-label={words.chooseStat}
          onKeyDown={(event) => {
            if (actionKey(picker.keymap, "stat-picker.close", event)) {
              event.preventDefault();
              event.stopPropagation();
              close(true);
            } else if (
              (event.target as Element).closest("[data-stat-choice]")
            ) {
              const step = actionKey(
                picker.keymap,
                "stat-picker.previous",
                event,
              )
                ? -1
                : actionKey(picker.keymap, "stat-picker.next", event)
                  ? 1
                  : 0;
              if (step === 0) return;
              const buttons = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "[data-stat-choice]",
                ),
              ];
              const index = buttons.indexOf(event.target as HTMLButtonElement);
              event.preventDefault();
              event.stopPropagation();
              buttons[
                (index + step + buttons.length) % buttons.length
              ]?.focus();
            }
          }}
        >
          {choices.map((name) => (
            <button
              type="button"
              key={name}
              data-stat-choice={name}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(name)}
            >
              <span>{statLabel(name, words)}</span>
              <span>{format(name, preview[name] ?? NaN) || "–"}</span>
            </button>
          ))}
          {windowName && onAverage && (
            <div data-part="average-picker-actions">
              <button
                type="button"
                data-action="average-inspect"
                disabled={Number.isNaN(stats[windowName] ?? NaN)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => inspect(false)}
              >
                {words.averageDetail.inspect}
              </button>
              <button
                type="button"
                data-action="average-inspect-best"
                disabled={
                  !Number.isFinite(
                    stats[`${windowName}-best` as keyof SessionStats],
                  )
                }
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => inspect(true)}
              >
                {words.averageDetail.inspectBest}
              </button>
            </div>
          )}
          {eventInfo(event).kind === "time" && (
            <form
              data-part="custom-stat"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                const name = `ao${custom}`;
                if (statId(name)) pick(name);
                else setInvalid(true);
              }}
            >
              <label>
                {words.averageLength}{" "}
                <input
                  inputMode="numeric"
                  value={custom}
                  onChange={(event) => {
                    setCustom(event.currentTarget.value);
                    setInvalid(false);
                  }}
                />
              </label>
              <button
                type="submit"
                onMouseDown={(event) => event.preventDefault()}
              >
                {words.customAverage}
              </button>
              {invalid && <span role="alert">{words.averageLengthError}</span>}
            </form>
          )}
        </div>
      )}
    </section>
  );
}

function Stats({
  stats,
  event,
  newestIsBest,
  records,
  words: text,
  slots,
  picker,
  part,
  precision,
  onAverage,
  today,
  size = 100,
}: {
  today?: number | undefined;
  size?: number;
  stats: SessionStats;
  event: EventId;
  newestIsBest: boolean;
  records: Records;
  words: Text;
  slots: readonly StatId[];
  picker?: Parameters<typeof StatSlots>[0]["picker"];
  part: "slots" | "totals";
  precision: 2 | 3;
  onAverage?: InspectAverage | undefined;
}) {
  const kind: ResultKind = eventInfo(event).kind;
  // Fewest Moves averages move counts; Multi-Blind has no average.
  const single = (value: number) =>
    kind === "moves" ? formatMoves(value) : formatTime(value, { precision });
  const average = (value: number) =>
    kind === "moves"
      ? formatMoves(value, { mean: true })
      : formatAverage(value, { precision });
  if (part === "slots") {
    return (
      <StatSlots
        size={size}
        stats={stats}
        event={event}
        newestIsBest={newestIsBest}
        records={records}
        slots={slots}
        words={text}
        picker={picker}
        onAverage={onAverage}
        today={today}
        format={(name, value) =>
          name === "best" ? single(value) : average(value)
        }
      />
    );
  }
  if (stats.count < 2 || kind === "multi") return null;
  const showMean = stats.finiteCount >= 2;
  const showBest = showMean && !slots.includes("best") && !newestIsBest;
  // Each complete window supplies a value, including DNF. A best itself must be finite.
  const columnBests =
    kind === "time"
      ? fileColumns.filter(
          ({ name, size }) =>
            stats.count > size && Number.isFinite(stats[`${name}-best`]),
        )
      : [];
  if (!showMean && columnBests.length === 0) return null;
  return (
    <dl data-part="stats-totals" data-no-timer>
      {showBest && (
        <div data-total="best">
          <dt>{text.best}</dt>
          <dd data-stat="best">{single(stats.best)}</dd>
        </div>
      )}
      {showMean && !slots.includes("mean") && (
        <div data-total="mean">
          <dt>{text.mean}</dt>
          <dd data-stat="mean">{average(stats.mean)}</dd>
        </div>
      )}
      {columnBests.map(({ name }) => (
        <div key={name} data-total={`${name}-best`}>
          <dt>
            {text.best} {text[name]}
          </dt>
          <dd data-stat={`${name}-best`}>
            {onAverage ? (
              <button
                type="button"
                data-action="average-inspect-best"
                // The name starts with the figures it shows (WCAG 2.5.3).
                aria-label={`${average(stats[`${name}-best`] ?? NaN)}, ${text.averageDetail.inspectBest} ${name}`}
                onClick={(event) => onAverage(name, true, event.currentTarget)}
              >
                {average(stats[`${name}-best`] ?? NaN)}
              </button>
            ) : (
              average(stats[`${name}-best`] ?? NaN)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
