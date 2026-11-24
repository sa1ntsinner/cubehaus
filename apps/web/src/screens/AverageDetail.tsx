import type { Solve } from "@cubehaus/core";
import { parseStat, type StatId } from "@cubehaus/stats";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { AppState } from "../app-state";
import {
  copyStatWindow,
  describeStatWindow,
  formatStatWindow,
} from "../average-copy";
import { actionKey, type Keymap } from "../keys/keymap";
import type { Settings } from "../settings";
import type { Text } from "../text";
import "../design/average-detail.css";

const pageSize = 24;

export function AverageDetail({
  request,
  app,
  settings,
  keymap,
  words,
  onClose,
}: {
  request: { name: StatId; best: boolean; solve: Solve };
  app: AppState;
  settings: Pick<Settings, "language" | "precision">;
  keymap: Keymap;
  words: Text;
  onClose(): void;
}) {
  const modal = useRef<HTMLDialogElement>(null);
  const fallback = useRef<HTMLTextAreaElement>(null);
  const heading = useId();
  const [rows, setRows] = useState<readonly Solve[] | null>(null);
  const [first, setFirst] = useState(0);
  const [copy, setCopy] =
    useState<Awaited<ReturnType<typeof copyStatWindow>>>();
  const stat = useMemo(() => parseStat(request.name), [request.name]);
  const detail = useMemo(
    () =>
      rows && stat ? describeStatWindow(rows, stat, settings.precision) : null,
    [rows, stat, settings.precision],
  );
  const labels = words.averageDetail;

  useEffect(() => {
    const dialog = modal.current;
    dialog?.showModal();
    let active = true;
    void app.averageWindow(request.solve, request.name, request.best).then(
      (solves) => {
        if (active) setRows(solves);
      },
      () => {
        if (active) setRows([]);
      },
    );
    return () => {
      active = false;
      dialog?.close();
    };
  }, [app, request]);

  useEffect(() => {
    if (copy?.kind !== "fallback") return;
    fallback.current?.focus();
    fallback.current?.select();
  }, [copy]);

  function close() {
    modal.current?.close();
    onClose();
  }

  async function write() {
    if (!rows || !detail || !stat) return;
    const text = formatStatWindow(
      rows,
      stat,
      settings.language,
      settings.precision,
    );
    setCopy(
      await copyStatWindow(text, (value) =>
        navigator.clipboard.writeText(value),
      ),
    );
  }

  return (
    <dialog
      ref={modal}
      data-part="average-detail"
      data-no-timer
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (actionKey(keymap, "average.close", event)) {
          event.preventDefault();
          event.stopPropagation();
          close();
        } else if (
          actionKey(keymap, "average.copy", event) &&
          event.target !== fallback.current &&
          window.getSelection()?.isCollapsed !== false
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) void write();
        }
      }}
    >
      <section>
        <button type="button" data-action="dialog-close" onClick={close}>
          {words.backToTimer}
        </button>
        <h1 id={heading}>{detail?.title ?? request.name}</h1>
        <p data-heard role="status">
          {!detail
            ? rows
              ? labels.unavailable
              : labels.loading
            : copy?.kind === "copied"
              ? labels.copied
              : ""}
        </p>
        {!detail ? (
          <p>{rows ? labels.unavailable : labels.loading}</p>
        ) : copy?.kind === "fallback" ? (
          <label>
            {labels.fallback}
            <textarea
              ref={fallback}
              data-part="average-copy-text"
              readOnly
              value={copy.text}
            />
          </label>
        ) : (
          <>
            <button
              type="button"
              data-action="average-copy"
              onClick={() => void write()}
            >
              {labels.copy}
            </button>
            {copy?.kind === "copied" && <p>{labels.copied}</p>}
            <ol start={first + 1}>
              {detail.lines
                .slice(first, first + pageSize)
                .map((line, index) => (
                  <li
                    key={line.id}
                    data-solve-id={line.id}
                    data-dropped={line.dropped || undefined}
                    data-penalty={line.penalty}
                  >
                    <span aria-hidden="true">{first + index + 1}</span>
                    <span>{line.dropped ? `(${line.time})` : line.time}</span>
                    <span>{line.scramble}</span>
                  </li>
                ))}
            </ol>
            {detail.lines.length > pageSize && (
              <nav aria-label={words.solveHistory}>
                <button
                  type="button"
                  disabled={first === 0}
                  onClick={() => setFirst(first - pageSize)}
                >
                  {labels.previous}
                </button>
                <button
                  type="button"
                  disabled={first + pageSize >= detail.lines.length}
                  onClick={() => setFirst(first + pageSize)}
                >
                  {labels.next}
                </button>
              </nav>
            )}
          </>
        )}
      </section>
    </dialog>
  );
}
