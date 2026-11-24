import {
  CROSS_COLOURS,
  type CrossColour,
  eventInfo,
  faceOfCrossColour,
} from "@cubehaus/core";
import { type FaceLetter, frontsFor } from "@cubehaus/cube/holding";
import { eventOfScrType } from "@cubehaus/importers";
import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import type { AppState, AppView } from "../app-state";
import { backupFileName, download } from "../backup-file";
import type { BackupMeta, NativeBackups } from "../db/native";
import "../design/settings.css";

const exportFormats = {
  cstimer: { kind: "cstimer", extension: "txt", type: "text/plain" },
  csv: { kind: "solves", extension: "csv", type: "text/csv;charset=utf-8" },
} as const;

import type { ImportInput, ImportPreview } from "../import";
import { keysShown, watchKeys } from "../input/hardware-keys";
import {
  isTouchPhone,
  isTouchScreen,
  watchTouchPhone,
} from "../input/touch-screen";
import { ACTIONS } from "../keys/actions";
import {
  actionKey,
  captureKey,
  type Keymap,
  keysFor,
  validateBindings,
} from "../keys/keymap";
import { isMacPlatform, keyLabel } from "../keys/label";
import { canKeepAwake } from "../phone-app";
import { drillName } from "../scramble/training-client";
import { slotKey } from "../session-stats";
import { eventNamed } from "../session-switch";
import { coloursInPlay, isLayout, type Settings as Values } from "../settings";
import { gestureList, type Text } from "../text";
import { isThemeChoice } from "../theme";
import { appVersion } from "../version";
import {
  DEFAULT_SIZES,
  SIZE_MAX,
  SIZE_MIN,
  SIZE_STEP,
  VIEW_PARTS,
} from "../view-size";
import { ImportPreviewPanel } from "./Import";
import { ThemeEditor } from "./ThemeEditor";

const sizeChoices = Array.from(
  { length: (SIZE_MAX - SIZE_MIN) / SIZE_STEP + 1 },
  (_, i) => SIZE_MIN + i * SIZE_STEP,
);
const GestureHelp = lazy(() =>
  import("../keys/Help").then(({ Help }) => ({ default: Help })),
);
const holdChoices = [0, 100, 200, 300, 400, 500, 550, 700, 1000];

function ShortcutSettings({
  app,
  view,
  words,
  enabled,
  keys,
}: {
  app: AppState;
  view: AppView;
  words: Text;
  enabled: boolean;
  /** Keys at hand: the commands and their bindings; otherwise only the gestures. */
  keys: boolean;
}) {
  const t = words.settings;
  const language = view.settings.language;
  const [gesturesOpen, setGesturesOpen] = useState(false);
  const gestureButton = useRef<HTMLButtonElement>(null);
  const closeGestures = () => {
    flushSync(() => setGesturesOpen(false));
    gestureButton.current?.focus({ preventScroll: true });
  };
  const [capture, setCapture] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const mac = isMacPlatform();
  const label = (binding: string) => keyLabel(binding, mac, language);
  async function save(next: Keymap, id: string | null) {
    const conflict = validateBindings(next, mac ? "mac" : "other")[0];
    setCapture(null);
    if (conflict) {
      setNoticeFor(id);
      setNoticeKind("error");
      const names = ACTIONS.filter((spec) => conflict.ids.includes(spec.id))
        .map((spec) => spec.title[language])
        .join(" · ");
      setNotice(
        conflict.reason === "reserved"
          ? t.keysReserved
          : conflict.reason === "invalid"
            ? t.keysInvalid
            : t.keysConflict(label(conflict.key), names),
      );
      return;
    }
    setNotice("");
    setSaving(true);
    const saved = await app.setKeymap(next);
    setSaving(false);
    if (!saved) say(id, t.keysFailed, "error");
  }
  // The line under the row it is about: a clash or a refusal in `error`, a cancel in `dim`.
  const [noticeFor, setNoticeFor] = useState<string | null>(null);
  const [noticeKind, setNoticeKind] = useState<"error" | "note">("error");
  const say = (id: string | null, text: string, kind: "error" | "note") => {
    setNoticeFor(id);
    setNoticeKind(kind);
    setNotice(text);
  };
  const noticeLine = (id: string | null) =>
    notice && noticeFor === id ? (
      <p data-part="binding-notice" data-kind={noticeKind} aria-hidden="true">
        {notice}
      </p>
    ) : null;
  return (
    <section data-part="keymap" data-open>
      {/* Read once, wherever the line under a row shows it. */}
      <p data-part="keymap-notice" role="status">
        {notice}
      </p>
      {gesturesOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: Escape closes the open dialog.
        <div
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            closeGestures();
          }}
        >
          <Suspense fallback={null}>
            <GestureHelp
              bindings={[]}
              language={language}
              title={words.gestures.title}
              gestures={gestureList(words, isTouchPhone())}
              closeLabel={t.title}
              onClose={closeGestures}
            />
          </Suspense>
        </div>
      )}
      <div id="keymap-list" data-part="keymap-list">
        <ul>
          {isTouchScreen() && (
            <li data-setting="gestures">
              <span>{words.gestures.title}</span>{" "}
              <button
                ref={gestureButton}
                type="button"
                data-action="settings-gestures"
                onClick={() => setGesturesOpen(true)}
              >
                {t.keysOpen}
              </button>
            </li>
          )}
          {keys && (
            <>
              <li data-setting="commands">
                <span>{words.paletteTitle}</span>{" "}
                <a href="#/commands" data-action="commands-open">
                  {t.keysOpen}
                </a>
              </li>
              <li data-setting="keyboard-reset">
                <span>{t.keysAll}</span>{" "}
                <button
                  type="button"
                  data-action="keyboard-reset"
                  disabled={!enabled || saving}
                  onClick={() => void save({}, null)}
                >
                  {t.keysReset}
                </button>
                {noticeLine(null)}
              </li>
            </>
          )}
        </ul>
        {keys && (
          <ul data-part="bindings">
            {ACTIONS.map((spec) => {
              const keys = keysFor(view.keymap, spec.id);
              const active = capture === spec.id;
              const title = spec.title[language];
              const shown = keys.length
                ? keys.map(label).join(" · ")
                : t.keysUnbound;
              return (
                <li
                  key={spec.id}
                  data-binding={spec.id}
                  data-capturing={active || undefined}
                >
                  <span data-part="binding-name">{title}</span>
                  <button
                    type="button"
                    data-action="binding-remove"
                    disabled={!enabled || saving || keys.length === 0}
                    aria-label={`${t.keysRemove} · ${title}`}
                    onClick={() =>
                      void save({ ...view.keymap, [spec.id]: [] }, spec.id)
                    }
                  >
                    {t.keysRemove}
                  </button>
                  <button
                    type="button"
                    data-action="binding-change"
                    data-unbound={keys.length === 0 || undefined}
                    disabled={!enabled || saving}
                    aria-label={`${title}: ${active ? t.keysPress : shown}. ${t.keysChange}`}
                    onClick={(event) => {
                      event.currentTarget.focus();
                      setNotice("");
                      setCapture(active ? null : spec.id);
                    }}
                    onBlur={() =>
                      setCapture((current) =>
                        current === spec.id ? null : current,
                      )
                    }
                    onKeyDown={(event) => {
                      if (!active || event.code === "Tab" || event.repeat)
                        return;
                      if (event.code === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        setCapture(null);
                        say(spec.id, t.keysCancel, "note");
                        return;
                      }
                      const binding = captureKey(event, !!spec.input);
                      if (!binding) return;
                      event.preventDefault();
                      event.stopPropagation();
                      void save(
                        { ...view.keymap, [spec.id]: [binding] },
                        spec.id,
                      );
                    }}
                  >
                    <span data-part="binding-keys">
                      {active ? t.keysPress : shown}
                    </span>
                  </button>
                  {noticeLine(spec.id)}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

// A plain list: the label, then its control. Language, calls, hold, the
// running display and decimals hold for every session; inspection and entry
// belong to the session on screen, as the I and E keys change them.
/** The six colours, white and yellow first, then round the sides. */
const COLOUR_ORDER: readonly FaceLetter[] = ["U", "D", "F", "R", "B", "L"];

/**
 * Settings is five short lists, one on screen at a time, picked from a row of tiles. A
 * phone has no keys: its fifth is More, the rows of second rank folded together.
 */
export const SETTINGS_SECTIONS = [
  "session",
  "timer",
  "look",
  "keys",
  "data",
  "more",
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
/** Each tile's picture is a character of the thing itself, in the app's own faces. */
const SECTION_GLYPH: Record<SettingsSection, string> = {
  session: "1",
  timer: "0.0",
  look: "Aa",
  keys: "⇧",
  data: "↓",
  more: "…",
};

const SECTION_KEY = "cubehaus.settings.section";
function lastSection() {
  try {
    return localStorage.getItem(SECTION_KEY) ?? "";
  } catch {
    return "";
  }
}

export function Settings({
  app,
  view,
  words,
  route,
}: {
  app: AppState;
  view: AppView;
  words: Text;
  route: string;
}) {
  const phone = useSyncExternalStore(watchTouchPhone, isTouchPhone);
  const keys = useSyncExternalStore(watchKeys, keysShown);
  const sections = SETTINGS_SECTIONS.filter((id) =>
    id === "session"
      ? !!view.current
      : id === "keys"
        ? !phone
        : id === "more"
          ? phone
          : true,
  );
  // Opened without a section, Settings shows the one the person left it on.
  const asked = route.slice("#/settings/".length) || lastSection();
  const section: SettingsSection =
    sections.find((id) => id === asked) ?? sections[0] ?? "timer";
  useEffect(() => {
    try {
      localStorage.setItem(SECTION_KEY, section);
    } catch {
      // Private windows: the first section each time.
    }
  }, [section]);
  // Opened at its Data (the first visit's "Solves from another timer"): the keyboard is
  // on the import.
  useLayoutEffect(() => {
    if (location.hash !== "#/settings/data") return;
    document
      .querySelector<HTMLInputElement>('[data-action="import-file"] input')
      ?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        !actionKey(view.keymap, "settings.close", event)
      )
        return;
      event.preventDefault();
      location.hash = "#/";
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [view.keymap]);

  const t = words.settings;
  const values = view.settings;
  const session = view.current;
  const enabled =
    view.dbState?.kind === "persistent" || view.dbState?.kind === "memory";
  const timed = eventInfo(session?.event ?? "333").kind === "time";
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const ticket = useRef(0);
  const [result, setResult] = useState("");
  const [preview, setPreview] = useState<{
    input: ImportInput;
    data: ImportPreview;
  } | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (busy || preview || !returnFocus.current) return;
    returnFocus.current.focus();
    returnFocus.current = null;
  }, [busy, preview]);

  const dataEnabled =
    enabled && !!(view.dbState as { exportBackup?: unknown }).exportBackup;
  const importEnabled =
    enabled && !!(view.dbState as { importFile?: unknown }).importFile;
  const exportEnabled =
    enabled && !!(view.dbState as { exportFile?: unknown }).exportFile;
  async function saveBackup() {
    setBusy(true);
    setResult("");
    try {
      const writing = download(backupFileName(), await app.exportBackup());
      if (writing) {
        await writing;
        setResult(t.savedToDownloads);
      }
    } catch {
      setResult(t.backupFailed);
    } finally {
      setBusy(false);
    }
  }
  const earlier =
    view.dbState?.kind === "persistent" && !!view.dbState.mergeEarlier;
  async function addEarlier() {
    setBusy(true);
    setResult("");
    try {
      setResult((await app.mergeEarlier()) ? t.earlierAdded : t.earlierFailed);
    } catch {
      setResult(t.earlierFailed);
    } finally {
      setBusy(false);
    }
  }
  async function restoreFile(file: File) {
    setBusy(true);
    setResult(t.restoring);
    try {
      const outcome = await app.restoreBackup(file);
      setResult(
        "problem" in outcome
          ? t.restoreProblem[outcome.problem]
          : t.restored(outcome),
      );
    } catch {
      setResult(t.restoreFailed);
    } finally {
      setBusy(false);
    }
  }
  /** Another timer's file: every session, or only the open one. */
  async function saveExport(
    format: keyof typeof exportFormats,
    sessionId?: string,
  ) {
    const { kind, extension, type } = exportFormats[format];
    setBusy(true);
    setPreview(null);
    setResult("");
    try {
      const saved = await app.exportFile(format, sessionId);
      const writing = download(
        backupFileName(new Date(), kind, extension),
        saved.text,
        type,
      );
      if (writing) await writing;
      setResult(t.exported(saved, writing ? t.savedToDownloads : undefined));
    } catch {
      setResult(t.backupFailed);
    } finally {
      setBusy(false);
    }
  }
  // A new puzzle for a CSV file reads the files again while the rows stay editable; only
  // the latest reading counts.
  async function readImport(input: ImportInput, review = false) {
    const own = ++ticket.current;
    const latest = () => own === ticket.current;
    if (review) setReviewing(true);
    else {
      setBusy(true);
      setPreview(null);
      setResult(t.importReading);
    }
    try {
      const outcome = await app.previewImport(input);
      if (!latest()) return;
      if ("formatError" in outcome) {
        if (!review) returnFocus.current = picker.current;
        setResult(t.importProblem[outcome.formatError]);
      } else {
        setResult("");
        setPreview({ input, data: outcome });
      }
    } catch {
      if (!latest()) return;
      if (!review) returnFocus.current = picker.current;
      setResult(t.importFailed);
    } finally {
      if (latest()) {
        setBusy(false);
        setReviewing(false);
      }
    }
  }
  function readCsv(files: File[]) {
    if (files.length === 0) return;
    const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    const sessions = files.map((file) => {
      const name = file.name
        .replace(/\.csv$/i, "")
        .replace(/^CubeTime - /i, "")
        .trim();
      const event = eventNamed(name) ?? eventOfScrType("333", name).id;
      return {
        name: name || words.defaultSession,
        event: eventInfo(event).kind === "time" ? event : ("333" as const),
      };
    });
    void readImport({ files, sessions, timeZone });
  }
  // One field takes what the person has: a csTimer file (from csTimer, or CubeTime’s
  // export for it) or CubeTime’s CSV files, one per session.
  function readFiles(files: File[]) {
    if (files.length === 0) return;
    const csv = files.filter(
      ({ name, type }) => /\.csv$/i.test(name) || type === "text/csv",
    );
    const [only] = files;
    if (csv.length === files.length) readCsv(files);
    else if (files.length === 1 && only) void readImport(only);
    else {
      setPreview(null);
      setResult(t.importOneKind);
    }
  }
  function closeImport() {
    ticket.current++;
    setReviewing(false);
    returnFocus.current = picker.current;
    setPreview(null);
  }
  async function confirmImport(input: ImportInput) {
    setBusy(true);
    setResult(t.importing);
    try {
      const outcome = await app.importFile(input);
      closeImport();
      setResult(
        "formatError" in outcome
          ? t.importProblem[outcome.formatError]
          : t.imported(outcome),
      );
    } catch {
      setResult(t.importFailed);
    } finally {
      setBusy(false);
    }
  }
  const set = <K extends keyof Values>(
    key: K,
    value: Values[K],
    own?: boolean,
  ) => {
    void app.setSetting(key, value, own ? session?.id : undefined);
  };
  /** Custom: the stored theme, or a new one on the theme in view, then the choice. */
  async function chooseCustom() {
    if (!view.customTheme) {
      const base =
        values.theme === "light" || values.theme === "dark"
          ? values.theme
          : document.documentElement.dataset.theme === "light"
            ? "light"
            : "dark";
      if (
        !(await app.setCustomTheme({
          version: 1,
          base,
          tokens: {},
          image: null,
        }))
      )
        return;
    }
    set("theme", "custom");
  }
  const colourName = (face: FaceLetter) => {
    const name = words.drill.colour[face];
    return name.charAt(0).toUpperCase() + name.slice(1);
  };
  // The colours in play: at least one; the colour held at the bottom and its opposite
  // are stored as none chosen, so they follow the colours held.
  const inPlay = coloursInPlay(values);
  const toggleColour = (colour: CrossColour) => {
    const on = inPlay.includes(colour);
    if (on && inPlay.length === 1) return;
    const next = CROSS_COLOURS.filter((each) =>
      each === colour ? !on : inPlay.includes(each),
    );
    const own = coloursInPlay({ holding: values.holding, crossColours: null });
    set(
      "crossColours",
      next.length === own.length && own.every((each) => next.includes(each))
        ? null
        : next,
      true,
    );
  };
  const row = (
    key: string,
    label: string,
    control: (id: string) => ReactNode,
  ) => (
    <li data-setting={key}>
      <label htmlFor={`setting-${key}`}>{label}</label>{" "}
      {control(`setting-${key}`)}
    </li>
  );
  const startModeRow = row("startMode", t.startMode, (id) => (
    <select
      id={id}
      value={values.startMode}
      disabled={!enabled}
      onChange={(event) =>
        set(
          "startMode",
          event.currentTarget.value === "two-hand" ? "two-hand" : "space",
        )
      }
    >
      <option value="space">{t.startSpace}</option>
      <option value="two-hand">{t.startTwoHand}</option>
    </select>
  ));
  const precisionRow = row("precision", t.precision, (id) => (
    <select
      id={id}
      value={values.precision}
      disabled={!enabled}
      onChange={(e) => set("precision", e.currentTarget.value === "3" ? 3 : 2)}
    >
      <option value="2">2</option>
      <option value="3">3</option>
    </select>
  ));
  const awakeRow =
    canKeepAwake() &&
    row("awake", t.awake, (id) => (
      <select
        id={id}
        value={values.awake ? "on" : "off"}
        disabled={!enabled}
        onChange={(event) => set("awake", event.currentTarget.value === "on")}
      >
        <option value="on">{t.recordCueChoices.on}</option>
        <option value="off">{t.recordCueChoices.off}</option>
      </select>
    ));
  const recordCueRow = row("recordCue", t.recordCue, (id) => (
    <select
      id={id}
      value={values.recordCue ? "on" : "off"}
      disabled={!enabled}
      onChange={(event) => set("recordCue", event.currentTarget.value === "on")}
    >
      <option value="on">{t.recordCueChoices.on}</option>
      <option value="off">{t.recordCueChoices.off}</option>
    </select>
  ));
  const todayRow = row("today", t.today, (id) => (
    <select
      id={id}
      value={values.today ? "on" : "off"}
      disabled={!enabled}
      onChange={(event) => set("today", event.currentTarget.value === "on")}
    >
      <option value="on">{t.recordCueChoices.on}</option>
      <option value="off">{t.recordCueChoices.off}</option>
    </select>
  ));
  const holdingTopRow = row("holdingTop", t.holdingTop, (id) => (
    <select
      id={id}
      value={values.holding[0]}
      disabled={!enabled}
      onChange={(e) => {
        const top = e.currentTarget.value as FaceLetter;
        const front = values.holding[1] as FaceLetter;
        const fronts = frontsFor(top);
        set("holding", `${top}${fronts.includes(front) ? front : fronts[0]}`);
      }}
    >
      {COLOUR_ORDER.map((face) => (
        <option key={face} value={face}>
          {colourName(face)}
        </option>
      ))}
    </select>
  ));
  const holdingFrontRow = row("holdingFront", t.holdingFront, (id) => (
    <select
      id={id}
      value={values.holding[1]}
      disabled={!enabled}
      onChange={(e) =>
        set("holding", `${values.holding[0]}${e.currentTarget.value}`)
      }
    >
      {frontsFor(values.holding[0] as FaceLetter).map((face) => (
        <option key={face} value={face}>
          {colourName(face)}
        </option>
      ))}
    </select>
  ));
  const resetAveragesButton = Object.hasOwn(
    values.statSlots,
    slotKey(session?.event ?? "333", values.layout),
  ) && (
    <button
      type="button"
      data-action="reset-averages"
      onClick={() => void app.resetStatSlots()}
    >
      {words.resetAverages}
    </button>
  );
  const sizeRows = (
    <>
      <h2>{words.sizes.title}</h2>
      <ul data-part="sizes">
        {VIEW_PARTS.map((part) =>
          row(`size-${part}`, words.sizes.part[part], (id) => (
            <select
              id={id}
              data-size-control={part}
              value={values.sizes[part]}
              disabled={!enabled}
              onChange={(event) =>
                set("sizes", {
                  ...values.sizes,
                  [part]: Number(event.currentTarget.value),
                })
              }
            >
              {sizeChoices.map((percent) => (
                <option key={percent} value={percent}>
                  {percent} %
                </option>
              ))}
            </select>
          )),
        )}
      </ul>
      {VIEW_PARTS.some((part) => values.sizes[part] !== 100) && (
        <button
          type="button"
          data-action="reset-sizes"
          disabled={!enabled}
          onClick={() => set("sizes", DEFAULT_SIZES)}
        >
          {words.sizes.reset}
        </button>
      )}
    </>
  );
  const exportRows = (
    <>
      <li data-setting="export-cstimer">
        <span id="data-export-cstimer">{t.exportCsTimer}</span>{" "}
        <span data-part="export-choice">
          <button
            type="button"
            data-action="export-cstimer-session"
            aria-describedby="data-export-cstimer"
            disabled={!exportEnabled || busy || !view.current}
            onClick={() => void saveExport("cstimer", view.current?.id)}
          >
            {t.exportSession}
          </button>
          <button
            type="button"
            data-action="export-cstimer"
            aria-describedby="data-export-cstimer"
            disabled={!exportEnabled || busy}
            onClick={() => void saveExport("cstimer")}
          >
            {t.exportAll}
          </button>
        </span>
      </li>
      <li data-setting="export-csv">
        <span id="data-export-csv">{t.exportCsv}</span>{" "}
        <span data-part="export-choice">
          <button
            type="button"
            data-action="export-csv-session"
            aria-describedby="data-export-csv"
            disabled={!exportEnabled || busy || !view.current}
            onClick={() => void saveExport("csv", view.current?.id)}
          >
            {t.exportSession}
          </button>
          <button
            type="button"
            data-action="export-csv"
            aria-describedby="data-export-csv"
            disabled={!exportEnabled || busy}
            onClick={() => void saveExport("csv")}
          >
            {t.exportAll}
          </button>
        </span>
      </li>
    </>
  );
  return (
    <main data-part="settings" data-no-timer>
      <a href="#/" data-action="settings-close">
        {words.backToTimer}
      </a>
      <h1>{t.title}</h1>
      {view.dbState?.kind === "busy" && (
        // The rows below are off while another tab holds the database: say why, in the
        // timer's own db-state line.
        <p data-part="db-state" data-kind="busy">
          {t.busy}
        </p>
      )}
      <nav
        data-part="settings-sections"
        aria-label={t.title}
        onKeyDown={(event) => {
          // ← → walk the row, the keyboard staying on the square in view.
          const step =
            event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          const next = sections[sections.indexOf(section) + step];
          if (!step || !next) return;
          event.preventDefault();
          location.replace(`#/settings/${next}`);
          event.currentTarget
            .querySelector<HTMLElement>(`[data-section="${next}"]`)
            ?.focus();
        }}
      >
        {sections.map((id) => (
          <a
            key={id}
            href={`#/settings/${id}`}
            data-section={id}
            aria-current={id === section ? "page" : undefined}
            onClick={(event) => {
              // One screen: Back leaves Settings, it does not walk the sections.
              event.preventDefault();
              location.replace(`#/settings/${id}`);
            }}
          >
            <span data-part="section-glyph" aria-hidden="true">
              {id === "session" && session
                ? eventInfo(session.event).label
                : SECTION_GLYPH[id]}
            </span>
            {id === "keys" && !keys ? words.gestures.title : t.sections[id]}
          </a>
        ))}
      </nav>
      <div key={section} data-part="settings-section">
        {section === "session" && session && (
          // What belongs to the open session first, under its name; then what holds for
          // every session.
          <>
            <h2 data-part="settings-scope">
              <span data-part="settings-session">{session.name}</span>
            </h2>
            <ul data-part="settings-session-rows">
              {session &&
                row("inspection", t.inspection, (id) => (
                  <select
                    id={id}
                    value={values.inspection}
                    disabled={!enabled}
                    onChange={(e) =>
                      set(
                        "inspection",
                        e.currentTarget.value === "off" ? "off" : "official",
                        true,
                      )
                    }
                  >
                    <option value="official">
                      {t.inspectionChoices.official}
                    </option>
                    <option value="off">{t.inspectionChoices.off}</option>
                  </select>
                ))}
              {session?.event === "333" && (
                <li data-setting="training">
                  <span>{words.drill.setting}</span>{" "}
                  <span data-part="training-choice">
                    <span data-part="training-current">
                      {drillName(values.training, words) ??
                        words.drill.official}
                    </span>{" "}
                    <a href="#/drills" data-action="training-open">
                      {words.drill.change}
                    </a>
                  </span>
                </li>
              )}
              {session?.event === "333" &&
                row("cross", t.cross, (id) => (
                  <select
                    id={id}
                    value={values.cross}
                    disabled={!enabled}
                    onChange={(e) =>
                      set(
                        "cross",
                        e.currentTarget.value === "assigned"
                          ? "assigned"
                          : "any",
                        true,
                      )
                    }
                  >
                    <option value="any">{t.crossChoices.any}</option>
                    <option value="assigned">{t.crossChoices.assigned}</option>
                  </select>
                ))}
              {session?.event === "333" && values.cross === "assigned" && (
                <li data-setting="crossColours">
                  <span id="setting-crossColours">{t.crossColours}</span>{" "}
                  <fieldset
                    data-part="cross-colours"
                    aria-labelledby="setting-crossColours"
                  >
                    {CROSS_COLOURS.map((colour) => (
                      <button
                        key={colour}
                        type="button"
                        data-action="cross-colour"
                        data-colour={colour}
                        aria-pressed={inPlay.includes(colour)}
                        disabled={!enabled}
                        onClick={() => toggleColour(colour)}
                      >
                        <span
                          data-part="cross-swatch"
                          data-face={faceOfCrossColour(colour)}
                          aria-hidden="true"
                        />
                        {words.cross.name[colour]}
                      </button>
                    ))}
                  </fieldset>
                </li>
              )}
              {session &&
                timed &&
                row("entry", t.entry, (id) => (
                  <select
                    id={id}
                    value={values.entry}
                    disabled={!enabled}
                    onChange={(e) =>
                      set(
                        "entry",
                        e.currentTarget.value === "typing" ? "typing" : "timer",
                        true,
                      )
                    }
                  >
                    <option value="timer">{words.timer}</option>
                    <option value="typing">{words.entry.typing}</option>
                  </select>
                ))}
            </ul>
          </>
        )}
        {section === "timer" && (
          <ul>
            {keys && startModeRow}
            {row("holdMs", t.holdMs, (id) => (
              <select
                id={id}
                value={values.holdMs}
                disabled={!enabled}
                onChange={(e) => set("holdMs", Number(e.currentTarget.value))}
              >
                {(holdChoices.includes(values.holdMs)
                  ? holdChoices
                  : [...holdChoices, values.holdMs].sort((a, b) => a - b)
                ).map((ms) => (
                  <option key={ms} value={ms}>
                    {t.holdValue(ms)}
                  </option>
                ))}
              </select>
            ))}
            {row("running", t.running, (id) => (
              <select
                id={id}
                value={values.running}
                disabled={!enabled}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  set(
                    "running",
                    value === "hundredths" ||
                      value === "tenths" ||
                      value === "hidden"
                      ? value
                      : "seconds",
                  );
                }}
              >
                <option value="tenths">{t.runningChoices.tenths}</option>
                <option value="hundredths">
                  {t.runningChoices.hundredths}
                </option>
                <option value="seconds">{t.runningChoices.seconds}</option>
                <option value="hidden">{t.runningChoices.hidden}</option>
              </select>
            ))}
            {row("calls", t.calls, (id) => (
              <select
                id={id}
                value={values.calls}
                disabled={!enabled}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  set(
                    "calls",
                    value === "voice"
                      ? "voice"
                      : value === "off"
                        ? "off"
                        : "tick",
                  );
                }}
              >
                <option value="tick">{t.callChoices.tick}</option>
                <option value="voice">{t.callChoices.voice}</option>
                <option value="off">{t.callChoices.off}</option>
              </select>
            ))}
            {!phone && precisionRow}
            {!phone && awakeRow}
          </ul>
        )}
        {section === "look" && (
          <>
            <ul>
              {row("language", t.language, (id) => (
                <select
                  id={id}
                  value={values.language}
                  disabled={!enabled}
                  onChange={(e) =>
                    set(
                      "language",
                      e.currentTarget.value === "ru" ? "ru" : "en",
                    )
                  }
                >
                  {/* Each language's name is written in that language, and read in it. */}
                  <option value="en" lang="en">
                    {t.languages.en}
                  </option>
                  <option value="ru" lang="ru">
                    {t.languages.ru}
                  </option>
                </select>
              ))}
              {row("theme", t.theme, (id) => (
                <select
                  id={id}
                  value={values.theme}
                  disabled={!enabled}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    if (value === "custom") void chooseCustom();
                    else if (isThemeChoice(value)) set("theme", value);
                  }}
                >
                  <option value="system">{t.themeChoices.system}</option>
                  <option value="dark">{t.themeChoices.dark}</option>
                  <option value="light">{t.themeChoices.light}</option>
                  <option value="custom">{t.themeChoices.custom}</option>
                </select>
              ))}
              {row("layout", t.layout, (id) => (
                <select
                  id={id}
                  value={values.layout}
                  disabled={!enabled}
                  onChange={(event) => {
                    const next = event.currentTarget.value;
                    if (isLayout(next)) set("layout", next);
                  }}
                >
                  <option value="lift">{t.layouts.lift}</option>
                  <option value="times">{t.layouts.times}</option>
                  <option value="focus">{t.layouts.focus}</option>
                </select>
              ))}
              {!phone && recordCueRow}
              {!phone && todayRow}
              {!phone && holdingTopRow}
              {!phone && holdingFrontRow}
            </ul>
            {!phone && resetAveragesButton}
            {values.theme === "custom" && view.customTheme && (
              <ThemeEditor
                app={app}
                saved={view.customTheme}
                enabled={enabled}
                words={words}
              />
            )}
            {!phone && sizeRows}
          </>
        )}
        {section === "keys" && (
          <ShortcutSettings
            app={app}
            view={view}
            words={words}
            enabled={enabled}
            keys={keys}
          />
        )}
        {section === "more" && (
          // A phone's second rank: the gestures, then what is set once and left.
          <>
            <ShortcutSettings
              app={app}
              view={view}
              words={words}
              enabled={enabled}
              keys={false}
            />
            <ul>
              {precisionRow}
              {awakeRow}
              {recordCueRow}
              {todayRow}
              {holdingTopRow}
              {holdingFrontRow}
            </ul>
            {resetAveragesButton}
            {sizeRows}
            <ul data-part="data" data-group="about">
              {exportRows}
              <AboutRows words={t} />
            </ul>
          </>
        )}
        {section === "data" && (
          <>
            <ul data-part="data">
              <li data-setting="backup">
                <span id="data-backup">{t.backup}</span>{" "}
                <button
                  type="button"
                  data-action="backup-save"
                  aria-describedby="data-backup"
                  disabled={!dataEnabled || busy}
                  onClick={() => void saveBackup()}
                >
                  {t.backupSave}
                </button>
              </li>
              <li data-setting="restore">
                <span id="data-restore">{t.restore}</span>{" "}
                <label data-action="backup-restore">
                  {t.restoreChoose}
                  <input
                    type="file"
                    accept=".json,application/json"
                    aria-describedby="data-restore"
                    disabled={!dataEnabled || busy}
                    onChange={({ currentTarget }) => {
                      const file = currentTarget.files?.[0];
                      currentTarget.value = "";
                      if (file) void restoreFile(file);
                    }}
                  />
                </label>
              </li>
              {earlier && (
                <li data-setting="earlier">
                  <span id="data-earlier">{t.earlier}</span>{" "}
                  <button
                    type="button"
                    data-action="earlier-add"
                    aria-describedby="data-earlier"
                    disabled={busy}
                    onClick={() => void addEarlier()}
                  >
                    {t.earlierAdd}
                  </button>
                </li>
              )}
              <li
                data-setting="import"
                onDragOver={(event) => {
                  if (
                    importEnabled &&
                    !busy &&
                    event.dataTransfer.types.includes("Files")
                  )
                    event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (importEnabled && !busy)
                    readFiles(Array.from(event.dataTransfer.files));
                }}
              >
                <span>{t.importFrom}</span>{" "}
                <label data-action="import-file">
                  {t.importChoose}
                  <input
                    type="file"
                    accept=".json,.txt,.csv,application/json,text/plain,text/csv"
                    aria-label={t.importFrom}
                    ref={picker}
                    multiple
                    disabled={!importEnabled || busy}
                    onChange={({ currentTarget }) => {
                      const files = Array.from(currentTarget.files ?? []);
                      currentTarget.value = "";
                      readFiles(files);
                    }}
                  />
                </label>
              </li>
              {!phone && exportRows}
              {!phone &&
                !(
                  view.dbState?.kind === "persistent" && view.dbState.backups
                ) && <AboutRows words={t} />}
            </ul>
            {preview && (
              <ImportPreviewPanel
                preview={preview.data}
                words={words}
                busy={busy}
                reviewing={reviewing}
                csv={preview.input instanceof File ? undefined : preview.input}
                onReview={(input) => void readImport(input, true)}
                onConfirm={(edited) =>
                  void confirmImport(edited ?? preview.input)
                }
                onCancel={closeImport}
              />
            )}
            <p data-part="data-result" role="status">
              {result}
            </p>
            {view.dbState?.kind === "persistent" && view.dbState.backups && (
              <BackupSettings
                app={app}
                backups={view.dbState.backups}
                words={words}
              />
            )}
            {!phone &&
              view.dbState?.kind === "persistent" &&
              view.dbState.backups && (
                <ul data-part="data">
                  <AboutRows words={t} />
                </ul>
              )}
          </>
        )}
      </div>
    </main>
  );
}

/**
 * The last rows of Data: the two pages beside the app (real links: the page has its own
 * way back), then the version.
 */
function AboutRows({
  words,
}: {
  words: {
    privacy: string;
    support: string;
    keysOpen: string;
    version: string;
  };
}) {
  return (
    <>
      <li data-setting="privacy">
        <span id="data-privacy">{words.privacy}</span>{" "}
        <a
          href="privacy.html"
          data-action="page-open"
          aria-describedby="data-privacy"
        >
          {words.keysOpen}
        </a>
      </li>
      <li data-setting="support">
        <span id="data-support">{words.support}</span>{" "}
        <a
          href="support.html"
          data-action="page-open"
          aria-describedby="data-support"
        >
          {words.keysOpen}
        </a>
      </li>
      <VersionRow label={words.version} />
    </>
  );
}

function VersionRow({ label }: { label: string }) {
  return (
    <li data-setting="version">
      <span>{label}</span> <span data-part="version-value">{appVersion()}</span>
    </li>
  );
}

/**
 * Desktop: the automatic copies. Where they go, the newest, a copy now, and the week of
 * copies, each restorable after a confirmation (the current history is copied first).
 */
function BackupSettings({
  app,
  backups,
  words,
}: {
  app: AppState;
  backups: NativeBackups;
  words: Text;
}) {
  const t = words.settings;
  const [folder, setFolder] = useState("");
  const [copies, setCopies] = useState<BackupMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(backups.lastError);
  const [asking, setAsking] = useState<BackupMeta | null>(null);
  // The year only when it is not this one, as under a past solve: the newest copy's time
  // and its Copy now share one line on a 320 px phone.
  const when = (copy: BackupMeta) => {
    const at = new Date(copy.createdAt);
    return at.toLocaleString(words.locale, {
      day: "numeric",
      month: "short",
      ...(at.getFullYear() !== new Date().getFullYear() && {
        year: "numeric",
      }),
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  useEffect(() => {
    let live = true;
    void Promise.all([backups.folder(), backups.list()])
      .then(([where, list]) => {
        if (!live) return;
        setFolder(where);
        setCopies(list);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [backups]);

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setStatus("");
    try {
      await work();
    } finally {
      setError(backups.lastError);
      setBusy(false);
    }
  }
  const copyNow = () =>
    act(async () => {
      try {
        await backups.now();
        setCopies(await backups.list());
        setStatus(t.backupDone);
      } catch {
        /* Shown from lastError. */
      }
    });
  const choose = () =>
    act(async () => {
      try {
        const picked = await backups.choose();
        if (picked === null) return;
        setFolder(picked);
        setCopies(await backups.list());
      } catch {
        setStatus(t.backupFolderFailed);
      }
    });
  const restore = (copy: BackupMeta) =>
    act(async () => {
      try {
        await app.flushPending();
        await backups.restore(copy.id);
        location.reload();
      } catch (error) {
        setAsking(null);
        setStatus(
          error === "newer_backup_schema"
            ? t.restoreProblem.newer
            : t.restoreFailed,
        );
      }
    });

  const newest = copies[0];
  return (
    <>
      <h2>{t.backups}</h2>
      <ul data-part="backups">
        <li data-setting="backup-folder">
          <span>{t.backupFolder}</span>{" "}
          <span data-part="backup-value">
            <output title={folder}>
              <span>{folder}</span>
            </output>
            <button
              type="button"
              data-action="backup-folder"
              disabled={busy}
              onClick={() => void choose()}
            >
              {t.backupFolderChange}
            </button>
          </span>
        </li>
        <li data-setting="backup-last">
          <span>{t.backupLast}</span>{" "}
          <span data-part="backup-value">
            <output>{newest ? when(newest) : t.backupNone}</output>
            <button
              type="button"
              data-action="backup-now"
              disabled={busy}
              onClick={() => void copyNow()}
            >
              {error ? t.backupRetry : t.backupNow}
            </button>
          </span>
        </li>
        {copies.map((copy) => (
          <li key={copy.id} data-backup={copy.id}>
            <span>{when(copy)}</span>{" "}
            <button
              type="button"
              data-action="backup-restore-copy"
              disabled={busy}
              onClick={() => setAsking(copy)}
            >
              {t.backupRestore}
            </button>
          </li>
        ))}
      </ul>
      {asking && (
        <p data-part="backup-confirm">
          {t.backupConfirm(when(asking))}{" "}
          <button
            type="button"
            data-action="backup-confirm"
            disabled={busy}
            onClick={() => void restore(asking)}
          >
            {t.backupRestore}
          </button>{" "}
          <button
            type="button"
            data-action="backup-cancel"
            disabled={busy}
            onClick={() => setAsking(null)}
          >
            {t.backupCancel}
          </button>
        </p>
      )}
      <p
        data-part="data-result"
        data-kind={error ? "error" : undefined}
        role="status"
      >
        {error ? t.backupError(error) : status}
      </p>
    </>
  );
}
