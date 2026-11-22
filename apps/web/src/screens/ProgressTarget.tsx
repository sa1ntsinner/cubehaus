import { formatTime, parseTime } from "@cubehaus/core";
import { type ForecastDay, forecast } from "@cubehaus/stats";
import { useEffect, useId, useMemo, useState } from "react";
import { formatProgressDifference } from "../progress-data";
import type { Text } from "../text";

type SettingStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
};

/** Where an event's target time is kept: one per event, on this device's database. */
export const targetKey = (event: string) => `progress.target.${event}`;

/**
 * A target time and a rough day it may first be beaten, folded away. The estimate rests
 * on the daily medians of the last 90 days and says so; when they cannot carry one, it
 * says why instead.
 */
export function ProgressTarget({
  event,
  recent,
  today,
  settings,
  dates,
  labels,
}: {
  event: string;
  recent: readonly ForecastDay[];
  today: string;
  settings: SettingStore;
  dates: Intl.DateTimeFormat;
  labels: Text["progress"]["target"];
}) {
  const id = useId();
  const [target, setTarget] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    setTarget(null);
    setDraft("");
    settings.get(targetKey(event)).then(
      (stored) => {
        const value = Number(stored);
        if (!live || !stored || !Number.isSafeInteger(value) || value <= 0)
          return;
        setTarget(value);
        setDraft(formatTime(value));
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [event, settings]);

  const result = useMemo(
    () => (target === null ? null : forecast(recent, target, today)),
    [recent, target, today],
  );

  function commit() {
    const text = draft.trim();
    if (text === "") {
      setInvalid(false);
      if (target === null) return;
      setTarget(null);
      void settings.set(targetKey(event), "");
      return;
    }
    const parsed = parseTime(text);
    if ("error" in parsed || parsed.dnf || parsed.plus2) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft(formatTime(parsed.timeMs));
    if (parsed.timeMs === target) return;
    setTarget(parsed.timeMs);
    void settings.set(targetKey(event), String(parsed.timeMs));
  }

  const answer =
    result === null
      ? null
      : result.reason === "estimate"
        ? labels.about(
            dates.format(new Date(`${result.day ?? today}T12:00:00`)),
          )
        : labels.reasons[result.reason];
  // The change per day, or per week or month when a day's would round to 0.00; none
  // when even a month's would (the answer already says "no change lately").
  const slope = (() => {
    const perDay = result?.slopeMsPerDay;
    if (
      perDay == null ||
      result?.reason === "sparse" ||
      result?.reason === "stale"
    )
      return null;
    const spans = [
      [1, labels.perDay],
      [7, labels.perWeek],
      [30, labels.perMonth],
    ] as const;
    for (const [days, words] of spans) {
      const change = perDay * days;
      if (Math.abs(change) >= 5) {
        const { sign, label } = formatProgressDifference(change, "time");
        return { sign, text: words(label) };
      }
    }
    return null;
  })();

  const answerLine = (
    <span data-part="progress-target-answer" data-reason={result?.reason}>
      {answer}
    </span>
  );

  // Folded, the line is the whole answer. Opened, it names the part and the answer
  // moves beside the field, so the target time is never printed twice.
  return (
    <details
      data-part="progress-target"
      onToggle={(toggle) => setOpen(toggle.currentTarget.open)}
    >
      <summary>
        {target === null || open ? (
          labels.title
        ) : (
          <>
            <span>{labels.under(formatTime(target))}</span> {answerLine}
          </>
        )}
      </summary>
      <div>
        <label htmlFor={id}>{labels.input}</label>{" "}
        <input
          id={id}
          data-action="progress-target"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="9.00"
          aria-invalid={invalid || undefined}
          value={draft}
          onChange={(input) => setDraft(input.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(input) => {
            // The view's keys (T, Esc) stay out of the field.
            input.stopPropagation();
            if (input.key === "Enter") commit();
            if (input.key === "Escape") input.currentTarget.blur();
          }}
        />
        {open && target !== null && answerLine}
        {result && (
          <p data-part="progress-target-basis">
            {slope && (
              <span data-part="progress-target-slope" data-sign={slope.sign}>
                {slope.text}
              </span>
            )}{" "}
            <span>{labels.basis(result.days, result.solves)}</span>
          </p>
        )}
      </div>
    </details>
  );
}
