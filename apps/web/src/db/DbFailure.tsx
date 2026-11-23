import { useRef, useState } from "react";
import { backupFileName, download } from "../backup-file";
import type { Text } from "../text";
import type { DbState } from "./open";
import type { RecoveryResult } from "./recovery";
import "./DbFailure.css";

type Feedback = "newer" | "format" | "reference" | "restore" | "save";

/**
 * The database that would not open (DESIGN.md section 17, *The database that would not
 * open*): one sentence in the status line's message place, then the way out, the main
 * one first. While a restore runs the words stay where they are and say so; the buttons
 * keep the keyboard's focus (aria-disabled, not disabled), so a failure is heard and the
 * next try is one press away.
 */
export function DbFailure({
  state,
  words,
}: {
  state: Extract<DbState, { kind: "failed" }>;
  words: Text;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [doing, setDoing] = useState<"restore" | "save" | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const busy = doing !== null;
  const recovery = state.recovery;
  const restoreFile = recovery?.restoreFile;
  const restoreLatest = recovery?.restoreLatest;
  const saveReadable = recovery?.saveReadable;
  const actions = Boolean(restoreLatest || restoreFile || saveReadable);

  async function act(
    kind: "restore" | "save",
    operation: () => Promise<Feedback | null>,
    error: Feedback,
  ) {
    setDoing(kind);
    setFeedback(null);
    try {
      setFeedback(await operation());
    } catch {
      setFeedback(error);
    } finally {
      setDoing(null);
    }
  }

  function restore(operation: () => Promise<RecoveryResult>) {
    void act(
      "restore",
      async () => {
        const result = await operation();
        if ("problem" in result) return result.problem;
        location.reload();
        return null;
      },
      "restore",
    );
  }

  const message =
    doing === "restore"
      ? words.dbRestoring
      : feedback
        ? words.dbRecoveryFeedback[feedback]
        : state.newer
          ? words.dbNewer
          : actions
            ? words.dbOpenFailed
            : words.dbFailed;

  return (
    <p
      data-part="db-state"
      data-kind="failed"
      data-db-recovery={actions ? "" : undefined}
      data-busy={busy ? "" : undefined}
      data-no-timer
    >
      <span
        role="alert"
        data-part="db-message"
        data-feedback={feedback ?? undefined}
      >
        {message}
      </span>
      {actions && (
        <span data-part="db-recovery-actions">
          {restoreLatest && (
            <button
              type="button"
              data-action="restore-latest-backup"
              aria-disabled={busy || undefined}
              onClick={() => {
                if (!busy) restore(restoreLatest);
              }}
            >
              {words.dbRestoreLatest}
            </button>
          )}
          {restoreFile && (
            <>
              <button
                type="button"
                data-action="restore-backup-file"
                aria-disabled={busy || undefined}
                onClick={() => {
                  if (!busy) picker.current?.click();
                }}
              >
                {words.dbRestoreFile}
              </button>
              <input
                ref={picker}
                type="file"
                accept=".json,application/json"
                hidden
                disabled={busy}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) restore(() => restoreFile(file));
                }}
              />
            </>
          )}
          {saveReadable && (
            <button
              type="button"
              data-action="save-readable"
              data-quiet={restoreLatest || restoreFile ? "" : undefined}
              aria-disabled={busy || undefined}
              onClick={() => {
                if (busy) return;
                void act(
                  "save",
                  async () => {
                    const saved = await saveReadable();
                    if (!saved) return "save";
                    download(
                      backupFileName(
                        new Date(),
                        "recovered",
                        typeof saved === "string" ? "json" : "sqlite3",
                      ),
                      saved,
                    );
                    return null;
                  },
                  "save",
                );
              }}
            >
              {words.dbSaveReadable}
            </button>
          )}
        </span>
      )}
    </p>
  );
}
