import {
  type CrossColour,
  type EventId,
  eventInfo,
  formatSolve,
  formatTime,
  penaltyOf,
  resultValue,
  type Solve,
  type SplitPart,
} from "@cubehaus/core";
import type { TimerPhase } from "@cubehaus/timer";
import {
  Fragment,
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { RepeatView } from "../app-state";
import { isTouchPhone } from "../input/touch-screen";
import { formatRunning, inspectionDisplay } from "../running";
import { Picture } from "../scramble/Picture.tsx";
import type { ZoomState } from "../scramble/PictureZoom";
import { moveRows, movesUpTo, pictureSupport } from "../scramble/picture";
import type { Settings } from "../settings";
import { type Text, text } from "../text";
import { DEFAULT_SIZES, type ViewSizes } from "../view-size";
import { CrossCells } from "./CrossCells";
import { formatFileResult, spokenResult } from "./file-result";

/**
 * C on a touch phone: the scramble at the top, the figure on the centre of the screen.
 * `--phone-time-room` is the free row between them; `--phone-scramble-room` the most the
 * scramble may take above the figure, so its type never pushes the figure off the centre.
 */
export function usePhoneTimeLayout(
  page: RefObject<HTMLElement | null>,
  phone: boolean,
): void {
  useLayoutEffect(() => {
    const main = page.current;
    if (!main || !phone) return;
    const selector = ':scope > output[data-part="time"]';
    const scrambleSelector = ':scope > [data-part="scramble"]';
    const measure = () => {
      const time = main.querySelector<HTMLOutputElement>(selector);
      if (!time) {
        main.style.removeProperty("--phone-time-room");
        main.style.removeProperty("--phone-scramble-room");
        return;
      }
      const style = getComputedStyle(main);
      const gap = Number.parseFloat(style.rowGap);
      const halfTime = time.offsetHeight / 2;
      const above =
        main.clientHeight / 2 -
        halfTime -
        Number.parseFloat(style.paddingTop) -
        2 * gap;
      main.style.setProperty(
        "--phone-scramble-room",
        `${Math.max(0, above)}px`,
      );
      const scramble = main.querySelector<HTMLElement>(scrambleSelector);
      const room = above - (scramble ? scramble.offsetHeight : 0);
      main.style.setProperty("--phone-time-room", `${Math.max(0, room)}px`);
    };
    const resize = new ResizeObserver(measure);
    const watch = () => {
      resize.disconnect();
      resize.observe(main);
      for (const part of main.querySelectorAll(
        `${selector}, ${scrambleSelector}`,
      ))
        resize.observe(part);
      measure();
    };
    watch();
    const children = new MutationObserver(watch);
    children.observe(main, { childList: true });
    return () => {
      resize.disconnect();
      children.disconnect();
      main.style.removeProperty("--phone-time-room");
      main.style.removeProperty("--phone-scramble-room");
    };
  }, [page, phone]);
}

/**
 * C on a touch phone: the comment's line waits, unseen, high on the screen while the keys
 * come up, so iOS finds the field in view and pans nothing; then it stands just above the
 * keys (`data-comment-placed`). Where the figure would reach that line, the figure and its
 * notes rise once (`--comment-lift`); where even that leaves no room (a phone on its side)
 * they step out (`data-comment-cramped`), and the line's own time stands for them.
 */
export function usePhoneCommentBar(
  page: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useLayoutEffect(() => {
    const main = page.current;
    const viewport = window.visualViewport;
    if (!main || !active) return;
    const root = document.documentElement;
    const place = (fallback: boolean) => {
      const inset = Number.parseFloat(
        root.style.getPropertyValue("--keyboard-inset"),
      );
      // What the keys, or a hardware keyboard's bar alone, cover at the foot.
      const covered =
        viewport && Math.abs(viewport.scale - 1) < 0.01
          ? Math.round(root.clientHeight - viewport.height - viewport.offsetTop)
          : 0;
      if (covered > 0)
        main.style.setProperty("--comment-bottom", `${covered}px`);
      else main.style.removeProperty("--comment-bottom");
      if (
        !(inset > 0) &&
        !fallback &&
        !main.hasAttribute("data-comment-placed")
      )
        return;
      main.setAttribute("data-comment-placed", "");
      const bar = main.querySelector<HTMLElement>('[data-part="comment-bar"]');
      const time = main.querySelector<HTMLElement>(
        ':scope > output[data-part="time"]',
      );
      if (!bar || !time) return;
      const under = main.querySelector<HTMLElement>(
        ':scope > [data-part="time-under"]',
      );
      // Measure the laid-out figure, even if the swipe is still sliding it away.
      const origin = main.getBoundingClientRect().top - main.scrollTop;
      const top = origin + time.offsetTop;
      let bottom = top + time.offsetHeight;
      for (const part of under?.children ?? [])
        if (part !== bar && part instanceof HTMLElement && part.offsetHeight)
          bottom = Math.max(
            bottom,
            origin +
              (under?.offsetTop ?? 0) +
              part.offsetTop +
              part.offsetHeight,
          );
      const barTop = bar.getBoundingClientRect().top;
      const ceiling = (viewport?.offsetTop ?? 0) + 8;
      const needed = Math.min(0, barTop - 16 - bottom);
      const cramped = top + needed < ceiling;
      main.toggleAttribute("data-comment-cramped", cramped);
      main.style.setProperty("--comment-lift", `${cramped ? 0 : needed}px`);
      // The lower phone scramble can sit under the keyboard's translucent ground.
      let coveredScramble = false;
      let above = 0;
      for (const part of main.querySelectorAll<HTMLElement>(
        ':scope > :is([data-part="scramble"], [data-part="scramble-picture"])',
      ))
        if (part.offsetHeight) {
          const box = part.getBoundingClientRect();
          if (box.top < top) above = Math.max(above, box.bottom);
          if (covered > 0 && box.bottom > barTop) coveredScramble = true;
        }
      main.toggleAttribute(
        "data-comment-lifted",
        coveredScramble || (!cramped && needed < 0 && top + needed < above + 8),
      );
    };
    const update = () => place(false);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    // A hardware keyboard brings no keys up: the line takes its place anyway.
    const fallback = window.setTimeout(() => place(true), 900);
    update();
    return () => {
      window.clearTimeout(fallback);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      main.removeAttribute("data-comment-placed");
      main.removeAttribute("data-comment-cramped");
      main.removeAttribute("data-comment-lifted");
      main.style.removeProperty("--comment-lift");
      main.style.removeProperty("--comment-bottom");
    };
  }, [page, active]);
}

/** Each colour's shortest cross after a scramble, and the colour the solve was built on. */
export type CrossLine = {
  lengths: readonly { colour: CrossColour; length: number }[];
  own: CrossColour | null;
  shortest: number;
  /** Still being counted: the cells keep their room, unseen, so nothing under them moves. */
  pending?: boolean;
};

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
  commenting,
  onCommentDone,
  feedback = null,
  repeat,
  onRepeat,
  sizes = DEFAULT_SIZES,
  crossLine = null,
  reserveSplits = false,
  markedSplits,
  currentPart,
  recentSplits,
}: {
  scramble: string | null;
  event: EventId;
  pending: boolean;
  retry: () => void;
  /** Said in place of the scramble when there can be none (a drill with no case). */
  blocked?: string | undefined;
  stepScramble?: ((direction: -1 | 1) => void) | undefined;
  phase: TimerPhase;
  reserveSplits?: boolean;
  markedSplits?: readonly SplitPart[] | undefined;
  currentPart?: string | undefined;
  recentSplits?: readonly SplitPart[] | undefined;
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
  commenting?: Solve | undefined;
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
  /**
   * The shortest cross of each colour in play on the solve on show, its own colour named;
   * A pending line holds its place while the worker counts.
   */
  crossLine?: CrossLine | null;
  /** Each part's size in percent: `data-size` on the scramble, picture and time. */
  sizes?: ViewSizes;
}) {
  const settled = phase === "idle" || phase === "stopped";
  const shown = settled && !justStopped ? newest : undefined;
  const parts =
    phase === "running"
      ? markedSplits
      : settled
        ? (shown?.splits ??
          (justStopped ? (recentSplits ?? markedSplits) : undefined))
        : undefined;
  const splitLine =
    reserveSplits || parts || currentPart ? (
      <SplitLine
        parts={parts ?? []}
        current={currentPart}
        precision={precision}
      />
    ) : null;
  const inspection =
    inspectionMs !== null && phase !== "running" && phase !== "stopped"
      ? inspectionDisplay(inspectionMs)
      : null;
  const line = useRef<HTMLParagraphElement>(null);
  const pictureVisible =
    showPicture &&
    scramble !== null &&
    (isTouchPhone() || (phase !== "ready" && phase !== "running")) &&
    pictureSupport(event) === "flat";
  const canStep =
    pictureVisible &&
    phase !== "ready" &&
    phase !== "running" &&
    event !== "sq1";
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
  // A record is a hue on screen: said in words, with the result it belongs to.
  const isRecord = useRef(record);
  isRecord.current = record;
  useEffect(() => {
    // Silence while the next solve runs, so the same result twice in a row is heard twice.
    if (phase === "running") setSaid("");
  }, [phase]);
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
    if (changed)
      setSaid(
        before.id !== shown.id && isRecord.current
          ? `${spokenResult(shown, precision)}, ${words.spokenRecord}`
          : spokenResult(shown, precision),
      );
  }, [shown, shownNo, precision, words]);
  return (
    <>
      {scramble !== null && (
        <p data-heard data-part="scramble-heard">
          {scramble}
        </p>
      )}
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
          // Drawn move by move for the eye; heard once, whole, from the copy before it.
          <span data-part="scramble-moves" aria-hidden="true">
            <Moves line={scramble} event={event} upto={upto} />
          </span>
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
      {showTime &&
        (shown && !inspection ? (
          <TimeUnder
            solve={shown}
            precision={precision}
            no={shownNo}
            words={words}
            commenting={commenting}
            onCommentDone={onCommentDone}
            repeat={repeat}
            onRepeat={onRepeat}
            crossLine={crossLine}
            splitLine={splitLine}
          />
        ) : (
          splitLine && <div data-part="time-under">{splitLine}</div>
        ))}
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

function SplitLine({
  parts,
  current,
  precision,
}: {
  parts: readonly SplitPart[];
  current: string | undefined;
  precision: Settings["precision"];
}) {
  const durations = parts.map((part) =>
    formatTime(part.durationMs, { precision }),
  );
  return (
    <p
      data-part="split-line"
      data-active={current !== undefined || undefined}
      title={
        parts
          .map(({ name }, index) => `${name} ${durations[index]}`)
          .join(" · ") || undefined
      }
    >
      {parts.map(({ name }, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Parts stay in recorded order and can share a name.
        <Fragment key={`${index}:${name}`}>
          {index > 0 && " "}
          {index > 0 && !current && (
            <>
              <span data-split-dot aria-hidden="true">
                ·
              </span>{" "}
            </>
          )}
          <span data-split-part>
            <span data-split-name>{name}</span>{" "}
            <span data-split-duration>{durations[index]}</span>
          </span>
        </Fragment>
      ))}
      {current && (
        <>
          {parts.length > 0 && " "}
          <span data-split-part data-split-current>
            <span data-split-name>{current}</span> …
          </span>
        </>
      )}
    </p>
  );
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
  crossLine,
  splitLine,
}: {
  crossLine: CrossLine | null;
  splitLine: ReactNode;
  solve: Solve;
  precision: Settings["precision"];
  no: number | undefined;
  words: Text;
  commenting: Solve | undefined;
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
    solve.comment === null &&
    !crossLine &&
    !splitLine
  )
    return null;
  return (
    <div data-part="time-under" data-repeat={repeat ? "" : undefined}>
      {note && (
        <p data-part="time-note" data-kind={note.kind}>
          {note.text}
        </p>
      )}
      {splitLine}
      {crossLine &&
        (crossLine.pending ? (
          <p data-part="time-cross" data-pending="" aria-hidden="true">
            <span data-part="cross-label">{words.cross.line}</span>{" "}
            <CrossCells cells={crossLine.lengths} words={words} />
          </p>
        ) : (
          <p data-part="time-cross">
            <span data-part="cross-label">{words.cross.line}</span>{" "}
            <CrossCells
              cells={crossLine.lengths}
              words={words}
              own={crossLine.own}
            />
          </p>
        ))}
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
        // On a touch phone one line above the keys, the solve's time at its left
        // (design/timer.css); elsewhere the field alone, in the comment's place.
        <div data-part="comment-bar">
          <span data-part="comment-bar-time" aria-hidden="true">
            {formatFileResult(commenting, precision)}
          </span>
          <CommentField
            key={commenting.id}
            initial={commenting.comment ?? ""}
            label={words.comment}
            onDone={(value) => onCommentDone?.(value)}
          />
        </div>
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
      name="solve-comment"
      aria-label={label}
      placeholder={label}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="sentences"
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
        {(event === "333" || event === "333oh") && index === 10 && (
          <br data-part="phone-scramble-break" />
        )}
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
