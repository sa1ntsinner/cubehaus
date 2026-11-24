import {
  CROSS_COLOURS,
  type CrossColour,
  type EventId,
  eventInfo,
  faceOfCrossColour,
  hasTimePenalty,
  type Solve,
} from "@cubehaus/core";
import { createScrambleSource, defaultDepth } from "@cubehaus/scramble";
import { cubingGenerate } from "@cubehaus/scramble/cubing";
import {
  assignColour,
  type ColourEntry,
  parseStat,
  type StatId,
} from "@cubehaus/stats";
import {
  type ComponentType,
  type CSSProperties,
  createElement,
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
import { formatSolveLine } from "./average-copy";
import { backupFileName, download } from "./backup-file";
import { colourNews, createCrossAssigner, crossHistory } from "./cross-assign";
import { DbFailure } from "./db/DbFailure";
import { backupDue } from "./db/native";
import { openDatabase } from "./db/open";
import { createPendingJournal, memoryStorage } from "./db/pending";
import { canFullscreen, toggleFullscreen } from "./fullscreen";
import type { GestureId } from "./gesture-hints";
import { learnGesture, nudge, takeHint } from "./input/hint-store";
import { isTouchScreen } from "./input/touch-screen";
import { DEFAULT_SWIPE, useSwipe } from "./input/use-swipe";
import { actionsForEvent, bindActions } from "./keys/actions";
import type { Action } from "./keys/engine";
import { actionKey, keysFor, resolveBindings } from "./keys/keymap";
import { isMacPlatform, keyLabel } from "./keys/label";
import {
  copyOffered,
  copySettled,
  copySolves,
  inPhoneApp,
  keepBackupCopy,
  markCopyOffered,
  wakeLockHost,
  writeBackupCopy,
} from "./phone-app";
import {
  aheadKey,
  keepAhead,
  readAheadKey,
  takeKept,
  warmEvents,
} from "./scramble/ahead";
import { type CrossLengths, createCrossClient } from "./scramble/cross-client";
import { createScrambleHistory } from "./scramble/history";
import { reducedMotion, type ZoomState } from "./scramble/PictureZoom";
import { pictureSupport } from "./scramble/picture";
import {
  createTrainingClient,
  drillName,
  heldScramble,
  isChoosing,
  type TrainingProfile,
  trainingReady,
  type WorkerLike,
} from "./scramble/training-client";
import { CrossCells } from "./screens/CrossCells";
import { Entry } from "./screens/Entry";
import { Sessions } from "./screens/Sessions";
import { SolveList } from "./screens/SolveList";
import { type CrossLine, Timer } from "./screens/Timer";
import { listed } from "./session-order";
import { selectedSlots } from "./session-stats";
import { coloursInPlay } from "./settings";
import type { LoadedSeed } from "./testing/load";
import { type Text, textFor } from "./text";
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
import { keepAwake } from "./wake-lock";
import "./input/behavior.css";

// A sheet a key opens (S, Mod+K, ?): its code is fetched right after the first paint and,
// once here, renders at once. A lazy component alone suspends on its first render even when
// its chunk is cached, and the key typed straight after the opening one was lost.
function warm<P extends object>(load: () => Promise<ComponentType<P>>) {
  let got: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const start = () => {
    pending ??= load().then((component) => {
      got = component;
      return component;
    });
    return pending;
  };
  const Later = lazy(() =>
    start().then((component) => ({ default: component })),
  );
  // biome-ignore lint/correctness/noComponentHookFactories: called once per sheet at module level, never during a render.
  const Sheet = (props: P) =>
    createElement((got ?? Later) as ComponentType<P>, props);
  return [Sheet, start] as const;
}
const [Help, warmHelp] = warm(() =>
  import("./keys/Help").then(({ Help }) => Help),
);
const [Palette, warmPalette] = warm(() =>
  import("./keys/Palette").then(({ Palette }) => Palette),
);
const AverageDetail = lazy(() =>
  import("./screens/AverageDetail").then(({ AverageDetail }) => ({
    default: AverageDetail,
  })),
);
const [SessionGrid, warmGrid] = warm(() =>
  import("./screens/SessionGrid").then(({ SessionGrid }) => SessionGrid),
);
const [SessionSwitch, warmSwitch] = warm(() =>
  import("./screens/SessionSwitch").then(({ SessionSwitch }) => SessionSwitch),
);
if (typeof window !== "undefined")
  window.setTimeout(() => {
    for (const start of [warmGrid, warmSwitch, warmPalette, warmHelp])
      void start().catch(() => {});
  }, 0);
const Training = lazy(() =>
  import("./scramble/Training").then(({ Training }) => ({ default: Training })),
);
const loadTrain = () => import("./screens/Train");
const Train = lazy(() => loadTrain().then(({ Train }) => ({ default: Train })));
// Settings loads on its own like Progress: the timer's first load does not carry it, and
// its code starts loading when the pointer or focus reaches the link.
const loadSettings = () => import("./screens/Settings");
const Settings = lazy(() =>
  loadSettings().then(({ Settings }) => ({ default: Settings })),
);
const loadProgress = () => import("./screens/Progress");
const Progress = lazy(() =>
  loadProgress().then(({ Progress }) => ({ default: Progress })),
);

export function App({
  seed: fixture,
  applyUpdate,
  installFailed = false,
}: {
  seed?: LoadedSeed | undefined;
  applyUpdate?: (() => void) | undefined;
  installFailed?: boolean;
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

  // Phone app: the history's copy in Documents, which the phone's backups keep (the
  // webview's own storage they leave out).
  const phoneCopy = inPhoneApp() && view.dbState?.kind === "persistent";
  useEffect(
    () =>
      phoneCopy
        ? keepBackupCopy(
            () => app.exportBackup(),
            writeBackupCopy,
            document,
            10_000,
            copySettled,
          )
        : undefined,
    [app, phoneCopy],
  );
  // A phone restored from a backup: the webview starts empty while the copy in Documents
  // came back. Said once, while the history is still empty.
  const looksEmpty =
    phoneCopy &&
    view.current !== null &&
    view.sessions.length <= 1 &&
    view.rows.length === 0;
  const [copyOffer, setCopyOffer] = useState(false);
  useEffect(() => {
    if (!looksEmpty || copyOffered()) return;
    let live = true;
    void copySolves()
      .then((solves) => {
        if (!live || solves === 0) return;
        markCopyOffered();
        setCopyOffer(true);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [looksEmpty]);

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
      if (!same && screenOf(next) === "timer") returnTo = true;
      shown = next;
      if (same) setRoute(next);
      else startTransition(() => setRoute(next));
    };
    window.addEventListener("hashchange", update);
    update();
    return () => window.removeEventListener("hashchange", update);
  }, []);

  const dbKind = view.dbState?.kind;
  const words = textFor(language);
  const routeScreen = screenOf(route);
  const heading =
    routeScreen === "#/settings"
      ? words.settings.title
      : routeScreen === "#/progress"
        ? words.progress.title
        : routeScreen === "train"
          ? words.train.title
          : null;
  useLayoutEffect(() => {
    document.title = heading ? `${heading} · cubehaus` : "cubehaus";
  }, [heading]);
  const dbMessage =
    view.dbState?.kind === "persistent" &&
    view.dbState.handoff === "needs-recovery"
      ? words.dbEarlier
      : copyOffer && looksEmpty
        ? words.dbCopy
        : dbKind === "memory"
          ? words.dbMemory
          : dbKind === "busy"
            ? words.dbBusy
            : null;

  // One boundary for every screen, so a transition keeps the shown one in place.
  return <Suspense fallback={null}>{screen()}</Suspense>;
  function screen() {
    if (route === "#/progress")
      return <Progress view={view} dbMessage={dbMessage} words={words} />;
    if (route === "#/train" || route.startsWith("#/train/"))
      return <Train app={app} view={view} words={words} route={route} />;
    if (route === "#/settings" || route.startsWith("#/settings/"))
      return <Settings app={app} view={view} words={words} route={route} />;
    return (
      <TimerPage
        app={app}
        view={view}
        dbMessage={dbMessage}
        seed={seed}
        openCommands={route === "#/commands"}
        openDrills={route === "#/drills"}
        applyUpdate={applyUpdate}
        installFailed={installFailed}
      />
    );
  }
}

/** The timer takes focus when it comes back from another screen, once. */
let returnTo = false;

/** Which screen a route shows. */
/** Local storage, or a stand-in that keeps nothing where the page may not use it. */
function safeStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
}

/** Test builds only: every scramble asked of the source, by key, for the specs to count. */
function countScramble(key: string) {
  const host = window as unknown as { cubehausScrambles?: string[] };
  host.cubehausScrambles ??= [];
  host.cubehausScrambles.push(key);
}

function screenOf(route: string) {
  if (route === "#/train" || route.startsWith("#/train/")) return "train";
  if (route.startsWith("#/settings/")) return "#/settings";
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
  void download(
    backupFileName().replace("backup", "unsaved"),
    JSON.stringify({ format: "cubehaus-pending", version: 1, solves }, null, 2),
  )?.catch(() => {});
}

function TimerPage({
  app,
  view,
  dbMessage,
  seed: fixture,
  openCommands,
  openDrills,
  applyUpdate,
  installFailed,
}: {
  app: AppState;
  view: AppView;
  dbMessage: string | null;
  seed: LoadedSeed | undefined;
  openCommands: boolean;
  openDrills: boolean;
  applyUpdate: (() => void) | undefined;
  installFailed: boolean;
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
  // Every scramble the timer shows comes from here, made ahead per puzzle (and per
  // Multi-Blind count), and none ahead while the page is hidden.
  const [source] = useState(() => {
    // Made ahead by the page before this one and never shown: used first, once each.
    const kept = takeKept(safeStorage());
    return createScrambleSource<string>(
      (key) => {
        const { event, cubes } = readAheadKey(key);
        if (import.meta.env.VITE_TEST_HOOKS === "1") countScramble(key);
        if (fixed && event === "333") return Promise.resolve(fixed);
        const before = kept.next(key);
        if (before !== null) return Promise.resolve(before);
        return cubes === null
          ? cubingGenerate(event)
          : cubingGenerate(event, { cubes });
      },
      {
        depth: (key) => defaultDepth(readAheadKey(key).event),
        active: () => document.visibilityState === "visible",
      },
    );
  });
  // Leaving the page (or hiding it, which may be the last thing it hears), the scrambles
  // made ahead are kept for the next one.
  useEffect(() => {
    const keep = () => {
      if (document.visibilityState === "hidden")
        keepAhead(safeStorage(), source.ahead());
    };
    const leave = () => keepAhead(safeStorage(), source.ahead());
    document.addEventListener("visibilitychange", keep);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", keep);
      window.removeEventListener("pagehide", leave);
    };
  }, [source]);
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
  const [crossClient] = useState(() =>
    createCrossClient(
      () =>
        new Worker(new URL("./scramble/cross-worker.ts", import.meta.url), {
          type: "module",
        }) as unknown as WorkerLike,
    ),
  );
  useEffect(() => () => crossClient.close(), [crossClient]);
  const trainerSequence = useRef(0);
  // A drill is a 3×3 session's choice; every other puzzle keeps official scrambles.
  const profile: TrainingProfile =
    event === "333" ? view.settings.training : { request: null };
  const drill = profile.request;
  const drillBlocked = !trainingReady(profile);
  // Colour neutrality (3×3, Settings › Cross colour): the colour each scramble's cross is
  // built on, from the colours in play; a cross drill is made for that colour.
  // Choosing the cross: official scrambles, inspection, a colour key; nothing is stored.
  const choosing = event === "333" && isChoosing(profile);
  const crossAssigned =
    event === "333" && view.settings.cross === "assigned" && !choosing;
  const inPlay = useMemo(
    () =>
      coloursInPlay({
        holding: view.settings.holding,
        crossColours: view.settings.crossColours,
      }),
    [view.settings.holding, view.settings.crossColours],
  );
  const [assigner] = useState(createCrossAssigner);
  const crossNow = useRef<{
    on: boolean;
    colours: readonly CrossColour[];
    history: readonly ColourEntry<CrossColour>[];
  }>({ on: false, colours: [], history: [] });
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
        let request = JSON.parse(drill) as TrainingProfile["request"];
        // A cross drill under an assigned colour is made for the colour the rule picks.
        const cross = crossNow.current;
        const colour =
          cross.on && request && "face" in request
            ? assignColour({
                colours: cross.colours,
                history: cross.history,
                seed: crypto.getRandomValues(new Uint32Array(1))[0] as number,
              }).colour
            : null;
        if (fixed) {
          if (colour) assigner.keep(fixed, colour);
          return fixed;
        }
        if (colour && request && "face" in request)
          request = { ...request, face: faceOfCrossColour(colour) };
        // Superseded by a newer request: asked again while this drill is still on screen.
        while (currentKey.current === key) {
          const made = await trainer.requestTraining(
            { request } as TrainingProfile,
            ++trainerSequence.current,
          );
          if (made) {
            const value = heldScramble(request, made.scramble, holding);
            if (colour) assigner.keep(value, colour);
            return value;
          }
        }
        throw new Error("The drill changed");
      }
      return source.next(aheadKey(event, cubes));
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
  // Read by the drill maker and by save, which run outside this render.
  crossNow.current = {
    on: crossAssigned,
    colours: inPlay,
    history: crossAssigned
      ? crossHistory(
          view.rows.map((row) => row.solve),
          recent,
          sessionId,
        )
      : [],
  };
  // The scramble timed again (R), read when a solve lands, not when the timer started.
  const repeatRoot = useRef<Solve | null>(null);
  repeatRoot.current = view.repeat?.root ?? null;
  const save = useCallback(
    (timed: Solve) => {
      const root = repeatRoot.current;
      // An attempt on the repeated scramble is saved as its repeat; the scramble stays.
      const again =
        root &&
        timed.repeatOf === undefined &&
        timed.scramble === root.scramble &&
        timed.sessionId === root.sessionId;
      const cross = crossNow.current;
      // The colour the mark showed for this scramble goes with the solve.
      const solve: Solve = again
        ? { ...timed, repeatOf: root.id }
        : cross.on && timed.event === "333"
          ? {
              ...timed,
              crossColour: assigner.colourFor(
                timed.scramble,
                cross.colours,
                cross.history,
              ),
            }
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
    [app, assigner, entry, event, nextScramble, sessionId],
  );

  // Back on screen, the queue made ahead fills again (nothing is made while hidden).
  // Once the scramble on show has come and the page is idle, the first scramble of
  // every other puzzle in use is made too, so opening its session finds it ready.
  const shownKey = drill ? null : aheadKey(event, isMulti ? cubes : null);
  const firstShown = prepared?.value != null;
  const warm = warmEvents(view.sessions, event).join(" ");
  useEffect(() => {
    const visible = () => document.visibilityState === "visible";
    let idle: number | undefined;
    const warmUp = () => {
      if (!visible() || !firstShown || idle !== undefined) return;
      const run = () => {
        if (!visible()) {
          idle = undefined;
          return;
        }
        for (const other of warm.split(" ").filter(Boolean))
          source.prefetch(other);
      };
      idle =
        typeof requestIdleCallback === "function"
          ? requestIdleCallback(run, { timeout: 2000 })
          : window.setTimeout(run, 500);
    };
    const shown = () => {
      if (!visible()) return;
      if (shownKey !== null) source.prefetch(shownKey);
      warmUp();
    };
    warmUp();
    document.addEventListener("visibilitychange", shown);
    return () => {
      document.removeEventListener("visibilitychange", shown);
      if (idle === undefined) return;
      if (typeof cancelIdleCallback === "function") cancelIdleCallback(idle);
      else clearTimeout(idle);
    };
  }, [source, shownKey, firstShown, warm]);

  const currentScramble =
    prepared?.event === event && prepared.group === group
      ? prepared
      : undefined;
  // A drill with no case picked has no scramble, so the timer cannot start.
  const scramble = drillBlocked ? null : (currentScramble?.value ?? null);
  const pending = drillBlocked ? false : (currentScramble?.pending ?? true);
  // The colour of the cross on the scramble on screen; a scramble timed again keeps its own.
  const crossColour: CrossColour | null = !crossAssigned
    ? null
    : view.repeat
      ? (view.repeat.root.crossColour ?? null)
      : scramble === null
        ? null
        : assigner.colourFor(scramble, inPlay, crossNow.current.history);
  // One quiet line when the plan changes with this scramble: a new colour's block, or the
  // mix beginning. Said once per scramble, never for a scramble timed again.
  const newsShown = useRef<string | null>(null);
  useEffect(() => {
    if (!crossColour || view.repeat || scramble === null) return;
    if (newsShown.current === scramble) return;
    newsShown.current = scramble;
    const news = colourNews(crossNow.current.history, inPlay, crossColour);
    if (news)
      setNotice(
        news.kind === "mixed"
          ? words.cross.mixed
          : words.cross.nextBlock(
              words.cross.mark(words.cross.name[news.colour]),
            ),
      );
  }, [crossColour, scramble, view.repeat, inPlay, words]);
  const measuredMs =
    timedMulti?.sessionId === sessionId && timedMulti?.scramble === scramble
      ? timedMulti?.timeMs
      : undefined;
  const quietCancel = useRef(false);
  // The choosing drill always inspects: the choice is made in inspection.
  const timerSettings = useMemo(
    () =>
      choosing
        ? { ...view.settings, inspection: "official" as const }
        : view.settings,
    [choosing, view.settings],
  );
  const onTimedSolve = useCallback(
    (solve: Solve) => {
      // A solve timed while choosing is not kept: the drill is the choice alone.
      if (choosing) {
        if (solve.scramble === scramble) nextScramble();
        return;
      }
      if (solve.event === "333mbf") {
        if (solve.sessionId === sessionId && solve.scramble === scramble)
          setTimedMulti(solve);
      } else {
        save(solve);
      }
    },
    [choosing, nextScramble, save, scramble, sessionId],
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
  // Back from another screen, the keyboard is on the timer itself (not lost on the page),
  // so Space times the next solve at once.
  useLayoutEffect(() => {
    const back = returnTo;
    returnTo = false;
    if (back) timerPage.current?.focus({ preventScroll: true });
  }, []);
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
    // Focus goes back once the sheet has left: a modal sheet keeps the page inert until
    // then, and an inert element takes no focus.
    const back = dialogOpener.current ?? timerPage.current;
    dialogOpener.current = null;
    if (modal !== null) focusBack.current = back;
    else
      (back?.isConnected ? back : timerPage.current)?.focus({
        preventScroll: true,
      });
  };
  const focusBack = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (modal !== null) return;
    const back = focusBack.current;
    focusBack.current = null;
    if (!back) return;
    (back.isConnected ? back : timerPage.current)?.focus({
      preventScroll: true,
    });
  }, [modal]);
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
  const restorePictureFocus = useRef(false);
  useLayoutEffect(() => {
    if (zoom !== null || !restorePictureFocus.current) return;
    restorePictureFocus.current = false;
    pictureButton.current?.focus({ preventScroll: true });
  }, [zoom]);
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
      // A colour picked in the choosing drill ends inspection; that says nothing.
      if (effect.type === "inspectionCancelled" && quietCancel.current) {
        quietCancel.current = false;
        return;
      }
      if (effect.type === "tooShort") setNotice(words.tooShort);
      else if (effect.type === "inspectionCancelled")
        setNotice(words.inspectionCancelled);
    },
    session,
    settings: timerSettings,
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
  // Choosing the cross: in inspection the colour's key (or its word) is the answer; the
  // shortest cross of every colour in play then says how near the pick came.
  const [choice, setChoice] = useState<{
    scramble: string;
    pick: CrossColour;
    lengths: CrossLengths | null;
  } | null>(null);
  const pickColour = (colour: CrossColour) => {
    if (!choosing || !inspecting || scramble === null) return;
    if (!inPlay.includes(colour)) return;
    const target = scramble;
    quietCancel.current = true;
    cancel();
    setChoice({ scramble: target, pick: colour, lengths: null });
    void crossClient
      .lengths(target, inPlay)
      .then((lengths) =>
        setChoice((current) =>
          current?.scramble === target ? { ...current, lengths } : current,
        ),
      );
    nextScramble();
  };
  const pickRef = useRef(pickColour);
  pickRef.current = pickColour;
  useEffect(() => {
    if (!choosing || !inspecting) return;
    const keys: Record<string, CrossColour> = {
      KeyW: "white",
      KeyY: "yellow",
      KeyG: "green",
      KeyB: "blue",
      KeyR: "red",
      KeyO: "orange",
    };
    const press = (event: KeyboardEvent) => {
      const colour = keys[event.code];
      if (!colour || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) pickRef.current(colour);
    };
    window.addEventListener("keydown", press, { capture: true });
    return () =>
      window.removeEventListener("keydown", press, { capture: true });
  }, [choosing, inspecting]);
  // The lengths are counted while the scramble waits, so the answer is there at the pick.
  useEffect(() => {
    if (choosing && scramble !== null)
      void crossClient.lengths(scramble, inPlay);
  }, [choosing, scramble, inPlay, crossClient]);
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
    () => (awake ? keepAwake(wakeLockHost(), document) : undefined),
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
      } else {
        restorePictureFocus.current = key.key === "Escape";
        closePicture();
      }
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
  // After a solve, each colour in play's shortest cross on its scramble: always with an
  // assigned colour, else while X has asked for it. Counted in a worker, so the result
  // never waits for it.
  const [crossAsked, setCrossAsked] = useState(false);
  const lineSolve =
    event === "333" && (crossAssigned || crossAsked) ? target : undefined;
  // With an assigned colour, the colours in play (and the solve's own, if it has left
  // play); with Any, X asks about every colour: which would have been the shortest.
  const lineColours = useMemo(
    () =>
      !crossAssigned
        ? CROSS_COLOURS
        : lineSolve?.crossColour && !inPlay.includes(lineSolve.crossColour)
          ? [...inPlay, lineSolve.crossColour]
          : inPlay,
    [crossAssigned, inPlay, lineSolve?.crossColour],
  );
  const [crossLengths, setCrossLengths] = useState<{
    key: string;
    lengths: CrossLengths | null;
  }>();
  const lineKey = lineSolve
    ? `${lineColours.join(",")}\n${lineSolve.scramble}`
    : null;
  useEffect(() => {
    if (!lineSolve || lineKey === null) return;
    let stale = false;
    void crossClient
      .lengths(lineSolve.scramble, lineColours)
      .then((lengths) => {
        if (!stale) setCrossLengths({ key: lineKey, lengths });
      });
    return () => {
      stale = true;
    };
  }, [crossClient, lineSolve, lineKey, lineColours]);
  const crossLine: CrossLine | null = !lineSolve
    ? null
    : crossLengths?.key !== lineKey
      ? {
          lengths: lineColours.map((colour) => ({ colour, length: 0 })),
          own: null,
          shortest: 0,
          pending: true,
        }
      : crossLengths.lengths
        ? (() => {
            const lengths = lineColours.flatMap((colour) => {
              const length = crossLengths.lengths?.[colour];
              return length === undefined ? [] : [{ colour, length }];
            });
            return {
              lengths,
              own: lineSolve.crossColour ?? null,
              shortest: Math.min(...lengths.map(({ length }) => length)),
            };
          })()
        : null;
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
        crossColour ? faceOfCrossColour(crossColour) : drill.face,
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

  // ---- touch gestures (DESIGN.md section 18a) ----
  // A gesture acts only between solves, and not in the moments after a stop, when the
  // second hand may still be coming down on the screen.
  const stoppedAt = useRef(Number.NEGATIVE_INFINITY);
  useEffect(() => {
    if (state.phase === "stopped") stoppedAt.current = performance.now();
  }, [state.phase]);
  const gestureReady = () =>
    settledPhase &&
    modal === null &&
    zoom === null &&
    !statPicker &&
    commenting === null &&
    performance.now() - stoppedAt.current > 700;
  const learned = learnGesture;
  // For the parts that bind their own gestures (the session name, the file's lines).
  const readyNow = useRef(gestureReady);
  readyNow.current = gestureReady;
  const gesturesReady = useCallback(() => readyNow.current(), []);
  const timePenalty = target ? hasTimePenalty(target.event) : false;
  useSwipe(timerPage, {
    config: {
      ...DEFAULT_SWIPE,
      directions: timePenalty ? ["left", "right", "down"] : ["left", "down"],
    },
    // The time and the row it stands in: a short result is narrow, and a finger starting
    // beside it on the ground means the time all the same.
    subject: (element, at) => {
      const time = timerPage.current?.querySelector<HTMLElement>(
        ':scope > output[data-part="time"]',
      );
      if (!time) return null;
      if (time.contains(element)) return time;
      if (element !== timerPage.current) return null;
      const box = time.getBoundingClientRect();
      return at.y >= box.top - 16 && at.y <= box.bottom + 16 ? time : null;
    },
    enabled: () =>
      gestureReady() && editable && !!target && view.selected.size === 0,
    word: (direction) =>
      direction === "left"
        ? words.deleteSolve
        : direction === "right"
          ? target?.plus2
            ? words.penaltyOk
            : words.penaltyPlus2
          : target?.dnf
            ? words.penaltyOk
            : words.penaltyDnf,
    tone: (direction) => (direction === "right" ? "warn" : "error"),
    onCommit: (direction) => {
      if (!target) return;
      if (direction === "left") void app.deleteSolve(target);
      else void app.penalty(target, direction === "right" ? "plus2" : "dnf");
      learned(
        direction === "left"
          ? "time-left"
          : direction === "right"
            ? "time-right"
            : "time-down",
      );
    },
  });
  useSwipe(timerPage, {
    config: { ...DEFAULT_SWIPE, directions: ["left", "right"] },
    subject: (element) =>
      element.closest<HTMLElement>('main > [data-part="scramble"]'),
    enabled: () => gestureReady() && canStepScramble,
    word: (direction) =>
      direction === "left" ? words.gestures.next : words.gestures.previous,
    onCommit: (direction) => {
      navigateScramble(direction === "left" ? 1 : -1);
      learned("scramble");
    },
  });
  // After a stop, once the result has been seen: at most one quiet line naming a gesture
  // that works here, with the part showing the way once.
  const [hint, setHint] = useState<GestureId | null>(null);
  const solvesSinceHint = useRef(0);
  const lastPhase = useRef(state.phase);
  const hintContext = useRef({
    ready: gestureReady,
    available: [] as GestureId[],
  });
  hintContext.current = {
    ready: gestureReady,
    available: [
      ...(editable && target
        ? ([
            ...(timePenalty ? (["time-right"] as const) : []),
            "time-down",
            "time-left",
          ] as GestureId[])
        : []),
      ...(canStepScramble ? (["scramble"] as const) : []),
      ...(editable && view.settings.layout !== "focus" && view.rows.length > 1
        ? (["row-left"] as const)
        : []),
      ...(listed(view.sessions, view.current?.id).length > 1
        ? (["session"] as const)
        : []),
    ],
  };
  useEffect(() => {
    const before = lastPhase.current;
    lastPhase.current = state.phase;
    if (state.phase === "running") setHint(null);
    if (before === "running" && state.phase === "stopped")
      solvesSinceHint.current += 1;
    if (!(before === "stopped" && state.phase === "idle")) return;
    if (!isTouchScreen()) return;
    const timeout = setTimeout(() => {
      const { ready, available } = hintContext.current;
      if (!ready()) return;
      const id = takeHint(available, solvesSinceHint.current);
      if (!id) return;
      solvesSinceHint.current = 0;
      setHint(id);
    }, 900);
    return () => clearTimeout(timeout);
  }, [state.phase]);
  // The hint goes when its moment has passed: a new attempt, a sheet, or after a while.
  useEffect(() => {
    if (hint === null) return;
    if (!settledPhase || modal !== null) {
      setHint(null);
      return;
    }
    const timeout = setTimeout(() => setHint(null), 6000);
    return () => clearTimeout(timeout);
  }, [hint, settledPhase, modal]);
  useEffect(() => {
    if (hint === null) return;
    const page = timerPage.current;
    const [selector, direction] =
      hint === "scramble"
        ? ['[data-part="scramble"]', "left"]
        : hint === "row-left"
          ? ['[data-part="solves"] > li[data-newest]', "left"]
          : hint === "session"
            ? ['[data-action="session-switch"]', "left"]
            : ['output[data-part="time"]', hint.slice("time-".length)];
    return nudge(page?.querySelector(selector), direction);
  }, [hint]);
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
    // The solve on show (else the newest) as one line: its result, then its scramble.
    "solve.copy": async () => {
      if (!target) {
        unavailable(words.noSolve);
        return;
      }
      try {
        await navigator.clipboard.writeText(
          formatSolveLine(target, view.settings.precision),
        );
        setNotice(words.solveCopied);
      } catch {
        setNotice(words.solveCopyFailed);
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
    "cross.lengths": () => {
      if (event !== "333") return;
      if (crossAssigned) unavailable(words.cross.alwaysShown);
      else setCrossAsked((asked) => !asked);
    },
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
      data-inspecting={inspecting || undefined}
      data-arrangement="c"
      data-layout={view.settings.layout}
      data-shown-solve={shownSolve?.id}
      data-stat-picker-open={statPicker || undefined}
      data-inspection={view.settings.inspection}
      style={
        {
          ...Object.fromEntries(
            VIEW_PARTS.map((part) => [
              `--size-${part}`,
              view.settings.sizes[part] / 100,
            ]),
          ),
          // The hold the person chose: the ink rises and the screen clears in that time.
          "--hold": `${view.settings.holdMs}ms`,
        } as CSSProperties
      }
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
      <h1 data-heard>{words.timer}</h1>
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
        crossLine={crossLine}
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
      {(((drill || choosing) && !inspecting) ||
        (choosing && inspecting) ||
        crossColour) && (
        // The drill line, and the colour of the cross on the scramble on screen: one
        // quiet mark that stays through inspection, when the drill's words have gone.
        // Choosing the cross, inspection puts the colours to pick from in their place.
        <p
          data-part={drill || choosing ? "drill" : "cross"}
          data-no-timer
          data-inspecting={inspecting || undefined}
        >
          {crossColour && (
            <span data-part="cross-mark" data-colour={crossColour}>
              <span
                data-part="cross-swatch"
                data-face={faceOfCrossColour(crossColour)}
                aria-hidden="true"
              />
              {words.cross.mark(words.cross.name[crossColour])}
            </span>
          )}
          {choosing && inspecting && (
            <span data-part="cross-choice">
              {inPlay.map((colour) => (
                <button
                  key={colour}
                  type="button"
                  data-action="cross-pick"
                  data-colour={colour}
                  onClick={() => pickColour(colour)}
                >
                  <span
                    data-part="cross-swatch"
                    data-face={faceOfCrossColour(colour)}
                    aria-hidden="true"
                  />
                  {words.cross.name[colour]}
                  <kbd data-input="keys">{PICK_KEYS[colour]}</kbd>
                </button>
              ))}
            </span>
          )}
          {(drill || choosing) && !inspecting && (
            <>
              <span>
                {words.drill.line}:{" "}
                {drillName(profile, words, crossColour !== null)}
              </span>{" "}
              <button
                type="button"
                data-action="drill-change"
                disabled={!editable || timerActive}
                onClick={(input) => openDialog("drills", input.currentTarget)}
              >
                {words.drill.change}
              </button>
              {choosing && choice?.lengths && (
                <ChoiceResult
                  lengths={choice.lengths}
                  pick={choice.pick}
                  colours={inPlay}
                  words={words}
                />
              )}
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
                    <output
                      data-part={solutionFor ? "drill-solution" : undefined}
                      data-state={solutionFor?.state}
                      data-heard={solutionFor ? undefined : ""}
                    >
                      {solutionFor && (
                        <>
                          {solutionFor.state === "searching"
                            ? words.drill.searching
                            : solutionFor.state === "none"
                              ? words.drill.notFound
                              : solutionFor.state === "failed"
                                ? words.drill.failed
                                : solutionFor.moves?.length
                                  ? `${solutionFor.moves.join(" ")} (${solutionFor.moves.length})`
                                  : words.drill.solved}
                          {solutionFor.state === "found" &&
                            solutionFor.pair && (
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
                        </>
                      )}
                    </output>
                  </>
                )}
            </>
          )}
        </p>
      )}
      <Suspense fallback={null}>
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
            title={words.paletteTitle}
            placeholder={words.palettePlaceholder}
            closeLabel={words.backToTimer}
            onClose={closeDialog}
          />
        )}
        {modal === "switch" && !moveOpen && (
          <SessionGrid
            app={app}
            view={view}
            words={words}
            renameCurrent={renameOnOpen}
            startIn={
              seed?.state === "switch-archive"
                ? "archive"
                : seed?.state === "switch-trash"
                  ? "trash"
                  : "list"
            }
            onClose={(picked) => {
              // A session picked: the keyboard is on the timer, so Space times at once.
              if (picked) dialogOpener.current = null;
              closeDialog();
            }}
          />
        )}
        {modal === "switch" && moveOpen && (
          <SessionSwitch
            app={app}
            view={view}
            words={words}
            moving={{
              count: Math.max(1, view.selected.size),
              event,
              onPick: (to: string | { name: string }) =>
                void app.moveSolves(to).then((result) => {
                  if ("to" in result) {
                    if (result.moved > 0)
                      setNotice(words.movedTo(result.moved, result.to.name));
                  } else if (result.error !== "nothing")
                    setNotice(words.notMoved[result.error]);
                }),
            }}
            onClose={closeDialog}
          />
        )}
        {modal === "help" && (
          <Help
            bindings={bindingsFor(helpState, actions)}
            language={view.settings.language}
            title={isTouchScreen() ? words.gestures.title : words.keysTitle}
            gestures={isTouchScreen() ? words.gestures.list : undefined}
            closeLabel={words.backToTimer}
            commandsLabel={words.paletteTitle}
            onCommands={() => setModal("palette")}
            onClose={closeDialog}
          />
        )}
        {modal === "drills" && event === "333" && session && (
          <Training
            profile={profile}
            words={words}
            holding={view.settings.holding}
            colourAssigned={view.settings.cross === "assigned"}
            onChange={(next) =>
              void app.setSetting("training", next, session.id)
            }
            onClose={closeDialog}
          />
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
      </Suspense>
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
        gesturesReady={gesturesReady}
        onLearned={learned}
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
      <p data-heard role="status">
        {notice ?? (hint ? words.gestures.hint[hint] : "")}
      </p>
      <footer data-part="status-line">
        <Sessions
          app={app}
          view={view}
          words={words}
          onOpen={(opener) => {
            setRenameOnOpen(false);
            openDialog("switch", opener);
          }}
          ready={gesturesReady}
          onLearned={learned}
        />
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
        {installFailed && state.phase === "idle" && (
          <p data-part="update" data-kind="failed">
            {words.updateFailed}
          </p>
        )}
        {view.dbState?.kind === "failed" && (
          <DbFailure state={view.dbState} words={words} />
        )}
        {dbKind !== "failed" &&
          (dbKind !== "persistent" || dbMessage) &&
          view.unsaved === 0 && (
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
          <p data-part="notice" data-no-timer>
            {notice}
          </p>
        )}
        {!notice && hint && (
          <p data-part="notice" data-kind="hint" data-no-timer>
            {words.gestures.hint[hint]}
            <button
              type="button"
              data-action="gestures-open"
              onClick={(input) => {
                if (modal === null) openDialog("help", input.currentTarget);
              }}
            >
              {words.gestures.title}
            </button>
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
          <a
            href="#/progress"
            data-action="progress"
            onPointerEnter={() => void loadProgress()}
            onPointerDown={() => void loadProgress()}
            onFocus={() => void loadProgress()}
          >
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
          <a
            href="#/settings"
            data-action="settings"
            onPointerEnter={() => void loadSettings()}
            onPointerDown={() => void loadSettings()}
            onFocus={() => void loadSettings()}
          >
            {words.settings.title}
          </a>{" "}
          {/* A touch screen has no keys: its list is the gestures (shown by CSS). */}
          <button
            type="button"
            data-action="gestures"
            data-no-timer
            aria-label={words.gestures.title}
            disabled={timerActive || inspecting}
            onClick={(input) => {
              if (modal === null) openDialog("help", input.currentTarget);
            }}
          >
            ?
          </button>
        </nav>
      </footer>
    </main>
  );
}

/** Choosing the cross: the key of each colour, by its English name's first letter. */
const PICK_KEYS: Record<CrossColour, string> = {
  white: "W",
  yellow: "Y",
  green: "G",
  blue: "B",
  red: "R",
  orange: "O",
};

/**
 * After a pick: every colour in play with its shortest cross, the shortest in `pb`, the
 * pick underlined in `ink` with how many turns its cross is longer than the shortest.
 */
function ChoiceResult({
  lengths,
  pick,
  colours,
  words,
}: {
  lengths: CrossLengths;
  pick: CrossColour;
  colours: readonly CrossColour[];
  words: Text;
}) {
  const cells = colours.flatMap((colour) => {
    const length = lengths[colour];
    return length === undefined ? [] : [{ colour, length }];
  });
  const shortest = Math.min(...cells.map(({ length }) => length));
  const over = (lengths[pick] ?? shortest) - shortest;
  return (
    <output data-part="choice-result">
      <CrossCells
        cells={cells}
        words={words}
        pick={pick}
        over={over}
        overTip={words.cross.overTip(over)}
      />
    </output>
  );
}
