import {
  type EventId,
  eventInfo,
  formatSolve,
  formatTime,
  penaltyOf,
  resultValue,
  type Solve,
} from "@cubehaus/core";
import type { TimerPhase } from "@cubehaus/timer";
import {
  Fragment,
  type ReactNode,
  type Ref,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { RepeatView } from "../app-state";
import { formatRunning, inspectionDisplay } from "../running";
import { Picture } from "../scramble/Picture.tsx";
import type { ZoomState } from "../scramble/PictureZoom";
import { moveRows, movesUpTo, pictureSupport } from "../scramble/picture";
import type { Settings } from "../settings";
import { type Text, text } from "../text";
import { DEFAULT_SIZES, type ViewSizes } from "../view-size";
import { formatFileResult, spokenResult } from "./file-result";

export function Timer({
  scramble,
  event,
  pending,
  retry,
  blocked,
  stepScramble,
  phase,
  displayMs,
  newest,
  justStopped,
  showTime = true,
  showPicture = true,
  pictureButton,
  pictureZoom,
  onPictureOpen,
  onPictureClosed,
  words = text,
  inspectionMs = null,
  running = "hundredths",
  record = false,
  precision = 2,
  shownNo,
  commenting = false,
  onCommentDone,
  feedback = null,
  repeat,
  onRepeat,
  sizes = DEFAULT_SIZES,
}: {
  scramble: string | null;
  event: EventId;
  pending: boolean;
  retry: () => void;
  /** Said in place of the scramble when there can be none (a drill with no case). */
  blocked?: string | undefined;
  stepScramble?: ((direction: -1 | 1) => void) | undefined;
  phase: TimerPhase;
  displayMs: number;
  newest: Solve | undefined;
  justStopped: boolean;
  showTime?: boolean;
  showPicture?: boolean;
  pictureButton: Ref<HTMLButtonElement>;
  pictureZoom: ZoomState;
  onPictureOpen: () => void;
  onPictureClosed: () => void;
  words?: Text;
  // Elapsed inspection while it runs (also while held during it), else null.
  inspectionMs?: number | null;
  running?: Settings["running"];
  record?: boolean;
  precision?: Settings["precision"];
  /** A past solve is shown in place of the newest: its number in the session. */
  shownNo?: number;
  /** C: the comment line under the time is a field. */
  commenting?: boolean;
  /** The field's end: the text to keep (empty clears it), or undefined to leave it. */
  onCommentDone?: (comment: string | undefined) => void;
  /** An action that cannot apply: the figures nudge, the reason goes to the status. */
  feedback?: { reason: string; key: number } | null;
  /** R: a past scramble timed again, its attempts, and the ways to pick one or leave. */
  repeat?:
    | {
        view: RepeatView;
        onShow: (id: string) => void;
        onLeave: () => void;
      }
    | undefined;
  /** A past solve on show can be timed again (its `Again`). */
  onRepeat?: (() => void) | undefined;
  /** Each part's size in percent: `data-size` on the scramble, picture and time. */
  sizes?: ViewSizes;
}) {
  const settled = phase === "idle" || phase === "stopped";
  const shown = settled && !justStopped ? newest : undefined;
  const inspection =
    inspectionMs !== null && phase !== "running" && phase !== "stopped"
      ? inspectionDisplay(inspectionMs)
      : null;
  const line = useRef<HTMLParagraphElement>(null);
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null);
  const pictureVisible =
    showPicture &&
    scramble !== null &&
    phase !== "ready" &&
    phase !== "running" &&
    pictureSupport(event) === "flat";
  const canStep = pictureVisible && event !== "sq1";
  const stepKey = canStep ? `${event}:${scramble}` : null;
  const [step, setStep] = useState<{ key: string; upto: number | null }>();
  const currentStep = step?.key === stepKey ? step : undefined;
  if (step && !currentStep) setStep(undefined);
  const upto = currentStep?.upto ?? null;
  const time =
    !showTime || inspection
      ? null
      : shown
        ? formatFileResult(shown, precision)
        : phase === "running"
          ? formatRunning(displayMs, running)
          : formatTime(displayMs, { precision });
  const timeBox = useRef<HTMLOutputElement>(null);
  useLanding(timeBox, phase, time);
  // What a screen reader hears: a finished solve, and a penalty set or taken off, once
  // each. The large time itself is not live, so the running figures say nothing.
  const [said, setSaid] = useState("");
  const heard = useRef<{ id: string; penalty: string } | null>(null);
  // A solve was timed since the last one heard: the next new result is its result.
  const timed = useRef(false);
  if (phase === "running") timed.current = true;
  useEffect(() => {
    if (!shown) return;
    const penalty = `${shown.plus2}:${shown.dnf}`;
    const before = heard.current;
    heard.current = { id: shown.id, penalty };
    if (!before) return;
    const changed =
      before.id === shown.id
        ? before.penalty !== penalty
        : shownNo === undefined && timed.current;
    if (before.id !== shown.id) timed.current = false;
    if (changed) setSaid(spokenResult(shown, precision));
  }, [shown, shownNo, precision]);
  return (
    <>
      <p
        ref={line}
        data-part="scramble"
        data-size-part="scramble"
        data-size={sizes.scramble}
        data-event={event}
        data-ready={scramble !== null}
        data-no-timer={stepScramble ? "" : undefined}
        data-upto={upto ?? undefined}
        data-over-zoom={pictureZoom !== null && pictureVisible ? "" : undefined}
        onPointerDown={(pointer) => {
          if (
            !stepScramble ||
            pointer.pointerType !== "touch" ||
            !pointer.isPrimary
          )
            return;
          swipe.current = {
            id: pointer.pointerId,
            x: pointer.clientX,
            y: pointer.clientY,
          };
        }}
        onPointerCancel={() => {
          swipe.current = null;
        }}
        onPointerUp={(pointer) => {
          const start = swipe.current;
          if (!start || start.id !== pointer.pointerId) return;
          swipe.current = null;
          const dx = pointer.clientX - start.x;
          const dy = pointer.clientY - start.y;
          if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy))
            stepScramble?.(dx < 0 ? 1 : -1);
        }}
        onPointerOver={(input) => {
          if (
            stepKey === null ||
            input.pointerType !== "mouse" ||
            !(input.target instanceof Element)
          )
            return;
          const n = input.target.closest<HTMLElement>("[data-n]")?.dataset.n;
          if (n !== undefined && Number(n) !== upto)
            setStep({ key: stepKey, upto: Number(n) });
        }}
        onPointerLeave={(input) => {
          if (
            input.pointerType === "mouse" &&
            stepKey !== null &&
            upto !== null
          )
            setStep({ key: stepKey, upto: null });
        }}
      >
        {stepScramble && (
          // The glyphs come from CSS, so the line's text stays the scramble alone.
          <button
            type="button"
            data-no-timer
            data-action="scramble-previous"
            aria-label={words.previousScramble}
            onClick={() => stepScramble(-1)}
          />
        )}
        {scramble !== null ? (
          <Moves line={scramble} event={event} upto={upto} />
        ) : blocked ? (
          blocked
        ) : pending ? (
          // The first scramble is still being made: no words at all for the moment it
          // usually takes, then the waiting line. `No scramble` only once making one failed.
          <span data-part="scramble-wait">
            {words.waiting(eventInfo(event).label)}
          </span>
        ) : (
          <>
            {words.noScramble}{" "}
            <button data-no-timer type="button" onClick={retry}>
              {words.retry}
            </button>
          </>
        )}
        {stepScramble && (
          <button
            type="button"
            data-no-timer
            data-action="scramble-next"
            aria-label={words.nextScramble}
            onClick={() => stepScramble(1)}
          />
        )}
      </p>
      {pictureVisible && (
        <Picture
          key={event}
          event={event}
          scramble={scramble}
          alg={upto === null ? scramble : movesUpTo(scramble, upto)}
          stepping={currentStep !== undefined}
          buttonRef={pictureButton}
          lineRef={line}
          label={words.pictureEnlarge}
          zoom={pictureZoom}
          onOpen={onPictureOpen}
          onClosed={onPictureClosed}
          size={sizes.picture}
        />
      )}
      {showTime &&
        (inspection ? (
          <output
            data-part="time"
            data-size-part="time"
            data-size={sizes.time}
            aria-live="off"
            data-phase="inspecting"
            data-band={inspection.band}
            data-penalty={inspection.penalty}
          >
            {inspection.text}
          </output>
        ) : (
          <output
            ref={timeBox}
            key={feedback?.key}
            aria-live="off"
            data-part="time"
            data-size-part="time"
            data-size={sizes.time}
            data-penalty={shown && penaltyOf(shown)}
            data-plus2={shown?.plus2}
            data-record={(shown && record) || undefined}
            data-result-kind={shown?.event === "333mbf" ? "multi" : undefined}
            data-wide-time={
              shown?.event !== "333mbf" && time !== null && time.length >= 7
                ? true
                : undefined
            }
            data-browsing={shownNo !== undefined || undefined}
            data-feedback={feedback ? "unavailable" : undefined}
          >
            {time}
          </output>
        ))}
      {showTime && !inspection && shown && (
        <TimeUnder
          solve={shown}
          precision={precision}
          no={shownNo}
          words={words}
          commenting={commenting}
          onCommentDone={onCommentDone}
          repeat={repeat}
          onRepeat={onRepeat}
        />
      )}
      <p data-part="time-status" role="status">
        {feedback?.reason}
      </p>
      <p data-part="time-said" aria-live="polite">
        {said}
      </p>
    </>
  );
}

/**
 * What a marked result stands for (DESIGN.md section 7): a +2 shows what it adds to
 * (`11.28 + 2`), a DNF the result it voids, without its +2s (`(11.28)`).
 */
function noteOf(
  solve: Solve,
  precision: Settings["precision"],
): { kind: "raw" | "sum"; text: string } | null {
  if (solve.event === "333mbf" && solve.dnf) return null;
  if (solve.dnf)
    return {
      kind: "raw",
      text: `(${formatSolve({ ...solve, dnf: false, plus2: 0 }, { precision })})`,
    };
  if (solve.plus2 > 0)
    return {
      kind: "sum",
      text: `${formatTime(solve.timeMs, { precision })} + ${2 * solve.plus2}`,
    };
  return null;
}

/** When a past solve was done: day, month, the year only when it is not this one, time. */
function solveDate(at: number, language: "en" | "ru") {
  const date = new Date(at);
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "ru", {
    day: "numeric",
    month: "short",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Under the time: the +2 or DNF note; for a past solve its number and date; the solve's
 * comment, or the field C opens in its place.
 */
function TimeUnder({
  solve,
  precision,
  no,
  words,
  commenting,
  onCommentDone,
  repeat,
  onRepeat,
}: {
  solve: Solve;
  precision: Settings["precision"];
  no: number | undefined;
  words: Text;
  commenting: boolean;
  onCommentDone: ((comment: string | undefined) => void) | undefined;
  repeat:
    | {
        view: RepeatView;
        onShow: (id: string) => void;
        onLeave: () => void;
      }
    | undefined;
  onRepeat: (() => void) | undefined;
}) {
  const note = noteOf(solve, precision);
  if (
    !note &&
    no === undefined &&
    !repeat &&
    !commenting &&
    solve.comment === null
  )
    return null;
  return (
    <div data-part="time-under" data-repeat={repeat ? "" : undefined}>
      {note && (
        <p data-part="time-note" data-kind={note.kind}>
          {note.text}
        </p>
      )}
      {repeat ? (
        <Attempts repeat={repeat} precision={precision} words={words} />
      ) : (
        no !== undefined && (
          <p data-part="time-meta">
            {words.solveNo(no)} · {solveDate(solve.startedAt, words.language)}
            {onRepeat && (
              <>
                {" "}
                <button
                  type="button"
                  data-no-timer
                  data-action="solve-repeat"
                  onClick={onRepeat}
                >
                  {words.repeat.action}
                </button>
              </>
            )}
          </p>
        )
      )}
      {commenting ? (
        <CommentField
          key={solve.id}
          initial={solve.comment ?? ""}
          label={words.comment}
          onDone={(value) => onCommentDone?.(value)}
        />
      ) : (
        solve.comment !== null && (
          <p data-part="time-comment">
            {words.commentPrefix}
            {solve.comment}
          </p>
        )
      )}
    </div>
  );
}

/** When an attempt was made: its time of day, with the day when it was not today. */
function attemptDate(at: number, language: "en" | "ru") {
  const date = new Date(at);
  if (date.toDateString() !== new Date().toDateString())
    return solveDate(at, language);
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "ru", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * The result lands (DESIGN.md section 15): at the stop the figures already on screen stay
 * where they stood, the rest is written out to their right, and the whole number settles
 * on the centre in one move. Only a transform, on the compositor; nothing waits for it,
 * and the next press cancels it. Read once per stop: the width of the figures that ran.
 */
function useLanding(
  box: { current: HTMLOutputElement | null },
  phase: TimerPhase,
  time: string | null,
) {
  const last = useRef<{ phase: TimerPhase; time: string | null }>({
    phase,
    time,
  });
  useLayoutEffect(() => {
    const before = last.current;
    last.current = { phase, time };
    const element = box.current;
    if (!element) return;
    if (phase !== "stopped") {
      for (const animation of element.getAnimations())
        if (animation.id === "land") animation.cancel();
      return;
    }
    const ran = before.time;
    if (
      before.phase !== "running" ||
      !ran ||
      !time ||
      time.length <= ran.length ||
      !time.startsWith(ran) ||
      element.dataset.wideTime !== undefined ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const text = element.firstChild;
    if (text?.nodeType !== Node.TEXT_NODE) return;
    const range = document.createRange();
    range.selectNodeContents(text);
    const whole = range.getBoundingClientRect().width;
    range.setEnd(text, ran.length);
    const shift = (whole - range.getBoundingClientRect().width) / 2;
    if (shift < 1) return;
    const animation = element.animate(
      [{ transform: `translateX(${shift}px)` }, { transform: "none" }],
      { duration: 240, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
    );
    animation.id = "land";
  }, [box, phase, time]);
}

/** Says on the list whether attempts lie above or below what it shows. */
function markMore(box: HTMLElement) {
  const above = box.scrollTop > 1;
  const below = box.scrollTop + box.clientHeight < box.scrollHeight - 1;
  box.toggleAttribute("data-more-above", above);
  box.toggleAttribute("data-more-below", below);
}

/**
 * R: whose scramble this is, then every attempt on it in time order, the best in `pb`.
 * A click puts an attempt on show for its +2, DNF, comment or delete.
 */
function Attempts({
  repeat: { view, onShow, onLeave },
  precision,
  words,
}: {
  repeat: {
    view: RepeatView;
    onShow: (id: string) => void;
    onLeave: () => void;
  };
  precision: Settings["precision"];
  words: Text;
}) {
  const list = useRef<HTMLOListElement>(null);
  // The attempt on show stays in sight: a new one at the foot, a picked one where it is.
  // Only the list scrolls, never the page under it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the shown attempt or the count changes.
  useEffect(() => {
    const box = list.current;
    const item = box?.querySelector<HTMLElement>("[data-shown]");
    if (!box || !item) return;
    if (item.offsetTop < box.scrollTop) box.scrollTop = item.offsetTop;
    else if (
      item.offsetTop + item.offsetHeight >
      box.scrollTop + box.clientHeight
    )
      box.scrollTop = item.offsetTop + item.offsetHeight - box.clientHeight;
    markMore(box);
  }, [view.shown.id, view.attempts.length]);
  // An edge fades only while more attempts lie past it, as the file's do.
  useEffect(() => {
    const box = list.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => markMore(box));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  let best: Solve | undefined;
  for (const attempt of view.attempts)
    if (
      Number.isFinite(resultValue(attempt)) &&
      (!best || resultValue(attempt) < resultValue(best))
    )
      best = attempt;
  return (
    <>
      <p data-part="time-meta">
        {words.repeat.of(view.no)}{" "}
        <button
          type="button"
          data-no-timer
          data-action="repeat-leave"
          aria-label={words.repeat.leave}
          title={words.repeat.leave}
          onClick={onLeave}
        >
          <span aria-hidden="true">×</span>
        </button>
      </p>
      <ol
        ref={list}
        data-part="attempts"
        data-no-timer
        aria-label={words.repeat.attempts}
        onScroll={(scroll) => markMore(scroll.currentTarget)}
      >
        {view.attempts.map((attempt) => (
          <li
            key={attempt.id}
            data-penalty={penaltyOf(attempt)}
            data-best={
              attempt === best && view.attempts.length > 1 ? "" : undefined
            }
            data-shown={attempt.id === view.shown.id ? "" : undefined}
          >
            <button
              type="button"
              data-action="attempt-show"
              aria-pressed={attempt.id === view.shown.id}
              onClick={() => onShow(attempt.id)}
            >
              <span data-part="attempt-result">
                {formatFileResult(attempt, precision)}
              </span>{" "}
              <time
                data-part="attempt-at"
                dateTime={new Date(attempt.startedAt).toISOString()}
              >
                {attemptDate(attempt.startedAt, words.language)}
              </time>
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

/** One line in place of the comment: Enter or leaving it keeps the text, Esc leaves it. */
function CommentField({
  initial,
  label,
  onDone,
}: {
  initial: string;
  label: string;
  onDone: (value: string | undefined) => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (next: string | undefined) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  return (
    <input
      data-part="time-comment-input"
      data-no-timer
      aria-label={label}
      placeholder={label}
      autoComplete="off"
      enterKeyHint="done"
      // biome-ignore lint/a11y/noAutofocus: C opens the field to type in at once.
      autoFocus
      value={value}
      onChange={(change) => setValue(change.currentTarget.value)}
      onKeyDown={(key) => {
        if (key.key === "Enter") {
          key.preventDefault();
          finish(value.trim());
        } else if (key.key === "Escape") {
          key.preventDefault();
          key.stopPropagation();
          finish(undefined);
        }
      }}
      onBlur={() => finish(value.trim())}
    />
  );
}

/** What a move does, for its colour (DESIGN.md section 11). */
export type MoveKind = "plain" | "prime" | "double" | "wide" | "rotation";
export function moveKind(move: string, event: EventId): MoveKind {
  if (/^[xyz]/.test(move)) return "rotation";
  if (event === "minx")
    return move.includes("--") || move.endsWith("'") ? "prime" : "plain";
  if (event === "clock") return move.endsWith("-") ? "prime" : "plain";
  if (event === "sq1") return move === "/" ? "wide" : "plain";
  if (event === "pyram" || event === "skewb")
    return move.endsWith("'") ? "prime" : "plain";
  if (/w|^\d|^[MES]|^[rludfb]/.test(move)) return "wide";
  if (/2'?$/.test(move)) return "double";
  if (move.endsWith("'")) return "prime";
  return "plain";
}

/**
 * A scramble as moves; the spaces between them stay text, so it reads and copies as written.
 * The scramble's own line breaks (Megaminx) stay breaks.
 */
function Moves({
  line,
  event,
  upto,
}: {
  line: string;
  event: EventId;
  upto: number | null;
}) {
  let next = 0;
  const rows =
    event === "sq1"
      ? line.split("\n").map((row) => row.match(/\([^)]*\)|\S+/g) ?? [])
      : moveRows(line);
  return rows.map((row, rowIndex) => {
    const spans = row.map((move) => {
      const n = next++;
      return (
        <span
          key={n}
          data-move={moveKind(move, event)}
          data-n={n}
          data-after={upto !== null && n > upto ? "" : undefined}
        >
          {move}
        </span>
      );
    });
    // Square-1: a turn pair and the slash after it are one unit that never breaks.
    const units: ReactNode[][] = [];
    spans.forEach((span, index) => {
      if (event === "sq1" && row[index] === "/" && units.length > 0)
        units[units.length - 1]?.push(" ", span);
      else units.push([span]);
    });
    const moves = units.map((unit, index) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: units keep their order within a row.
      <Fragment key={index}>
        {index > 0 && " "}
        {unit.length > 1 ? <span data-part="move-unit">{unit}</span> : unit}
      </Fragment>
    ));
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: rows repeat; their order is the identity.
      <Fragment key={rowIndex}>
        {rowIndex > 0 && <br />}
        {event === "333mbf" ? (
          <span data-part="cube-scramble">{moves}</span>
        ) : (
          moves
        )}
      </Fragment>
    );
  });
}
