import {
  eventInfo,
  formatMoves,
  formatSolve,
  multiLimitMs,
  multiPoints,
  newId,
  parseTime,
  type Session,
  type Solve,
} from "@cubehaus/core";
import { checkFewestMoves } from "@cubehaus/scramble/cubing";
import { useEffect, useRef, useState } from "react";
import { fmClock } from "../entry-clock";
import { actionKey, type Keymap } from "../keys/keymap";
import type { Text } from "../text";

type MultiFields = { solved: string; attempted: number };
type EntryResult = { solve: Solve; feedback?: string } | { error: string };

export async function prepareEntry(
  session: Pick<Session, "id" | "event">,
  scramble: string,
  value: string,
  startedAt: number,
  words: Text,
  multi?: MultiFields,
): Promise<EntryResult> {
  const solve: Solve = {
    id: newId(startedAt),
    sessionId: session.id,
    event: session.event,
    input: "manual",
    scramble,
    startedAt,
    inspectionMs: null,
    comment: null,
    timeMs: 0,
    plus2: 0,
    dnf: false,
  };

  const kind = eventInfo(session.event).kind;
  if (kind === "moves") {
    const checked = await checkFewestMoves(scramble, value);
    solve.solution = value;
    if ("moves" in checked) {
      solve.moves = checked.moves;
      return { solve, feedback: formatMoves(checked.moves) };
    }
    solve.dnf = true;
    const reason = checked.dnf;
    const feedback =
      reason === "Solution exceeds 80 ETM"
        ? words.fmcOver
        : reason.startsWith("Invalid move: ")
          ? words.entry.invalidMove(reason.slice("Invalid move: ".length))
          : words.entry.unsolved;
    return { solve, feedback };
  }

  const time = parseTime(value);
  if ("error" in time) return { error: words.entry.invalidTime };
  Object.assign(solve, time);
  if (kind === "time") return { solve };
  if (!multi) return { error: words.entry.invalidAttempted };

  const solved = Number(multi.solved);
  const attempted = multi.attempted;
  if (!Number.isSafeInteger(attempted) || attempted < 2)
    return { error: words.entry.invalidAttempted };
  if (
    !/^\d+$/.test(multi.solved) ||
    !Number.isSafeInteger(solved) ||
    solved > attempted
  )
    return { error: words.entry.invalidCount };

  solve.cubesSolved = solved;
  solve.cubesAttempted = attempted;
  solve.timeMs = Math.min(solve.timeMs, multiLimitMs(attempted));
  if (multiPoints(solved, attempted) === null) {
    solve.dnf = true;
    return { solve, feedback: words.mbfDnf };
  }
  return { solve, feedback: formatSolve(solve) };
}

function FewestClock({ words }: { words: Text }) {
  const [started, setStarted] = useState<number>();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (started === undefined) return;
    const tick = () => {
      const elapsed = Math.max(0, performance.now() - started);
      setElapsed(elapsed);
      if (fmClock(elapsed).over) clearInterval(interval);
    };
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [started]);
  const clock = fmClock(elapsed);
  return (
    <>
      <output
        data-part="fm-clock"
        // The hour counts down in silence, as the timer's figures run.
        aria-live="off"
        data-warn={clock.warn}
        data-over={clock.over}
      >
        {clock.text}
      </output>
      <button
        type="button"
        data-action="fm-start"
        disabled={started !== undefined}
        onClick={() => setStarted(performance.now())}
      >
        {words.entry.startClock}
      </button>
    </>
  );
}

export function Entry({
  session,
  scramble,
  words,
  keymap,
  onSave,
  multi,
}: {
  session: Session;
  scramble: string | null;
  words: Text;
  keymap?: Keymap;
  onSave: (solve: Solve) => void;
  multi:
    | {
        attempted: number;
        setAttempted: (count: number) => void;
        locked: boolean;
        measuredMs: number | undefined;
        discard: () => void;
      }
    | undefined;
}) {
  const kind = eventInfo(session.event).kind;
  const [value, setValue] = useState<string | null>(null);
  const [solved, setSolved] = useState("");
  const [attempted, setAttempted] = useState(String(multi?.attempted ?? ""));
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Solve>();
  const [checking, setChecking] = useState(false);
  const [clockRun, setClockRun] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const measuredMs = multi?.measuredMs;
  const input =
    value ?? (measuredMs === undefined ? "" : (measuredMs / 1000).toFixed(3));
  const attemptedInput = multi?.locked ? String(multi.attempted) : attempted;
  const countChanged =
    !!multi &&
    (!/^\d+$/.test(attemptedInput) ||
      Number(attemptedInput) !== multi.attempted);
  const timerRunning = multi?.locked && measuredMs === undefined;
  const shownPreview = preview?.scramble === scramble ? preview : undefined;

  function save(solve: Solve) {
    onSave(solve);
    setPreview(undefined);
    setValue(null);
    setSolved("");
    if (multi) setAttempted(String(multi.attempted));
    setError("");
    if (kind === "moves") setClockRun((value) => value + 1);
  }

  async function submit() {
    if (scramble === null || checking || countChanged || timerRunning) return;
    if (shownPreview) {
      save(shownPreview);
      return;
    }
    setError("");
    setFeedback("");
    setChecking(true);
    try {
      const result = await prepareEntry(
        session,
        scramble,
        input,
        Date.now(),
        words,
        multi && { solved, attempted: multi.attempted },
      );
      if (!form.current) return;
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setFeedback(result.feedback ?? "");
      if (kind === "moves") setPreview(result.solve);
      else save(result.solve);
    } catch {
      if (form.current) setError(words.entry.checkFailed);
    } finally {
      if (form.current) setChecking(false);
    }
  }

  function discard() {
    if (multi) {
      multi.discard();
      setAttempted(String(multi.attempted));
    }
    setValue(null);
    setSolved("");
    setError("");
    setFeedback("");
  }

  return (
    <form
      ref={form}
      data-part="entry"
      data-no-timer
      noValidate
      onKeyDown={(event) => {
        if (event.repeat || event.isDefaultPrevented()) return;
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) return;
        if (
          measuredMs !== undefined &&
          actionKey(keymap ?? {}, "entry.discard", event)
        ) {
          event.preventDefault();
          event.stopPropagation();
          discard();
        } else if (actionKey(keymap ?? {}, "entry.submit", event)) {
          if (event.code === "Enter") return;
          event.preventDefault();
          event.stopPropagation();
          void submit();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {kind === "moves" && <FewestClock key={clockRun} words={words} />}
      {multi && (
        <>
          <label>
            {words.entry.attempted}
            <input
              type="number"
              min={2}
              step={1}
              data-part="cubes-attempted"
              placeholder="–"
              value={attemptedInput}
              disabled={multi.locked || checking}
              onChange={(event) => {
                setAttempted(event.currentTarget.value);
                setError("");
                setFeedback("");
              }}
            />
          </label>
          <button
            type="button"
            data-action="entry-scrambles"
            disabled={multi.locked || checking || !countChanged}
            onClick={() => {
              const count = Number(attempted);
              if (
                !/^\d+$/.test(attempted) ||
                !Number.isSafeInteger(count) ||
                count < 2
              ) {
                setError(words.entry.invalidAttempted);
                return;
              }
              multi.setAttempted(count);
            }}
          >
            {words.entry.scrambles}
          </button>
          <label>
            {words.entry.solved}
            <input
              type="number"
              min={0}
              step={1}
              max={multi.attempted}
              data-part="cubes-solved"
              placeholder="–"
              value={solved}
              disabled={checking || timerRunning}
              onChange={(event) => {
                setSolved(event.currentTarget.value);
                setError("");
                setFeedback("");
              }}
            />
          </label>
        </>
      )}
      <label>
        {kind === "moves" ? words.entry.solution : words.entry.time}
        <input
          type="text"
          data-part="entry-input"
          placeholder={kind === "moves" ? undefined : "–"}
          value={input}
          autoComplete="off"
          spellCheck={false}
          disabled={checking || timerRunning}
          onChange={(event) => {
            setValue(event.currentTarget.value);
            setPreview(undefined);
            setError("");
            setFeedback("");
          }}
        />
      </label>
      <button
        type="submit"
        data-action="entry-save"
        disabled={scramble === null || checking || countChanged || timerRunning}
      >
        {kind === "moves" && !shownPreview ? words.entry.check : words.save}
      </button>
      {measuredMs !== undefined && (
        <button type="button" onClick={discard}>
          {words.cancel}
        </button>
      )}
      {error && (
        <p role="alert" data-part="entry-error">
          {error}
        </p>
      )}
      <p data-heard role="status">
        {feedback}
      </p>
      {feedback && <p data-part="entry-feedback">{feedback}</p>}
    </form>
  );
}
