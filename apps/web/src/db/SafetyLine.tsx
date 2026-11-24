import { useEffect, useState } from "react";
import type { AppState, AppView } from "../app-state";
import { backupFileName, download } from "../backup-file";
import { inPhoneApp } from "../phone-app";
import type { Text } from "../text";
import { inDesktopApp } from "./native";
import {
  askPersistence,
  type SafetyLine as Line,
  readPlatform,
  safetyLine,
  safetyMarks,
  wasWiped,
} from "./safety";

/**
 * The web's one quiet line about keeping the history (db/safety.ts): in the status line's
 * message place, only while the timer waits and no other database line stands there.
 */
export function SafetyLine({
  app,
  view,
  words,
  idle,
}: {
  app: AppState;
  view: AppView;
  words: Text;
  idle: boolean;
}) {
  const web = !inPhoneApp() && !inDesktopApp();
  const open = web && view.dbState?.kind === "persistent";
  const [line, setLine] = useState<Line | "wiped">(null);
  const [total, setTotal] = useState<number | null>(null);
  const newest = view.rows[0]?.solve.id;
  const sessions = view.sessions.length;

  // The live solves, counted when the history opens and after it changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the signals.
  useEffect(() => {
    if (!open) return;
    let live = true;
    const timer = setTimeout(() => {
      void app
        .solveTotal()
        .then((n) => {
          if (live) setTotal(n);
        })
        .catch(() => {});
    }, 1000);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [app, open, newest, sessions]);

  // The first count says whether the solves went; later ones only keep the mark.
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (total === null) return;
    if (!checked) {
      setChecked(true);
      if (wasWiped(safetyMarks.count(), total)) {
        safetyMarks.setCount(0);
        setLine("wiped");
        return;
      }
    }
    safetyMarks.setCount(total);
  }, [total, checked]);

  // Persistence is asked for once there is something to keep; then at most one line.
  useEffect(() => {
    if (total === null || total === 0 || line !== null) return;
    let live = true;
    void askPersistence().then((persisted) => {
      if (!live) return;
      const next = safetyLine({
        persisted,
        ...readPlatform(),
        solves: total,
        now: Date.now(),
        savedAt: safetyMarks.savedAt(),
        offeredAt: safetyMarks.offeredAt(),
        homeSaid: safetyMarks.homeSaid(),
      });
      if (next === "home") safetyMarks.noteHome();
      if (next === "copy") safetyMarks.noteOffered();
      if (next) setLine(next);
    });
    return () => {
      live = false;
    };
  }, [total, line]);

  // A wipe is said until the first new solve; the others for this visit.
  useEffect(() => {
    if (line === "wiped" && total !== null && total > 0) setLine(null);
  }, [line, total]);

  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      // backup-file.ts notes the saved copy.
      await download(backupFileName(), await app.exportBackup());
      setLine(null);
    } catch {
      /* The line stays: the next press tries again. */
    } finally {
      setBusy(false);
    }
  }

  if (!open || !idle || line === null) return null;
  const t = words.safety;
  return (
    <p data-part="db-state" data-kind={line}>
      {line === "wiped" ? t.wiped : line === "home" ? t.home : t.copy}
      {line !== "wiped" && (
        <>
          {" "}
          <button
            type="button"
            data-no-timer
            data-action="save-copy"
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) void save();
            }}
          >
            {t.save}
          </button>
        </>
      )}
    </p>
  );
}
