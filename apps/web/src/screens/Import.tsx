import { EVENTS, eventInfo, isEventId } from "@cubehaus/core";
import { useEffect, useRef, useState } from "react";
import {
  type CubeTimeImport,
  csvIssueCodes,
  type ImportPreview,
} from "../import";
import { titleField } from "../input/fields";
import type { Text } from "../text";

const timedEvents = EVENTS.filter(({ kind }) => kind === "time");

/** Product names, the same in every language. */
const sourceNames: Record<ImportPreview["source"], string> = {
  cstimer: "csTimer",
  cubedesk: "CubeDesk",
  cubetime: "CubeTime",
  twisty: "Twisty Timer",
};

/** One sentence per session and kind of issue, in the file's order. */
function issueLines(
  preview: ImportPreview,
  t: Text["settings"],
): { id: string; text: string }[] {
  const lines: { id: string; text: string }[] = [];
  const named = new Map<string, number>();
  for (const { name } of preview.sessions)
    named.set(name, (named.get(name) ?? 0) + 1);
  for (const { key, name, event } of preview.sessions) {
    const own = preview.issues.filter(({ sessionKey }) => sessionKey === key);
    // Twisty Timer starts every puzzle with a "Normal" category: the puzzle tells them apart.
    const puzzle =
      (named.get(name) ?? 0) > 1 ? eventInfo(event).label : undefined;
    const add = (kind: string, text: string) =>
      lines.push({ id: JSON.stringify([key, kind]), text });
    for (const { code, value } of own) {
      if (code === "unknown-event")
        add(
          JSON.stringify([code, value]),
          t.importUnknownEvent(name, value, sourceNames[preview.source]),
        );
      if (code === "missing-session")
        add(code, t.importMissingSession(name, puzzle));
    }
    const rows = own.flatMap(({ code, row }) =>
      code === "invalid-row" && row !== null ? [row] : [],
    );
    if (rows.length) add("invalid-row", t.importUnreadRows(name, rows, puzzle));
    for (const code of csvIssueCodes) {
      const rows = own.flatMap((issue) =>
        issue.code === code && issue.row !== null ? [issue.row] : [],
      );
      if (rows.length) add(code, t.importCsvRows(name, rows, code, puzzle));
    }
  }
  const unassigned = preview.issues.flatMap(({ sessionKey, code, row }) =>
    sessionKey === "" && code === "invalid-row" && row !== null ? [row] : [],
  );
  if (unassigned.length)
    lines.push({
      id: "unassigned-rows",
      text: t.importUnreadRows(sourceNames[preview.source], unassigned),
    });
  return lines;
}

/**
 * What the chosen files will add, before anything is written: their sessions with puzzle
 * and solve count, how many are already here, what will not come across, and one button
 * to go ahead. CubeTime’s CSV files name no puzzle, so each row takes a name and a puzzle;
 * a new puzzle reads the files again, as the solves it matches depend on it.
 */
export function ImportPreviewPanel({
  preview,
  words,
  busy,
  reviewing,
  csv,
  onReview,
  onConfirm,
  onCancel,
}: {
  preview: ImportPreview;
  words: Text;
  /** Importing: nothing can change. */
  busy: boolean;
  /** Reading the files again for a new puzzle: the rows stay editable. */
  reviewing: boolean;
  csv?: CubeTimeImport | undefined;
  onReview(input: CubeTimeImport): void;
  onConfirm(edited?: CubeTimeImport): void;
  onCancel(): void;
}) {
  const t = words.settings;
  const panel = useRef<HTMLElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const previous = useRef<ImportPreview | null>(null);
  const [sessions, setSessions] = useState(csv?.sessions);
  const here = preview.solves - preview.added;
  const allHere = preview.added === 0 && preview.created === 0;
  const nothingNew = allHere && preview.penalized === 0;
  const unnamed = sessions?.some(({ name }) => !name.trim()) ?? false;
  const waiting = busy || reviewing;
  useEffect(() => {
    if (waiting || previous.current === preview) return;
    const first = !previous.current;
    previous.current = preview;
    // The first look lands on the answer; a fresh count leaves the hand where it is.
    if (first || !panel.current?.contains(document.activeElement))
      primary.current?.focus();
  }, [preview, waiting]);

  const edited = (): CubeTimeImport | undefined =>
    csv && sessions
      ? {
          ...csv,
          sessions: sessions.map((session) => ({
            ...session,
            name: session.name.trim(),
          })),
        }
      : undefined;

  return (
    <section
      data-part="import-preview"
      data-import-source={preview.source}
      aria-label={t.importSessions}
      ref={panel}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!waiting && !nothingNew && !unnamed) onConfirm(edited());
        }}
      >
        <ul data-part="import-sessions">
          {preview.sessions.map(({ key, name, event, solves }, index) => {
            const file = csv?.files[index];
            const draft = sessions?.[index];
            return (
              // A file keeps its row when its puzzle (and so its key) changes, and the
              // focus with it.
              <li key={file?.name ?? key} data-import-file={file?.name}>
                {file && draft ? (
                  <>
                    <input
                      data-action="import-session-name"
                      aria-label={`${words.sessionName}: ${file.name}`}
                      placeholder={words.sessionName}
                      {...titleField("import-session-title")}
                      required
                      disabled={busy}
                      value={draft.name}
                      onChange={({ currentTarget }) => {
                        const name = currentTarget.value;
                        setSessions((old) =>
                          old?.map((session, i) =>
                            i === index ? { ...session, name } : session,
                          ),
                        );
                      }}
                    />
                    <select
                      data-action="import-session-event"
                      aria-label={`${words.event}: ${file.name}`}
                      disabled={busy}
                      value={draft.event}
                      onChange={({ currentTarget }) => {
                        const { value } = currentTarget;
                        if (!isEventId(value) || !sessions) return;
                        const next = sessions.map((session, i) =>
                          i === index ? { ...session, event: value } : session,
                        );
                        setSessions(next);
                        if (csv) onReview({ ...csv, sessions: next });
                      }}
                    >
                      {timedEvents.map(({ id, label }) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <>
                    <span>{name}</span>
                    <span>{eventInfo(event).label}</span>
                  </>
                )}
                <span>{solves}</span>
              </li>
            );
          })}
        </ul>
        {allHere ? (
          <p data-part="import-here">{t.importAllHere(preview.solves)}</p>
        ) : (
          here > 0 && <p data-part="import-here">{t.importHere(here)}</p>
        )}
        {preview.penalized > 0 && (
          <p data-part="import-penalized">
            {t.importPenalized(preview.penalized)}
          </p>
        )}
        {issueLines(preview, t).map(({ id, text }) => (
          <p data-part="import-issue" key={id}>
            {text}
          </p>
        ))}
        {csv && <p data-part="import-csv-penalties">{t.importCsvPenalties}</p>}
        {csv && preview.localDates > 0 && (
          <p data-part="import-csv-zone">{t.importCsvZone(csv.timeZone)}</p>
        )}
        <p data-part="import-actions">
          {!nothingNew && (
            <button
              type="submit"
              data-action="import-confirm"
              ref={primary}
              disabled={waiting || unnamed}
            >
              {t.importConfirm(preview.added, preview.penalized)}
            </button>
          )}
          <button
            type="button"
            data-action="import-cancel"
            ref={nothingNew ? primary : undefined}
            disabled={busy}
            onClick={onCancel}
          >
            {nothingNew ? t.importClose : t.importCancel}
          </button>
        </p>
      </form>
    </section>
  );
}
