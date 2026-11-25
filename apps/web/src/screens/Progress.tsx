import {
  type EventId,
  eventInfo,
  formatAverage,
  formatMoves,
  formatMultiValue,
  formatTime,
} from "@cubehaus/core";
import { type SplitStanding, splitSummary } from "@cubehaus/stats";
import type { ColourSeries, ProgressScope } from "@cubehaus/storage";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { AppView } from "../app-state";
import { localDayKey } from "../day";
import { DbFailure } from "../db/DbFailure";
import { isTouchPhone, watchTouchPhone } from "../input/touch-screen";
import { actionKey } from "../keys/keymap";
import {
  formatProgressDifference,
  type ProgressStat,
  progressEvents,
} from "../progress-data";
import {
  progressMemoryKey,
  recallProgress,
  rememberProgress,
} from "../progress-memory";
import { createProgressReader, type ProgressModel } from "../progress-worker";
import type { Text } from "../text";
import { ProgressColours } from "./ProgressColours";
import { ProgressDistribution } from "./ProgressDistribution";
import { ProgressPractice } from "./ProgressPractice";
import { ProgressTarget } from "./ProgressTarget";
import { ProgressTrend } from "./ProgressTrend";
import "../design/progress.css";

const revisions = new WeakMap<AppView, number>();
let latestRevision = 0;

function revisionFor(view: AppView): number {
  const previous = revisions.get(view);
  if (previous !== undefined) return previous;
  revisions.set(view, ++latestRevision);
  return latestRevision;
}

function sampleWidth() {
  const viewport = document.documentElement.clientWidth;
  return Math.max(1, Math.min(960, viewport) - (viewport < 700 ? 32 : 48) - 52);
}

/** A phone's views of Progress, one on screen at a time. */
type PhoneView = "trend" | "bests" | "days" | "spread";

export function Progress({
  view,
  dbMessage,
  words: text,
}: {
  view: AppView;
  dbMessage: string | null;
  words: Text;
}) {
  const labels = text.progress;
  // Opens on what was looked at last on this device, while it still exists.
  const [recalled] = useState(() => {
    let text: string | null = null;
    try {
      text = localStorage.getItem(progressMemoryKey);
    } catch {}
    return recallProgress(text, view.sessions, view.folders);
  });
  const [selection, setSelection] = useState(recalled?.selection ?? "");
  const [mode, setMode] = useState<ProgressScope["kind"]>(
    recalled?.mode ?? "session",
  );
  const [folderId, setFolderId] = useState(recalled?.folderId ?? "");
  const [eventOverride, setEventOverride] = useState<EventId | undefined>(
    recalled?.event,
  );
  const [included, setIncluded] = useState<readonly string[] | undefined>(
    recalled?.included,
  );
  const [stat, setStat] = useState<ProgressStat | null>(null);
  const [phoneView, setPhoneView] = useState<PhoneView>("trend");
  const [width, setWidth] = useState(sampleWidth);
  const [now] = useState(Date.now);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [counts, setCounts] = useState<{
    revision: number;
    values: Record<string, number>;
  }>();
  const [loaded, setLoaded] = useState<{
    request: object;
    model: ProgressModel | null;
  }>();

  const db = view.dbState;
  const reader = useMemo(() => {
    if (db?.kind !== "memory" && db?.kind !== "persistent") return undefined;
    return db.progress ?? createProgressReader(db.store);
  }, [db]);
  const settingStore =
    db?.kind === "memory" || db?.kind === "persistent"
      ? db.store.settings
      : undefined;
  const revision = revisionFor(view);
  const selected =
    view.sessions.find((session) => session.id === selection) ??
    view.sessions.find((session) => session.id === view.current?.id) ??
    view.sessions[0];
  const activeFolder =
    view.folders.find((folder) => folder.id === folderId) ??
    view.folders.find((folder) => folder.id === selected?.folderId) ??
    view.folders[0];
  const eligible =
    mode === "folder"
      ? view.sessions.filter((session) => session.folderId === activeFolder?.id)
      : view.sessions;
  const puzzles = [...new Set(eligible.map((session) => session.event))];
  const event =
    mode === "session"
      ? selected?.event
      : ((eventOverride && puzzles.includes(eventOverride)
          ? eventOverride
          : undefined) ??
        (selected && puzzles.includes(selected.event)
          ? selected.event
          : undefined) ??
        puzzles[0]);
  const scope = useMemo<ProgressScope | null>(() => {
    if (!event || !selected) return null;
    if (mode === "folder" && activeFolder)
      return { kind: "folder", id: activeFolder.id, event };
    if (mode === "selection")
      return {
        kind: "selection",
        event,
        ids: included ?? (selected.event === event ? [selected.id] : []),
      };
    return { kind: "session", id: selected.id, event };
  }, [activeFolder, event, included, mode, selected]);
  // What is on show, as it resolved (the session and folder actually used), for next time.
  const shownSession = selected?.id ?? "";
  const shownFolder = activeFolder?.id ?? "";
  useEffect(() => {
    try {
      localStorage.setItem(
        progressMemoryKey,
        rememberProgress({
          mode,
          selection: shownSession,
          folderId: shownFolder,
          event: mode === "session" ? undefined : event,
          included,
        }),
      );
    } catch {}
  }, [mode, shownSession, shownFolder, event, included]);
  const request = useMemo(
    () => ({ scope, revision, stat, width, timeZone, now }),
    [scope, revision, stat, width, timeZone, now],
  );

  // Ask the worker during render, not after the first paint: unmounting the
  // timer's file takes a few hundred milliseconds before effects run. The
  // chart's read goes first, the per-session counts after it.
  const pendingModel = useMemo(() => {
    if (!reader || !request.scope) return undefined;
    const pending = reader.readProgress(request.scope, request);
    pending.catch(() => {});
    return pending;
  }, [reader, request]);
  const pendingCounts = useMemo(() => {
    const pending = reader?.counts(revision);
    pending?.catch(() => {});
    return pending;
  }, [reader, revision]);
  useEffect(() => {
    if (!pendingCounts) return;
    let stale = false;
    void pendingCounts.then(
      (values) => {
        if (!stale) setCounts({ revision, values });
      },
      () => {
        if (!stale) setCounts({ revision, values: {} });
      },
    );
    return () => {
      stale = true;
    };
  }, [pendingCounts, revision]);
  useEffect(() => {
    if (!pendingModel) return;
    let stale = false;
    void pendingModel.then(
      (model) => {
        if (!stale) setLoaded({ request, model });
      },
      () => {
        if (!stale) setLoaded({ request, model: null });
      },
    );
    return () => {
      stale = true;
    };
  }, [pendingModel, request]);

  useEffect(() => {
    function resize() {
      setWidth(sampleWidth());
    }
    function close(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        !actionKey(view.keymap, "progress.close", event)
      )
        return;
      event.preventDefault();
      location.hash = "#/";
    }
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", close);
    };
  }, [view.keymap]);

  // 3×3 by cross colour: only the solves that were assigned one (none: nothing shown).
  const store =
    db?.kind === "memory" || db?.kind === "persistent" ? db.store : undefined;
  const [colours, setColours] = useState<{
    request: object;
    series: ColourSeries;
  }>();
  useEffect(() => {
    if (!store || !request.scope || request.scope.event !== "333") return;
    let stale = false;
    void store.solves.colourSeries(request.scope).then(
      (series) => {
        if (!stale) setColours({ request, series });
      },
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [store, request]);
  const colourSeries =
    colours?.request === request && colours.series.colours.length > 0
      ? colours.series
      : null;

  const splitSession = scope?.kind === "session" ? scope.id : undefined;
  const splitRequest = useMemo(
    () => ({ sessionId: splitSession, revision }),
    [splitSession, revision],
  );
  const [loadedSplits, setLoadedSplits] = useState<{
    request: typeof splitRequest;
    parts: SplitStanding[];
  }>();
  useEffect(() => {
    if (!store || !splitRequest.sessionId) return;
    let stale = false;
    void store.solves.splitSeries(splitRequest.sessionId).then(
      (series) => {
        if (!stale)
          setLoadedSplits({
            request: splitRequest,
            parts: splitSummary(series),
          });
      },
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [store, splitRequest]);
  const parts =
    loadedSplits?.request === splitRequest ? loadedSplits.parts : undefined;
  const precision = view.settings.precision;
  const result = loaded?.request === request ? loaded : undefined;
  const details = result?.model;
  const modelKey = details?.key;
  const getPoint = useCallback(
    (index: number) =>
      reader && modelKey
        ? reader.point(modelKey, index)
        : Promise.resolve(null),
    [reader, modelKey],
  );
  const getDistribution = useCallback(
    () =>
      reader && modelKey
        ? reader.distribution(modelKey)
        : Promise.resolve(null),
    [reader, modelKey],
  );
  const sessions =
    counts?.revision === revision
      ? progressEvents(
          view.sessions.map((session) => ({
            session,
            count: counts.values[session.id] ?? 0,
          })),
          selected?.id,
        )
      : null;
  const { numbers, dates } = useMemo(
    () => ({
      numbers: new Intl.NumberFormat(text.locale),
      dates: new Intl.DateTimeFormat(text.locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone,
      }),
    }),
    [text.locale, timeZone],
  );

  const kind = event ? eventInfo(event).kind : "time";
  const current = details?.trend;
  const average = (value: number) =>
    kind === "moves"
      ? formatMoves(value, { mean: true })
      : formatAverage(value);
  const single =
    kind === "multi"
      ? formatMultiValue
      : kind === "moves"
        ? formatMoves
        : formatTime;

  // A phone shows one view at a time, picked from a row of words under the scope.
  const phone = useSyncExternalStore(watchTouchPhone, isTouchPhone);
  const views: PhoneView[] = details
    ? [
        ...(current || kind !== "multi" ? (["trend"] as const) : []),
        ...(details.records.length > 0 || colourSeries
          ? (["bests"] as const)
          : []),
        "days",
        ...(kind !== "multi" ? (["spread"] as const) : []),
      ]
    : [];
  const shown: PhoneView | null = phone
    ? views.includes(phoneView)
      ? phoneView
      : (views[0] ?? null)
    : null;
  const shows = (each: PhoneView) => shown === null || shown === each;

  return (
    <main data-no-timer data-part="progress" data-view={shown ?? undefined}>
      <nav>
        <a href="#/">{text.backToTimer}</a>
      </nav>
      <h1>{labels.title}</h1>
      {db?.kind === "failed" && <DbFailure state={db} words={text} />}
      {db?.kind !== "persistent" && db?.kind !== "failed" && (
        <p data-part="db-state" data-kind={db?.kind ?? "opening"}>
          {dbMessage}
        </p>
      )}
      <p data-heard role="status">
        {!db || (reader && !result) ? labels.loading : ""}
      </p>
      {(!db || (reader && !result)) && (
        <p data-part="progress-loading">{labels.loading}</p>
      )}
      {result?.model === null && <p role="alert">{labels.failed}</p>}
      {sessions && (
        <nav data-part="progress-events" aria-label={labels.solves}>
          {sessions.map(({ session, count }) => (
            <button
              key={session.id}
              type="button"
              data-part="progress-event"
              data-session-id={session.id}
              aria-pressed={session.id === selected?.id && mode === "session"}
              // The bare count is read with its unit: "3×3, 60 solves".
              aria-label={
                count > 0
                  ? `${session.name}, ${labels.solveCount(count)}`
                  : undefined
              }
              onClick={() => {
                setSelection(session.id);
                setMode("session");
                setEventOverride(undefined);
                setIncluded(undefined);
              }}
            >
              <span data-part="progress-event-name">{session.name}</span>{" "}
              {count > 0 && (
                <data data-part="progress-event-count" value={count}>
                  {numbers.format(count)}
                </data>
              )}
            </button>
          ))}
        </nav>
      )}
      {sessions &&
        selected &&
        (sessions.length > 1 ||
          (counts?.values[selected.id] ?? 0) >= 3 ||
          view.folders.length > 0) && (
          <details data-part="progress-scope">
            <summary>{labels.scope.options}</summary>
            <div>
              <label>
                {labels.scope.scope}{" "}
                <select
                  data-action="progress-scope"
                  value={mode}
                  onChange={(input) => {
                    const next = input.currentTarget.value;
                    if (
                      next !== "session" &&
                      next !== "folder" &&
                      next !== "selection"
                    )
                      return;
                    setMode(next);
                    setIncluded(undefined);
                    setEventOverride(undefined);
                  }}
                >
                  <option value="session">{labels.scope.session}</option>
                  <option value="folder" disabled={!view.folders.length}>
                    {labels.scope.folder}
                  </option>
                  <option value="selection">{labels.scope.selection}</option>
                </select>
              </label>
              {mode === "folder" && activeFolder && (
                <label>
                  {labels.scope.folder}{" "}
                  <select
                    data-action="progress-folder"
                    value={activeFolder.id}
                    onChange={(input) => {
                      setFolderId(input.currentTarget.value);
                      setEventOverride(undefined);
                    }}
                  >
                    {view.folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {mode !== "session" && event && (
                <label>
                  {labels.scope.puzzle}{" "}
                  <select
                    data-action="progress-puzzle"
                    value={event}
                    onChange={(input) => {
                      const next = puzzles.find(
                        (item) => item === input.currentTarget.value,
                      );
                      setEventOverride(next);
                      setIncluded(undefined);
                      setStat(null);
                    }}
                  >
                    {puzzles.map((id) => (
                      <option key={id} value={id}>
                        {eventInfo(id).label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {mode === "selection" &&
                scope?.kind === "selection" &&
                eligible
                  .filter((session) => session.event === event)
                  .map((session) => {
                    const checked = scope.ids.includes(session.id);
                    return (
                      <label key={session.id}>
                        <input
                          type="checkbox"
                          data-session-id={session.id}
                          checked={checked}
                          onChange={() =>
                            setIncluded(
                              checked
                                ? scope.ids.filter((id) => id !== session.id)
                                : [...scope.ids, session.id],
                            )
                          }
                        />
                        {session.name}
                      </label>
                    );
                  })}
              {kind === "time" && (
                <label>
                  {labels.scope.average}{" "}
                  <select
                    data-action="progress-stat"
                    value={current?.name === stat ? (stat ?? "") : ""}
                    onChange={(input) => {
                      const choice = input.currentTarget.value;
                      setStat(
                        choice === "ao5" ||
                          choice === "ao12" ||
                          choice === "ao100"
                          ? choice
                          : null,
                      );
                    }}
                  >
                    <option value="">{labels.scope.auto}</option>
                    <option
                      value="ao5"
                      disabled={details?.current.ao5 === undefined}
                    >
                      ao5
                    </option>
                    <option
                      value="ao12"
                      disabled={details?.current.ao12 === undefined}
                    >
                      ao12
                    </option>
                    <option
                      value="ao100"
                      disabled={details?.current.ao100 === undefined}
                    >
                      ao100
                    </option>
                  </select>
                </label>
              )}
            </div>
          </details>
        )}
      {details && details.count > 0 && mode !== "session" && (
        <p data-part="progress-scope-count">
          {labels.scope.count(details.count)}
        </p>
      )}
      {details?.count === 0 && <p data-part="progress-empty">{labels.none}</p>}
      {details && details.count > 0 && (
        <>
          {phone && views.length > 1 && (
            <nav data-part="progress-views" aria-label={labels.title}>
              {views.map((each) => (
                <button
                  key={each}
                  type="button"
                  data-view={each}
                  aria-pressed={each === shown}
                  onClick={() => setPhoneView(each)}
                >
                  {each === "spread" ? labels.distribution : labels.views[each]}
                </button>
              ))}
            </nav>
          )}
          {!shows("trend") ? null : current ? (
            <div data-part="progress-now">
              <span data-part="progress-average-name">
                {text[current.name]}
              </span>{" "}
              <data data-part="progress-average" value={current.value}>
                {average(current.value)}
              </data>
              <dl data-part="progress-deltas">
                {current.comparisons.map(({ key, delta }) => {
                  const { sign, label } = formatProgressDifference(delta, kind);
                  return (
                    <div key={key} data-key={key} data-sign={sign}>
                      <dt>{labels.since[key]}</dt>
                      <dd>{label}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          ) : (
            kind !== "multi" && (
              <p data-part="progress-needs">
                {labels.needs(kind === "moves" ? 3 : 5)}
              </p>
            )
          )}
          {shows("trend") && current?.record && (
            <ProgressTrend
              keymap={view.keymap}
              key={details.key}
              name={text[current.name]}
              series={details.series}
              trend={current}
              count={details.count}
              moves={kind === "moves"}
              getPoint={getPoint}
              dates={dates}
              numbers={numbers}
              labels={labels}
            />
          )}
          {shows("trend") && !!parts?.length && (
            <table data-part="progress-splits" aria-label={text.splits.title}>
              <thead>
                <tr>
                  <th scope="col">{text.splits.title}</th>
                  <th scope="col">{text.mean}</th>
                  <th scope="col">{text.ao12}</th>
                  <th scope="col">{text.best}</th>
                </tr>
              </thead>
              <tbody>
                {parts.map((part) => (
                  <tr key={part.key}>
                    <th scope="row">{part.name}</th>
                    <td>{formatAverage(part.mean, { precision })}</td>
                    <td>{formatAverage(part.ao12, { precision }) || "–"}</td>
                    <td>{formatTime(part.best, { precision })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {shows("bests") && details.records.length > 0 && (
            <dl data-part="progress-pbs">
              {details.records.map(({ name, value, at }) => (
                <div key={name} data-name={name}>
                  <dt>{name === "single" ? labels.single : text[name]}</dt>
                  <dd>
                    <data value={value}>
                      {name === "single" ? single(value) : average(value)}
                    </data>{" "}
                    <time dateTime={localDayKey(at, timeZone)}>
                      {dates.format(at)}
                    </time>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {shows("bests") && colourSeries && (
            <ProgressColours series={colourSeries} words={text} />
          )}
          {shows("days") && (
            <ProgressPractice
              days={details.days}
              run={details.practice.longestRun?.days ?? 0}
              today={details.today}
              locale={text.locale}
              numbers={numbers}
              dates={dates}
              labels={labels}
              totals={details.totals}
              mean={kind === "multi" ? null : average}
            />
          )}
          {shows("spread") && kind !== "multi" && (
            <ProgressDistribution
              opened={shown === "spread"}
              key={`${details.key}-${shown}`}
              load={getDistribution}
              format={kind === "moves" ? formatMoves : formatTime}
              numbers={numbers}
              labels={labels}
            />
          )}
          {shows("trend") && kind === "time" && settingStore && (
            <ProgressTarget
              event={details.event}
              recent={details.recent}
              today={details.today}
              settings={settingStore}
              dates={dates}
              labels={labels.target}
            />
          )}
        </>
      )}
    </main>
  );
}
