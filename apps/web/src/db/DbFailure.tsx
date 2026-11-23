import { useRef, useState } from "react";
import { backupFileName, download } from "../backup-file";
import type { Text } from "../text";
import type { DbState } from "./open";
import type { RecoveryResult } from "./recovery";
import "./DbFailure.css";

type Feedback = "newer" | "format" | "reference" | "restore" | "save";

export function DbFailure({
  state,
  words,
}: {
  state: Extract<DbState, { kind: "failed" }>;
  words: Text;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const recovery = state.recovery;
  const restoreFile = recovery?.restoreFile;
  const restoreLatest = recovery?.restoreLatest;
  const saveReadable = recovery?.saveReadable;

  async function act(
    operation: () => Promise<Feedback | null>,
    error: Feedback,
  ) {
    setBusy(true);
    setFeedback(null);
    try {
      setFeedback(await operation());
    } catch {
      setFeedback(error);
    } finally {
      setBusy(false);
    }
  }

  function restore(operation: () => Promise<RecoveryResult>) {
    void act(async () => {
      const result = await operation();
      if ("problem" in result) return result.problem;
      location.reload();
      return null;
    }, "restore");
  }

  return (
    <p
      data-part="db-state"
      data-kind="failed"
      data-db-recovery={recovery ? "" : undefined}
      data-no-timer
    >
      <span role="status">
        {feedback
          ? words.dbRecoveryFeedback[feedback]
          : state.newer
            ? words.dbNewer
            : recovery
              ? words.dbOpenFailed
              : words.dbFailed}
      </span>{" "}
      <span data-part="db-recovery-actions">
        {restoreLatest && (
          <button
            type="button"
            data-action="restore-latest-backup"
            disabled={busy}
            onClick={() => restore(restoreLatest)}
          >
            {words.dbRestoreLatest}
          </button>
        )}
        {restoreFile && (
          <>
            <button
              type="button"
              data-action="restore-backup-file"
              disabled={busy}
              onClick={() => picker.current?.click()}
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
            disabled={busy}
            onClick={() =>
              void act(async () => {
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
              }, "save")
            }
          >
            {words.dbSaveReadable}
          </button>
        )}
      </span>
    </p>
  );
}
