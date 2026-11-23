import {
  type EventId,
  eventInfo,
  hasTimePenalty,
  type Solve,
} from "@cubehaus/core";
import { createScrambleSource } from "@cubehaus/scramble";
import { cubingGenerate } from "@cubehaus/scramble/cubing";
import { parseStat, type StatId } from "@cubehaus/stats";
import {
  lazy,
  Suspense,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type AppState, type AppView, createAppState } from "./app-state";
import { backupFileName, download } from "./backup-file";
import { backupDue } from "./db/native";
import { openDatabase } from "./db/open";
import { createPendingJournal, memoryStorage } from "./db/pending";
import { canFullscreen, toggleFullscreen } from "./fullscreen";
import { actionsForEvent, bindActions } from "./keys/actions";
import type { Action } from "./keys/engine";
import { Help } from "./keys/Help";
import { actionKey, keysFor, resolveBindings } from "./keys/keymap";
import { isMacPlatform, keyLabel } from "./keys/label";
import { Palette } from "./keys/Palette";
import { createScrambleHistory } from "./scramble/history";
import { reducedMotion, type ZoomState } from "./scramble/PictureZoom";
import { pictureSupport } from "./scramble/picture";
import {
  createTrainingClient,
  drillName,
  heldScramble,
  type TrainingProfile,
  trainingReady,
  type WorkerLike,
} from "./scramble/training-client";
import { AverageDetail } from "./screens/AverageDetail";
import { Entry } from "./screens/Entry";
import { SessionSwitch } from "./screens/SessionSwitch";
import { Sessions } from "./screens/Sessions";
import { Settings } from "./screens/Settings";
import { SolveList } from "./screens/SolveList";
import { Timer } from "./screens/Timer";
import { listed } from "./session-order";
import { selectedSlots } from "./session-stats";
import type { LoadedSeed } from "./testing/load";
import { textFor } from "./text";
import {
  readCustomMirror,
  readThemeMirror,
  showThemeImage,
  watchTheme,
} from "./theme";
import { runUpdates } from "./updates";
import { useTimer } from "./useTimer";
import {
  DEFAULT_SIZES,
  partOf,
  sizeTarget,
  stepSize,
  VIEW_PARTS,
  type ViewSizes,
} from "./view-size";
import { keepAwake, type WakeLockHost } from "./wake-lock";
import "./input/behavior.css";

const Training = lazy(() =>
  import("./scramble/Training").then(({ Training }) => ({ default: Training })),
);
const loadTrain = () => import("./screens/Train");
const Train = lazy(() => loadTrain().then(({ Train }) => ({ default: Train })));
const Progress = lazy(() =>
  import("./screens/Progress").then(({ Progress }) => ({ default: Progress })),
);

export function App({
  seed: fixture,
  applyUpdate,
}: {
  seed?: LoadedSeed | undefined;
  applyUpdate?: (() => void) | undefined;
} = {}) {
  const seed = import.meta.env.VITE_TEST_HOOKS === "1" ? fixture : undefined;
  const [initialTheme] = useState(readThemeMirror);
  const [snapshot, setSnapshot] = useState<AppView>();
  const [{ app, journal }] = useState(() => {
    // Accessing localStorage itself can throw in restricted contexts.
    const fixtureStorage = seed ? memoryStorage() : undefined;
    const journal = createPendingJournal({
      get length() {
        return (fixtureStorage ?? window.localStorage).length;
      },
      key: (index) => (fixtureStorage ?? window.localStorage).key(index),
      getItem: (key) => (fixtureStorage ?? window.localStorage).getItem(key),
      setItem: (key, value) =>
        (fixtureStorage ?? window.localStorage).setItem(key, value),
      removeItem: (key) =>
        (fixtureStorage ?? window.localStorage).removeItem(key),
    });
    return { app: createAppState(journal, setSnapshot), journal };
  });
  const [initialView] = useState(() => app.view);
  const baseView = snapshot ?? initialView;
  const view =
    seed && !baseView.current
      ? { ...baseView, settings: seed.settings }
      : baseView;
  useEffect(() => {
    let active = true;
    async function open() {
      if (seed) {
        const state = await seed.open();
        if (active) await app.open(state);
        return;
      }
      const { initial, ready } = openDatabase({ journal });
      const state = await initial;
      if (active) await app.open(state);
      if (state.kind === "busy") {
        const settled = await ready;
        if (active) await app.open(settled);
      }
    }
    void open().catch((error: unknown) => {
      if (active) return app.open({ kind: "failed", reason: String(error) });
    });
    return () => {
      active = false;
    };
  }, [app, journal, seed]);

  // The trash empties what is 30 days old a while after the history opens, never on the
  // way to the first paint; a failure leaves it for the next start.
  const stored =
    view.dbState?.kind === "persistent" || view.dbState?.kind === "memory";
  useEffect(() => {
    if (!stored) return;
    const timer = setTimeout(() => {
      void app.expireTrash().catch(() => {});
    }, 4000);
    return () => clearTimeout(timer);
  }, [app, stored]);

  // Desktop: the day's automatic copy, at the first idle moment after the history opens
  // (and each hour, as the day may turn) once it has changed since the newest copy. The
  // copy runs on a native thread; nothing here waits for it.
  const backups =
    view.dbState?.kind === "persistent" ? view.dbState.backups : undefined;
  useEffect(() => {
    if (!backups) return;
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        const [copies, changed] = await Promise.all([
          backups.list(),
          backups.lastChange(),
        ]);
        if (backupDue(copies[0]?.createdAt ?? null, changed, Date.now()))
          await backups.now();
      } finally {
        busy = false;
      }
    };
    const idle = () => {
      const go = () => void check().catch(() => {});
      if ("requestIdleCallback" in window)
        window.requestIdleCallback(go, { timeout: 10_000 });
      else go();
    };
    const first = setTimeout(idle, 10_000);
    const hourly = setInterval(idle, 3_600_000);
    return () => {
      clearTimeout(first);
      clearInterval(hourly);
    };
  }, [backups]);

  // The first-paint mirror stays in force until device settings are available.
  const theme = snapshot?.current || seed ? view.settings.theme : initialTheme;
  const mirrorTheme = !seed && snapshot?.current != null;
  // A custom theme's colours: the stored theme once loaded, the first paint's until then.
  const customColours = useMemo(
    () =>
      view.customTheme
        ? { base: view.customTheme.base, tokens: view.customTheme.tokens }
        : theme === "custom"
          ? readCustomMirror()
          : null,
    [view.customTheme, theme],
  );
  useLayoutEffect(
    () => watchTheme(theme, mirrorTheme, customColours),
    [theme, mirrorTheme, customColours],
  );
  const themeImage =
    theme === "custom" ? (view.customTheme?.image ?? null) : null;
  useEffect(() => showThemeImage(themeImage), [themeImage]);
  const language = view.settings.language;
  useLayoutEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const [route, setRoute] = useState(() => location.hash);
  useEffect(() => {
    // Onto another screen, a transition: the one in view stays until the next is ready
    // (its code may still be loading), so no blank frame stands between them. Within a
    // screen the change is at once, so a key that follows it lands on what it shows.
    let shown = location.hash;
    const update = () => {
      const next = location.hash;
      const same = screenOf(shown) === screenOf(next);
      shown = next;
      if (same) setRoute(next);
      else startTransition(() => setRoute(next));
    };
    window.addEventListener("hashchange", update);
    update();
    return () => window.removeEventListener("hashchange", update);
  }, []);

  const dbKind = view.dbState?.kind;
  const words = textFor(view.settings.language);
  const dbMessage =
    view.dbState?.kind === "persistent" &&
    view.dbState.handoff === "needs-recovery"
      ? words.dbEarlier
      : dbKind === "memory"
        ? words.dbMemory
        : dbKind === "busy"
          ? words.dbBusy
          : dbKind === "failed"
            ? words.dbFailed
            : null;

  // One boundary for every screen, so a transition keeps the shown one in place.
  return <Suspense fallback={null}>{screen()}</Suspense>;
  function screen() {
    if (route === "#/progress")
      return <Progress view={view} dbMessage={dbMessage} words={words} />;
    if (route === "#/train" || route.startsWith("#/train/"))
      return <Train app={app} view={view} words={words} route={route} />;
    if (route === "#/settings")
      return <Settings app={app} view={view} words={words} />;
    return (
      <TimerPage
        app={app}
        view={view}
        dbMessage={dbMessage}
        seed={seed}
        openCommands={route === "#/commands"}
        openDrills={route === "#/drills"}
        applyUpdate={applyUpdate}
      />
    );
  }
}

/** Which screen a route shows. */
function screenOf(route: string) {
  if (route === "#/train" || route.startsWith("#/train/")) return "train";
  if (route === "#/progress" || route === "#/settings") return route;
  return "timer";
}

/** An xcross slot by the faces it sits between, as cubers write it: FR, BL, UF. */
function slotName(faces: readonly string[]): string {
  const order = "UDFBRL";
  return [...faces]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .join("");
}

/** Saves pending solves as a JSON file the person can keep (DESIGN.md: never lose a solve). */
function downloadSolves(solves: readonly Solve[]) {
  download(
    backupFileName().replace("backup", "unsaved"),
    JSON.stringify({ format: "cubehaus-pending", version: 1, solves }, null, 2),
  );
}

function TimerPage({
  app,
  view,
  dbMessage,
  seed: fixture,
  openCommands,
  openDrills,
  applyUpdate,
}: {
  app: AppState;
  view: AppView;
  dbMessage: string | null;
  seed: LoadedSeed | undefined;
  openCommands: boolean;
  openDrills: boolean;
  applyUpdate: (() => void) | undefined;
}) {
  const seed = import.meta.env.VITE_TEST_HOOKS === "1" ? fixture : undefined;
  const dbKind = view.dbState?.kind;
  const event = view.current?.event ?? "333";
  const session = view.current;
  const sessionId = session?.id;
  const kind = eventInfo(event).kind;
  const isMulti = kind === "multi";
  const entry = kind !== "time" || view.settings.entry === "typing";
  const words = textFor(view.settings.language);
  const [multiConfig, setMultiConfig] = useState<{
    sessionId: string;
    count: number;
  }>();
  const cubes =
    isMulti && multiConfig?.sessionId === sessionId
      ? (multiConfig?.count ?? 2)
      : seed?.state === "mbld"
        ? 3
        : 2;
  const [timedMulti, setTimedMulti] = useState<Solve | null>(null);
  const [fixed] = useState(() =>
    import.meta.env.VITE_TEST_HOOKS === "1"
      ? new URLSearchParams(location.search).get("test-scramble")
      : null,
  );
  const [source] = useState(() =>
    createScrambleSource((event) =>
      fixed && event === "333" ? Promise.resolve(fixed) : cubingGenerate(event),
    ),
  );
  const [prepared, setPrepared] = useState<{
    event: EventId;
    group: string;
    value: string | null;
    pending: boolean;
  }>();
  // Drill scrambles and cross solutions come from workers started on first use; one
  // sequence numbers every request, so a late answer for an older one is dropped.
  const [trainer] = useState(() =>
    createTrainingClient(
      () =>
        new Worker(new URL("./scramble/training-worker.ts", import.meta.url), {
          type: "module",
        }) as unknown as WorkerLike,
    ),
  );
  useEffect(() => () => trainer.close(), [trainer]);
  const trainerSequence = useRef(0);
  // A drill is a 3×3 session's choice; every other puzzle keeps official scrambles.
  const profile: TrainingProfile =
    event === "333" ? view.settings.training : { request: null };
  const drill = profile.request;
  const drillBlocked = !trainingReady(profile);
  const group = isMulti ? `${sessionId}:${cubes}` : "";
  // The drill is part of the key: each keeps its own scrambles, and one asked for under
  // another drill never shows under this one.
  const historyKey = JSON.stringify([
    event,
    isMulti ? cubes : null,
    drill ? JSON.stringify(drill) : null,
    view.settings.holding,
  ]);
  const currentKey = useRef(historyKey);
  currentKey.current = historyKey;
  // ← and → go back and forward through the scrambles of this puzzle (and Multi count).
  const [history] = useState(() =>
    createScrambleHistory(async (key) => {
      const [event, cubes, drill, holding] = JSON.parse(key) as [
        EventId,
        number | null,
        string | null,
        string,
      ];
      if (drill) {
        if (fixed) return fixed;
        const request = JSON.parse(drill) as TrainingProfile["request"];
        // Superseded by a newer request: asked again while this drill is still on screen.
        while (currentKey.current === key) {
          const made = await trainer.requestTraining(
            { request } as TrainingProfile,
            ++trainerSequence.current,
          );
          if (made) return heldScramble(request, made.scramble, holding);
        }
        throw new Error("The drill changed");
      }
      return cubes === null || cubes === 2
        ? source.next(event)
        : cubingGenerate(event, { cubes });
    }),
  );
  const request = useRef(0);
  const failNext = useRef(seed?.state === "scramble-failed");
  const awaitingSeed = seed && dbKind === undefined;
  /** Shows the scramble before or after this one; false when there is none before. */
  const stepScramble = useCallback(
    (direction: -1 | 1): boolean => {
      history.reset(historyKey);
      if (direction === -1 && !history.canStepBack()) return false;
      const id = ++request.current;
      if (direction === 1 && failNext.current) {
        failNext.current = false;
        setPrepared({ event, group, value: null, pending: false });
        return true;
      }
      // A step within the kept scrambles is ready at once; a new one shows the wait.
      if (direction === 1 && !history.hasNext())
        setPrepared({ event, group, value: null, pending: true });
      void history.step(direction).then(
        (value) => {
          if (id === request.current && value !== null)
            setPrepared({ event, group, value, pending: false });
        },
        () => {
          if (id === request.current)
            setPrepared({ event, group, value: null, pending: false });
        },
      );
      return true;
    },
    [history, historyKey, event, group],
  );
  const nextScramble = useCallback(() => {
    stepScramble(1);
  }, [stepScramble]);

  // A puzzle opened again shows the scramble it was waiting on; a new one makes its first.
  useEffect(() => {
    if (awaitingSeed || drillBlocked) return;
    history.reset(historyKey);
    const waiting = history.current();
    if (waiting !== null && !failNext.current) {
      request.current++;
      setPrepared({ event, group, value: waiting, pending: false });
    } else stepScramble(1);
    return () => {
      request.current++;
    };
  }, [
    awaitingSeed,
    drillBlocked,
    history,
    historyKey,
    event,
    group,
    stepScramble,
  ]);

  const [recent, setRecent] = useState<Solve | null>(null);
  // The scramble timed again (R), read when a solve lands, not when the timer started.
  const repeatRoot = useRef<Solve | null>(null);
  repeatRoot.current = view.repeat?.root ?? null;
  const save = useCallback(
    (timed: Solve) => {
      const root = repeatRoot.current;
      // An attempt on the repeated scramble is saved as its repeat; the scramble stays.
      const solve =
        root &&
        timed.repeatOf === undefined &&
        timed.scramble === root.scramble &&
        timed.sessionId === root.sessionId
          ? { ...timed, repeatOf: root.id }
          : timed;
      if (solve.event === "333mbf") setTimedMulti(null);
      setRecent(solve);
      void app
        .add(solve)
        .then(() => setRecent((item) => (item?.id === solve.id ? null : item)));
      if (solve.repeatOf !== undefined) return;
      if (event === solve.event && (!entry || sessionId === solve.sessionId))
        nextScramble();
    },
    [app, entry, event, nextScramble, sessionId],
  );

  const currentScramble =
    prepared?.event === event && prepared.group === group
      ? prepared
      : undefined;
  // A drill with no case picked has no scramble, so the timer cannot start.
  const scramble = drillBlocked ? null : (currentScramble?.value ?? null);
  const pending = drillBlocked ? false : (currentScramble?.pending ?? true);
  const measuredMs =
    timedMulti?.sessionId === sessionId && timedMulti?.scramble === scramble
      ? timedMulti?.timeMs
      : undefined;
  const onTimedSolve = useCallback(
    (solve: Solve) => {
      if (solve.event === "333mbf") {
        if (solve.sessionId === sessionId && solve.scramble === scramble)
          setTimedMulti(solve);
      } else {
        save(solve);
      }
    },
    [save, scramble, sessionId],
  );
  const timerEnabled =
    !drillBlocked &&
    (!entry || (isMulti && scramble !== null && measuredMs === undefined));
  const [modal, setModal] = useState<
    "palette" | "help" | "switch" | "average" | "drills" | null
  >(
    openCommands || seed?.state === "palette"
      ? "palette"
      : openDrills ||
          seed?.state === "drills" ||
          seed?.state === "drills-oll" ||
          seed?.state === "drills-white"
        ? "drills"
        : seed?.state === "keys"
          ? "help"
          : seed?.state.startsWith("switch") || seed?.state === "move"
            ? "switch"
            : null,
  );
  const [renameOnOpen, setRenameOnOpen] = useState(false);
  // The switch opened by M picks where solves go.
  const [moveOpen, setMoveOpen] = useState(seed?.state === "move");
  const timerPage = useRef<HTMLElement>(null);
  const dialogOpener = useRef<HTMLElement | null>(null);
  const [average, setAverage] = useState<{
    name: StatId;
    best: boolean;
    solve: Solve;
  } | null>(null);
  const openDialog = (
    next: "palette" | "help" | "switch" | "average" | "drills",
    opener?: HTMLElement,
  ) => {
    const focused = document.activeElement;
    dialogOpener.current =
      opener ??
      (focused instanceof HTMLElement && focused !== document.body
        ? focused
        : null);
    setModal(next);
  };
  // The status line's Move: the same sheet as M, focus back on the button after.
  const openMove = useCallback((opener: HTMLElement) => {
    dialogOpener.current = opener;
    setMoveOpen(true);
    setModal("switch");
  }, []);
  const closeDialog = () => {
    setModal(null);
    if (openCommands || openDrills) location.hash = "#/";
    setMoveOpen(false);
    setAverage(null);
    const opener = dialogOpener.current;
    dialogOpener.current = null;
    (opener?.isConnected ? opener : timerPage.current)?.focus({
      preventScroll: true,
    });
  };
  const [notice, setNotice] = useState<string | null>(null);
  const hoveredPart = useRef<ReturnType<typeof partOf>>(null);
  const pendingSizes = useRef<ViewSizes | null>(null);
  const shownSizes = view.settings.sizes;
  useEffect(() => {
    const pending = pendingSizes.current;
    if (
      pending &&
      VIEW_PARTS.every((part) => pending[part] === shownSizes[part])
    )
      pendingSizes.current = null;
  }, [shownSizes]);
  // The solve whose comment line is a field (C), by its row.
  const [commenting, setCommenting] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    reason: string;
    key: number;
  } | null>(null);
  useEffect(() => {
    if (!feedback) return;
    const timeout = setTimeout(() => setFeedback(null), 700);
    return () => clearTimeout(timeout);
  }, [feedback]);
  useEffect(() => {
    if (
      notice === null ||
      (seed?.state === "too-short" && notice === words.tooShort)
    )
      return;
    const timeout = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timeout);
  }, [notice, seed?.state, words.tooShort]);
  const actionsRef = useRef<readonly Action[]>([]);
  const [statPicker, setStatPicker] = useState(false);
  const pictureButton = useRef<HTMLButtonElement>(null);
  const [zoom, setZoom] = useState<ZoomState>(null);
  const closePictureNow = useCallback(() => setZoom(null), []);
  const closePicture = useCallback(() => {
    setZoom((current) =>
      current === "open" ? (reducedMotion() ? null : "closing") : current,
    );
  }, []);
  const { state, hands, displayMs, bindingsFor, cancel } = useTimer({
    scramble: view.repeat?.root.scramble ?? scramble,
    onSolve: onTimedSolve,
    onEffect: (effect) => {
      if (effect.type === "tooShort") setNotice(words.tooShort);
      else if (effect.type === "inspectionCancelled")
        setNotice(words.inspectionCancelled);
    },
    session,
    settings: view.settings,
    keymap: view.keymap,
    enabled: timerEnabled,
    modal: modal !== null || zoom !== null || statPicker,
    actions: () => actionsRef.current,
    seed: seed?.timer,
  });
  const inspecting =
    state.inspectionStartedAt !== null &&
    state.phase !== "running" &&
    state.phase !== "stopped";
  // A press that starts a solve brings back the newest: the live scramble is the one timed.
  // With inspection on, that is already the press its release will start inspection with.
  const settledPhase =
    !inspecting &&
    state.holdStartedAt === null &&
    (state.phase === "idle" || state.phase === "stopped");
  useEffect(() => {
    if (!settledPhase && view.browsing) void app.live();
  }, [settledPhase, view.browsing, app]);
  const editable = dbKind === "persistent" || dbKind === "memory";

  // Desktop: a signed newer release installs itself only while the timer is safe to leave
  // (settled, no inspection, nothing open, every solve written); off unless the build has
  // an updater key. Only a failure is said, once.
  const updates =
    view.dbState?.kind === "persistent" ? view.dbState.updates : undefined;
  const safeToLeave = useRef(false);
  safeToLeave.current =
    settledPhase &&
    modal === null &&
    zoom === null &&
    !statPicker &&
    commenting === null &&
    measuredMs === undefined;
  const updateFailed = words.updateFailed;
  useEffect(() => {
    if (!updates) return;
    return runUpdates(
      updates,
      async () => {
        if (!safeToLeave.current) return false;
        await app.flushPending();
        return safeToLeave.current && app.pendingSolves().length === 0;
      },
      () => setNotice(updateFailed),
    );
  }, [updates, app, updateFailed]);
  // Fixtures for the eyes: a past solve on show, or the comment field open.
  const seeded = useRef(false);
  const seedRows = view.rows.length;
  useEffect(() => {
    if (!seed || seeded.current || !editable || seedRows === 0) return;
    if (seed.state === "browsing") {
      seeded.current = true;
      void (async () => {
        for (let step = 0; step < 4; step++) await app.browse(-1);
      })();
    } else if (seed.state === "repeat" || seed.state === "repeat-long") {
      seeded.current = true;
      void (async () => {
        for (let step = 0; step < 3; step++) await app.browse(-1);
        await app.repeat();
      })();
    } else if (seed.state === "comment") {
      seeded.current = true;
      setCommenting(app.view.rows[0]?.solve.id ?? null);
    } else if (seed.state === "selection" || seed.state === "move") {
      // Three lines picked with Shift+↑ from the third newest.
      seeded.current = true;
      void (async () => {
        await app.browse(-1);
        await app.browse(-1);
        await app.extend(-1);
        await app.extend(-1);
      })();
    }
  }, [seed, editable, seedRows, app]);
  const pictureAvailable =
    dbKind !== undefined &&
    view.settings.picture &&
    scramble !== null &&
    pictureSupport(event) === "flat" &&
    state.phase !== "ready" &&
    state.phase !== "running";
  const pictureCanOpen =
    pictureAvailable &&
    modal === null &&
    !inspecting &&
    (state.phase === "idle" || state.phase === "stopped");

  // Today's count starts again at local midnight, and when the tab comes back.
  // The screen stays on while the app shows: a solve or a drill is not touched for a while.
  const awake = view.settings.awake;
  useEffect(
    () => (awake ? keepAwake(navigator as WakeLockHost, document) : undefined),
    [awake],
  );
  const showToday = view.settings.today;
  useEffect(() => {
    if (!showToday) return;
    let timeout: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timeout);
      const midnight = new Date().setHours(24, 0, 0, 0);
      timeout = setTimeout(
        () => {
          void app.refreshDay();
          schedule();
        },
        midnight - Date.now() + 1000,
      );
    };
    const visible = () => {
      if (document.visibilityState !== "visible") return;
      void app.refreshDay();
      schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [app, showToday]);
  const pictureEvent = useRef(event);
  useLayoutEffect(() => {
    if (!pictureAvailable || pictureEvent.current !== event) closePictureNow();
    pictureEvent.current = event;
  }, [pictureAvailable, event, closePictureNow]);
  useLayoutEffect(() => {
    const keydown = (key: KeyboardEvent) => {
      if (zoom === null || key.defaultPrevented || key.repeat) return;
      const hide = editable && actionKey(view.keymap, "zoom.hide", key);
      if (!hide && !actionKey(view.keymap, "zoom.close", key)) return;
      key.preventDefault();
      key.stopImmediatePropagation();
      if (hide) {
        closePictureNow();
        void app.setSetting("picture", false);
      } else closePicture();
    };
    const click = (input: MouseEvent) => {
      if (zoom === null) return;
      input.preventDefault();
      input.stopImmediatePropagation();
      closePicture();
    };
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("click", click, true);
    };
  }, [zoom, app, editable, view.keymap, closePicture, closePictureNow]);
  const newestSolve = view.rows[0]?.solve;
  // A past solve on show (↑ ↓, or picked in the file) takes every edit; else the newest.
  const shownSolve = view.shown?.solve;
  // R: the attempt on show takes the edits, and the timer its root's scramble.
  const repeat = view.repeat;
  const target = repeat?.shown ?? shownSolve ?? newestSolve;
  const openAverage = (
    name: StatId,
    best: boolean,
    opener: HTMLElement | null,
  ) => {
    if (!target || !editable || !settledPhase || !parseStat(name)) return;
    setAverage({ name, best, solve: target });
    openDialog("average", opener ?? undefined);
  };
  const shownScramble =
    repeat?.root.scramble ?? shownSolve?.scramble ?? scramble;
  const canStepScramble =
    settledPhase && zoom === null && measuredMs === undefined;
  // The cross (or xcross) of a cross drill, shown on request beside the live scramble.
  const solveKind =
    drill?.kind === "easy-xcross"
      ? "xcross"
      : drill?.kind === "easy-cross" || drill?.kind === "cross-solved"
        ? "cross"
        : null;
  const [solution, setSolution] = useState<{
    scramble: string;
    state: "searching" | "found" | "none" | "failed";
    moves?: string[];
    pair?: string[];
  } | null>(null);
  const solutionSearch = useRef(0);
  const solutionFor = solution?.scramble === scramble ? solution : null;
  // A search still running when the scramble changes is ended.
  useEffect(() => {
    if (solution && solution.scramble !== scramble) {
      if (solution.state === "searching")
        trainer.reset(++trainerSequence.current);
      solutionSearch.current++;
      setSolution(null);
    }
  }, [solution, scramble, trainer]);
  const solverTimeout =
    import.meta.env.VITE_TEST_HOOKS === "1"
      ? Number(
          new URLSearchParams(location.search).get("solver-timeout") ?? 10_000,
        )
      : 10_000;
  const findSolution = () => {
    if (!solveKind || !drill || !("face" in drill) || scramble === null) return;
    const target = scramble;
    const search = ++solutionSearch.current;
    setSolution({ scramble: target, state: "searching" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<"late">((resolve) => {
      timer = setTimeout(() => resolve("late"), solverTimeout);
    });
    void Promise.race([
      trainer.requestSolution(
        target,
        drill.face,
        solveKind,
        ++trainerSequence.current,
      ),
      late,
    ]).then(
      (found) => {
        clearTimeout(timer);
        if (search !== solutionSearch.current) return;
        if (found === "late") {
          // Too long: the search ends, so the next one starts on a fresh worker.
          trainer.reset(++trainerSequence.current);
          setSolution({ scramble: target, state: "failed" });
        } else if (found === null)
          setSolution({ scramble: target, state: "none" });
        else
          setSolution({
            scramble: target,
            state: "found",
            moves: found.moves,
            ...(found.pair ? { pair: found.pair } : {}),
          });
      },
      () => {
        clearTimeout(timer);
        if (search === solutionSearch.current)
          setSolution({ scramble: target, state: "failed" });
      },
    );
  };
  const toggleSolution = () => {
    if (!solveKind || !settledPhase || shownScramble !== scramble) return;
    if (solutionFor) {
      if (solutionFor.state === "searching")
        trainer.reset(++trainerSequence.current);
      solutionSearch.current++;
      setSolution(null);
    } else findSolution();
  };
  const hasTextSelection = () => window.getSelection()?.isCollapsed === false;
  const unavailable = (reason: string) =>
    setFeedback({ reason, key: performance.now() });
  /** + and −: the part with the focus, else under the pointer, one step (DESIGN §8). */
  const resize = (delta: -1 | 1) => {
    if (!editable) return;
    const focused = document.activeElement;
    const part = sizeTarget(
      focused && focused !== timerPage.current ? partOf(focused) : null,
      hoveredPart.current,
    );
    if (!part) {
      unavailable(words.sizes.where);
      return;
    }
    // Quick presses build on the last asked-for sizes, not on the last saved ones.
    const current = pendingSizes.current ?? view.settings.sizes;
    const next = stepSize(part, delta, current);
    if (next !== current) {
      pendingSizes.current = next;
      // Kept until the view shows it (below): a save can settle before the next render,
      // and a press in between must not build on the older sizes.
      void app.setSetting("sizes", next).catch(() => {
        if (pendingSizes.current === next) pendingSizes.current = null;
      });
    }
    setNotice(words.sizes.note(words.sizes.part[part], next[part]));
  };
  /** ↑ ↓ while repeating: the attempt before or after the one on show. */
  const stepAttempt = (by: -1 | 1) => {
    if (!repeat) return;
    const at = repeat.attempts.findIndex(({ id }) => id === repeat.shown.id);
    const next = repeat.attempts[at + by];
    if (next) void app.showAttempt(next.id);
    else unavailable(by < 0 ? words.repeat.first : words.repeat.last);
  };
  const navigateScramble = (direction: -1 | 1) => {
    if (!canStepScramble) return;
    // ← → leave the repeated scramble for the one that was waiting.
    if (repeat) {
      void app.leaveRepeat();
      return;
    }
    if (view.browsing) void app.live();
    if (!stepScramble(direction)) unavailable(words.noEarlierScramble);
  };
  // Everything before the solve goes to a new session named by its last day.
  const splitBefore = useCallback(
    (pivotId: string) =>
      void app
        .splitBefore(pivotId, (last, session) =>
          words.splitName(session.name, last.startedAt),
        )
        .then((result) => {
          if ("into" in result)
            setNotice(words.splitDone(result.moved, result.into.name));
          else if (result.error === "first")
            setFeedback({ reason: words.noEarlier, key: performance.now() });
          else if (result.error !== "nothing")
            setNotice(words.notSplit[result.error]);
        }),
    [app, words],
  );
  // [ ] and Alt+1–9 go through the list as it shows, the archived left out.
  const shownSessions = listed(view.sessions, sessionId);
  const goToSession = (index: number) => {
    const target = shownSessions[index];
    if (target && editable) void app.selectSession(target.id);
  };
  const currentIndex = shownSessions.findIndex((item) => item.id === sessionId);
  const handlers: Record<string, () => void> = {
    "solve.plus2": () => {
      if (!editable) return;
      if (!target) unavailable(words.noSolve);
      else if (hasTimePenalty(target.event)) void app.penalty(target, "plus2");
    },
    "solve.dnf": () => {
      if (!editable) return;
      if (!target) unavailable(words.noSolve);
      else void app.penalty(target, "dnf");
    },
    "solve.delete": () => {
      if (!editable) return;
      if (view.selected.size > 0) void app.deleteSelected();
      else if (!target) unavailable(words.noSolve);
      else void app.deleteSolve(target);
    },
    "solve.move": () => {
      if (!editable || repeat) return;
      if (!target) unavailable(words.noSolve);
      else {
        setMoveOpen(true);
        openDialog("switch");
      }
    },
    "solve.split": () => {
      if (!editable || repeat) return;
      const [picked, ...more] = view.selected;
      const pivot = picked && more.length === 0 ? picked : target?.id;
      if (!pivot) unavailable(words.noSolve);
      else splitBefore(pivot);
    },
    "solve.selectEarlier": () => {
      if (!editable || repeat) return;
      if (!target) unavailable(words.noSolve);
      else
        void app.extend(-1).then((moved) => {
          if (!moved) unavailable(words.noEarlier);
        });
    },
    "solve.selectLater": () => {
      if (!editable || repeat) return;
      if (!target) unavailable(words.noSolve);
      else
        void app.extend(1).then((moved) => {
          if (!moved) unavailable(words.noLater);
        });
    },
    "solve.comment": () => {
      if (!editable) return;
      if (!target) unavailable(words.noSolve);
      else setCommenting(target.id);
    },
    "solve.earlier": () => {
      if (!editable) return;
      if (repeat) stepAttempt(-1);
      else if (!target) unavailable(words.noSolve);
      else
        void app.browse(-1).then((moved) => {
          if (!moved) unavailable(words.noEarlier);
        });
    },
    "solve.later": () => {
      if (!editable) return;
      if (repeat) stepAttempt(1);
      else if (!target) unavailable(words.noSolve);
      else
        void app.browse(1).then((moved) => {
          if (!moved) unavailable(words.noLater);
        });
    },
    "solve.repeat": () => {
      if (!editable || repeat) return;
      if (!target) unavailable(words.noSolve);
      else void app.repeat();
    },
    undo: () => {
      if (editable) void app.undo();
    },
    "theme.system": () => {
      if (editable) void app.setSetting("theme", "system");
    },
    "theme.dark": () => {
      if (editable) void app.setSetting("theme", "dark");
    },
    "theme.light": () => {
      if (editable) void app.setSetting("theme", "light");
    },
    "theme.custom": () => {
      if (!editable) return;
      // With no custom theme yet, the editor in Settings makes one on the theme in view.
      if (view.customTheme) void app.setSetting("theme", "custom");
      else location.hash = "#/settings";
    },
    "size.larger": () => resize(1),
    "size.smaller": () => resize(-1),
    "size.reset": () => {
      if (!editable) return;
      pendingSizes.current = null;
      void app.setSetting("sizes", DEFAULT_SIZES);
      setNotice(words.sizes.resetDone);
    },
    "scramble.next": () => navigateScramble(1),
    "scramble.previous": () => navigateScramble(-1),
    "scramble.copy": async () => {
      if (!shownScramble) return;
      try {
        await navigator.clipboard.writeText(shownScramble);
        setNotice(words.scrambleCopied);
      } catch {
        setNotice(words.scrambleCopyFailed);
      }
    },
    "average.inspect": () => {
      const stats = view.shown?.stats ?? view.stats;
      const name = selectedSlots(
        event,
        view.settings.statSlots,
        view.settings.layout,
      ).find((id) => parseStat(id) !== null && !Number.isNaN(stats[id] ?? NaN));
      if (name) openAverage(name, false, null);
      else unavailable(words.averageDetail.unavailable);
    },
    "picture.zoom": () => {
      if (pictureCanOpen) pictureButton.current?.click();
    },
    "drill.open": () => {
      if (editable && session && event === "333") openDialog("drills");
    },
    "drill.solution": toggleSolution,
    "settings.open": () => {
      location.hash = "#/settings";
    },
    "picture.toggle": () => {
      if (editable) void app.setSetting("picture", !view.settings.picture);
    },
    "layout.lift": () => {
      if (editable) void app.setSetting("layout", "lift");
    },
    "layout.times": () => {
      if (editable) void app.setSetting("layout", "times");
    },
    "layout.focus": () => {
      if (editable) void app.setSetting("layout", "focus");
    },
    "record.toggle": () => {
      if (editable) void app.setSetting("recordCue", !view.settings.recordCue);
    },
    "session.switch": () => {
      if (!editable) return;
      setRenameOnOpen(false);
      openDialog("switch");
    },
    "session.rename": () => {
      if (!editable || !session) return;
      setRenameOnOpen(true);
      openDialog("switch");
    },
    "session.previous": () => goToSession(currentIndex - 1),
    "session.next": () => goToSession(currentIndex + 1),
    "inspection.toggle": () => {
      if (!session || !editable) return;
      const next = view.settings.inspection === "official" ? "off" : "official";
      void app.setSetting("inspection", next, session.id);
      setNotice(next === "off" ? words.inspectionOff : words.inspectionOn);
    },
    "entry.toggle": () => {
      if (!session || !editable || kind !== "time") return;
      void app.setEntry(
        session.id,
        view.settings.entry === "typing" ? "timer" : "typing",
      );
    },
    progress: () => {
      location.hash = "#/progress";
    },
    help: () => openDialog("help"),
    palette: () => openDialog("palette"),
    escape: () => {
      if (modal) closeDialog();
      else if (
        inspecting ||
        state.phase === "holding" ||
        state.phase === "ready"
      )
        cancel();
      else if (view.selected.size > 0) void app.clearSelection();
      else if (repeat) void app.leaveRepeat();
      else if (view.browsing) void app.live();
      else setNotice(null);
    },
  };
  for (let i = 0; i < 9; i++)
    handlers[`session.${i + 1}`] = () => goToSession(i);
  // Only where the browser has a fullscreen: elsewhere the key and its line in Keys go.
  if (canFullscreen(document))
    handlers["view.fullscreen"] = () => toggleFullscreen(document);
  const actions = bindActions(
    handlers,
    (spec) => setNotice(words.notYet(spec.title[view.settings.language])),
    resolveBindings(
      actionsForEvent(event).filter((spec) =>
        spec.input
          ? timerEnabled &&
            spec.input ===
              (view.settings.startMode === "two-hand" ? "hand" : "start")
          : Object.hasOwn(handlers, spec.id),
      ),
      view.keymap,
    ),
  ).map((action) => {
    if (action.id.startsWith("timer."))
      return { ...action, acceptsKey: () => false };
    if (action.id === "escape")
      return {
        ...action,
        acceptsKey: () => modal === null || modal === "help",
      };
    if (action.id === "scramble.copy")
      return {
        ...action,
        acceptsKey: () => !!shownScramble && !hasTextSelection(),
      };
    return action;
  });
  useLayoutEffect(() => {
    actionsRef.current = actions;
  });
  const handLabel = (
    id: "timer.handLeft" | "timer.handRight",
    fallback: string,
  ) => {
    const [binding] = keysFor(view.keymap, id);
    if (!binding) return words.settings.keysUnbound;
    if (binding === (id === "timer.handLeft" ? "ControlLeft" : "ControlRight"))
      return fallback;
    return keyLabel(binding, isMacPlatform(), view.settings.language);
  };
  // An empty session says how to start (DESIGN §7): the start keys when not Space alone.
  const emptyHint = (() => {
    // A drill with no case picked cannot start: the scramble's place says why.
    if (drillBlocked) return { keys: null, touch: null };
    // Fewest Moves and typed results have their own fields: the first sentence only.
    if (eventInfo(view.current?.event ?? "333").kind === "moves")
      return { keys: null, touch: null };
    if (view.settings.entry === "typing") return { keys: null, touch: null };
    const touch = words.emptyHintTouch;
    // The two keys' names stand above the time already.
    if (view.settings.startMode === "two-hand")
      return { keys: words.emptyHintHands, touch };
    const [start] = keysFor(view.keymap, "timer.start");
    if (!start) return { keys: null, touch };
    if (start === "Space") return { keys: words.emptyHintKey, touch };
    return {
      keys: words.emptyHintKeys(
        keyLabel(start, isMacPlatform(), view.settings.language),
      ),
      touch,
    };
  })();
  const helpState = state.phase === "stopped" ? "stopped" : "idle";
  const timerActive =
    state.phase === "holding" ||
    state.phase === "ready" ||
    state.phase === "running";
  const canChangeEntry = dbKind === "persistent" || dbKind === "memory";
  const changePointer = useRef<Element | null>(null);
  const stoppingTouch = useRef(false);
  const recentInSession =
    recent !== null &&
    (!recent.sessionId
      ? event === recent.event
      : recent.sessionId === view.current?.id);

  return (
    <main
      ref={timerPage}
      data-timer-surface={timerEnabled ? "" : undefined}
      data-no-timer={zoom !== null ? "" : undefined}
      data-phase={state.phase}
      data-arrangement="c"
      data-layout={view.settings.layout}
      data-shown-solve={shownSolve?.id}
      data-stat-picker-open={statPicker || undefined}
      data-inspection={view.settings.inspection}
      style={Object.fromEntries(
        VIEW_PARTS.map((part) => [
          `--size-${part}`,
          view.settings.sizes[part] / 100,
        ]),
      )}
      onPointerMove={(input) => {
        hoveredPart.current =
          input.pointerType === "mouse" && input.target instanceof Element
            ? partOf(input.target)
            : null;
      }}
      onPointerLeave={() => {
        hoveredPart.current = null;
      }}
      tabIndex={-1}
      onPointerDownCapture={(input) => {
        const target = input.target instanceof Element ? input.target : null;
        changePointer.current =
          target?.closest('select, input[type="file"]') ?? null;
        stoppingTouch.current =
          state.phase === "running" &&
          (input.pointerType === "touch" || input.pointerType === "pen");
      }}
      onKeyDown={() => {
        changePointer.current = null;
      }}
      onClickCapture={(input) => {
        const stopsSolve = stoppingTouch.current && input.detail > 0;
        if (
          (stopsSolve || state.phase === "running") &&
          input.target instanceof Element &&
          input.target.closest('[data-action="progress"]')
        )
          input.preventDefault();
        if (stopsSolve) {
          if (changePointer.current instanceof HTMLInputElement)
            input.preventDefault();
          input.stopPropagation();
        }
      }}
      onClick={(input) => {
        if (
          input.detail > 0 &&
          input.target instanceof Element &&
          input.target.closest("button") &&
          !input.target.closest(
            '[data-action="keys"], [data-action="dialog-close"], [data-part="stats-now"], [data-part="stat-picker"], [data-part="average-detail"], [data-action="average-inspect-best"], [data-part="training"]',
          )
        )
          input.currentTarget.focus({ preventScroll: true });
      }}
      onChange={(input) => {
        if (input.target === changePointer.current) {
          changePointer.current = null;
          input.currentTarget.focus({ preventScroll: true });
        }
      }}
    >
      <Timer
        scramble={shownScramble}
        event={event}
        pending={pending}
        retry={nextScramble}
        blocked={drillBlocked ? words.drill.pickOne : undefined}
        stepScramble={
          canStepScramble && modal === null ? navigateScramble : undefined
        }
        phase={state.phase}
        displayMs={
          state.phase === "running" || (!entry && recentInSession)
            ? displayMs
            : 0
        }
        newest={
          repeat?.shown ??
          shownSolve ??
          (isMulti && recentInSession ? (recent ?? newestSolve) : newestSolve)
        }
        justStopped={
          repeat
            ? recentInSession && recent?.id !== repeat.shown.id
            : !shownSolve &&
              !isMulti &&
              recentInSession &&
              newestSolve?.id !== recent?.id
        }
        showPicture={dbKind !== undefined && view.settings.picture}
        pictureButton={pictureButton}
        pictureZoom={zoom}
        onPictureOpen={() => {
          if (pictureCanOpen) setZoom("open");
        }}
        onPictureClosed={closePictureNow}
        showTime={
          repeat !== null ||
          shownSolve !== undefined ||
          !entry ||
          (isMulti && measuredMs === undefined)
        }
        words={words}
        inspectionMs={inspecting ? displayMs : null}
        running={view.settings.running}
        precision={view.settings.precision}
        record={
          view.settings.recordCue &&
          !shownSolve &&
          !repeat &&
          view.rows[0]?.record === true
        }
        {...(view.shown ? { shownNo: view.shown.no } : {})}
        repeat={
          repeat
            ? {
                view: repeat,
                onShow: (id) => void app.showAttempt(id),
                onLeave: () => void app.leaveRepeat(),
              }
            : undefined
        }
        onRepeat={
          editable && shownSolve && kind === "time" && settledPhase
            ? () => void app.repeat()
            : undefined
        }
        commenting={commenting !== null && commenting === target?.id}
        onCommentDone={(comment) => {
          const solve = target;
          setCommenting(null);
          if (comment !== undefined && solve)
            void app.setComment(solve, comment);
          timerPage.current?.focus({ preventScroll: true });
        }}
        feedback={feedback}
        sizes={view.settings.sizes}
      />
      {view.settings.startMode === "two-hand" &&
        timerEnabled &&
        state.phase !== "running" && (
          <p
            data-part="hand-keys"
            data-armed={state.phase === "ready" || undefined}
          >
            <kbd data-held={Boolean(hands & 1) || undefined}>
              {handLabel("timer.handLeft", words.leftHand)}
            </kbd>
            <kbd data-held={Boolean(hands & 2) || undefined}>
              {handLabel("timer.handRight", words.rightHand)}
            </kbd>
          </p>
        )}
      {drill && event === "333" && !inspecting && (
        <p data-part="drill" data-no-timer>
          <span>
            {words.drill.line}: {drillName(profile, words)}
          </span>{" "}
          <button
            type="button"
            data-action="drill-change"
            disabled={!editable || timerActive}
            onClick={(input) => openDialog("drills", input.currentTarget)}
          >
            {words.drill.change}
          </button>
          {solveKind &&
            scramble !== null &&
            shownScramble === scramble &&
            settledPhase && (
              <>
                {" "}
                <button
                  type="button"
                  data-action="drill-solution"
                  aria-expanded={solutionFor !== null}
                  onClick={toggleSolution}
                >
                  {solutionFor ? words.drill.hide : words.drill.solution}
                </button>
                {solutionFor && (
                  <output
                    data-part="drill-solution"
                    data-state={solutionFor.state}
                  >
                    {solutionFor.state === "searching"
                      ? words.drill.searching
                      : solutionFor.state === "none"
                        ? words.drill.notFound
                        : solutionFor.state === "failed"
                          ? words.drill.failed
                          : solutionFor.moves?.length
                            ? `${solutionFor.moves.join(" ")} (${solutionFor.moves.length})`
                            : words.drill.solved}
                    {solutionFor.state === "found" && solutionFor.pair && (
                      <>
                        {" · "}
                        {words.drill.slotOf(slotName(solutionFor.pair))}
                      </>
                    )}
                    {solutionFor.state === "failed" && (
                      <>
                        {" "}
                        <button
                          type="button"
                          data-action="drill-retry"
                          onClick={findSolution}
                        >
                          {words.drill.retry}
                        </button>
                      </>
                    )}
                  </output>
                )}
              </>
            )}
        </p>
      )}
      {modal === "palette" && (
        <Palette
          actions={actions.filter(
            (action) =>
              action.id !== "palette" &&
              !action.id.startsWith("timer.") &&
              action.id !== "escape" &&
              action.when.some((when) => when === helpState),
          )}
          language={view.settings.language}
          keymap={view.keymap}
          placeholder={words.palettePlaceholder}
          closeLabel={words.backToTimer}
          onClose={closeDialog}
        />
      )}
      {modal === "switch" && (
        <SessionSwitch
          app={app}
          view={view}
          words={words}
          renameCurrent={renameOnOpen}
          {...(moveOpen
            ? {
                moving: {
                  count: Math.max(1, view.selected.size),
                  event,
                  onPick: (to: string | { name: string }) =>
                    void app.moveSolves(to).then((result) => {
                      if ("to" in result) {
                        if (result.moved > 0)
                          setNotice(
                            words.movedTo(result.moved, result.to.name),
                          );
                      } else if (result.error !== "nothing")
                        setNotice(words.notMoved[result.error]);
                    }),
                },
              }
            : {})}
          startIn={
            seed?.state === "switch-archive"
              ? "archive"
              : seed?.state === "switch-trash"
                ? "trash"
                : "list"
          }
          onClose={closeDialog}
        />
      )}
      {modal === "help" && (
        <Help
          bindings={bindingsFor(helpState, actions)}
          language={view.settings.language}
          title={words.keysTitle}
          closeLabel={words.backToTimer}
          commandsLabel={words.paletteTitle}
          onCommands={() => setModal("palette")}
          onClose={closeDialog}
        />
      )}
      {modal === "drills" && event === "333" && session && (
        <Suspense fallback={null}>
          <Training
            profile={profile}
            words={words}
            holding={view.settings.holding}
            onChange={(next) =>
              void app.setSetting("training", next, session.id)
            }
            onClose={closeDialog}
          />
        </Suspense>
      )}
      {modal === "average" && average && (
        <AverageDetail
          request={average}
          app={app}
          settings={view.settings}
          keymap={view.keymap}
          words={words}
          onClose={closeDialog}
        />
      )}
      {entry && session && !shownSolve && (
        <Entry
          key={`entry:${session.id}`}
          session={session}
          scramble={repeat?.root.scramble ?? scramble}
          words={words}
          keymap={view.keymap}
          onSave={save}
          multi={
            isMulti
              ? {
                  attempted: cubes,
                  setAttempted: (count) =>
                    setMultiConfig({ sessionId: session.id, count }),
                  locked: timerActive || measuredMs !== undefined,
                  measuredMs,
                  discard: () => setTimedMulti(null),
                }
              : undefined
          }
        />
      )}
      <SolveList
        key={`solves:${view.current?.id}`}
        app={app}
        view={view}
        words={words}
        onMove={openMove}
        onSplit={splitBefore}
        onStatPicker={setStatPicker}
        onAverage={openAverage}
        emptyHint={emptyHint}
      />
      {view.settings.layout === "focus" &&
        editable &&
        zoom === null &&
        !timerActive &&
        !inspecting &&
        view.stats.count > 1 && (
          <nav
            data-part="focus-history"
            data-no-timer
            aria-label={words.solveHistory}
          >
            <button
              type="button"
              data-action="solve-earlier"
              onClick={handlers["solve.earlier"]}
              disabled={view.shown?.no === 1}
              aria-label={words.earlierSolve}
            >
              ‹
            </button>
            <button
              type="button"
              data-action="solve-later"
              onClick={handlers["solve.later"]}
              disabled={!view.browsing}
              aria-label={words.laterSolve}
            >
              ›
            </button>
          </nav>
        )}
      {/* The status line: the session on the left, the rest to the right. */}
      <footer data-part="status-line">
        <Sessions
          app={app}
          view={view}
          words={words}
          onOpen={(opener) => {
            setRenameOnOpen(false);
            openDialog("switch", opener);
          }}
        />
        {session &&
          view.settings.inspection === "official" &&
          eventInfo(event).inspectionMs !== null && (
            <button
              type="button"
              data-action="inspection-toggle"
              data-no-timer
              disabled={!editable || timerActive || inspecting}
              onClick={handlers["inspection.toggle"]}
            >
              15″
            </button>
          )}
        {session && kind === "time" && (
          <label data-no-timer>
            {words.entry.mode}
            <select
              data-part="entry-mode"
              value={view.settings.entry}
              disabled={!canChangeEntry || timerActive}
              onChange={(event) => {
                void app.setEntry(
                  session.id,
                  event.currentTarget.value === "typing" ? "typing" : "timer",
                );
              }}
            >
              <option value="timer">{words.timer}</option>
              <option value="typing">{words.entry.typing}</option>
            </select>
          </label>
        )}
        {applyUpdate &&
          state.phase === "idle" &&
          state.holdStartedAt === null && (
            <p data-part="update">
              {words.updateReady}{" "}
              <button type="button" data-no-timer onClick={applyUpdate}>
                {words.updateAction}
              </button>
            </p>
          )}
        {(dbKind !== "persistent" || dbMessage) && view.unsaved === 0 && (
          <p
            data-part="db-state"
            data-kind={
              dbKind === "persistent" ? "earlier" : (dbKind ?? "opening")
            }
          >
            {dbMessage}
          </p>
        )}
        {view.unsaved > 0 && (
          <p data-part="db-state" data-kind="unsaved" role="alert">
            {words.unsaved(view.unsaved)}{" "}
            <button
              type="button"
              data-no-timer
              data-action="download-unsaved"
              onClick={() => downloadSolves(app.pendingSolves())}
            >
              {words.unsavedDownload}
            </button>
          </p>
        )}
        {notice && (
          <p data-part="notice" role="status" data-no-timer>
            {notice}
          </p>
        )}
        <nav data-no-timer>
          <a
            href="#/train"
            data-action="train"
            aria-label={words.train.title}
            // Its code starts loading at the first sign of intent.
            onPointerEnter={() => void loadTrain()}
            onPointerDown={() => void loadTrain()}
            onFocus={() => void loadTrain()}
          >
            <span data-word="long">{words.train.title}</span>
            <span data-word="short">{words.train.short}</span>
          </a>{" "}
          <a href="#/progress" data-action="progress">
            {words.progress.title}
          </a>{" "}
          <button
            type="button"
            data-action="keys"
            data-no-timer
            disabled={timerActive || inspecting}
            onClick={(input) => {
              if (modal === null) openDialog("help", input.currentTarget);
            }}
          >
            {words.keysTitle}
          </button>{" "}
          <a href="#/settings" data-action="settings">
            {words.settings.title}
          </a>
        </nav>
      </footer>
    </main>
  );
}
