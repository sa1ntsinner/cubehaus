import type { OllcpCaseData, OllcpGroup } from "@cubehaus/algs/ollcp";
import {
  type AlgPiece,
  algUnits,
  caseMedian,
  type F2lSlot,
  type Grade,
  gradeOf,
  lastSlotTop,
  loadTrainerSet,
  lookalikesFor,
  newCard,
  nextCase,
  pictureOf,
  pllArrows,
  puzzleOf,
  recall,
  recogMedian,
  recolour,
  review,
  reviewQueue,
  roundOf,
  type SetId,
  slotAlg,
  slotMirrored,
  slotOf,
  type TrainerCaseData,
  turnScramble,
  weakCases,
} from "@cubehaus/algs/trainer";
import {
  CROSS_COLOURS,
  type CrossColour,
  crossColourOfFace,
  faceOfCrossColour,
  formatTime,
  isCrossColour,
  newId,
} from "@cubehaus/core";
import {
  holdingFaces,
  holdingWithBottom,
  renameTurns,
} from "@cubehaus/cube/holding";
import type { TrainerAttempt, TrainerCase } from "@cubehaus/storage";
import {
  createContext,
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { AppView, createAppState } from "../app-state";
import { inMacDesktopApp } from "../desktop-widgets";
import { HINT_GAP } from "../gesture-hints";
import { learnGesture, nudge, takeHint } from "../input/hint-store";
import { isTouchScreen } from "../input/touch-screen";
import { DEFAULT_SWIPE, useSwipe } from "../input/use-swipe";
import type { Action } from "../keys/engine";
import { Help } from "../keys/Help";
import { inPhoneApp, vibrate } from "../phone-app";
import { formatRunning } from "../running";
import {
  CaseDiagram,
  SlotDiagram,
  TwoDiagram,
  TwoSides,
} from "../scramble/TrainingDiagrams";
import {
  createTrainingClient,
  heldScramble,
  type TrainingClient,
  type WorkerLike,
} from "../scramble/training-client";
import type { Settings } from "../settings";
import type { Text } from "../text";
import {
  type AlgChoices,
  caseLabels,
  choiceOf,
  chooseAlg,
  type Drill,
  drillElapsed,
  drillStep,
  FAMILIES,
  type Family,
  familyOf,
  learnGroups,
  learntChoices,
  memberOf,
  myAlg,
  ollcpGroupOf,
  ollcpListed,
  ollcpMember,
  otherAlgs,
  parseChoices,
  setWord,
  showCase,
  storedMember,
  type TrainSet,
} from "../train-state";
import { WIDGET_SET_KEY, widgetsChanged } from "../widget-snapshot";
import "../design/safe-area.css";
import "../design/sheet.css";
import "../design/train.css";
import "../input/train-behavior.css";

/**
 * The algorithm trainer: a set (PLL,
 * OLL, COLL) and a mode. Learn shows every case with its picture, how to recognise it and
 * its algorithms, and puts cases into drills. Drill shows the cases due first, as a
 * picture turned and recoloured at random or as a scramble; Review shows only the slow
 * and often missed ones. Attempts are stored apart from solves.
 */
/**
 * The set row: one word per set, or per family of sets (F2L's slots, last slot's two
 * inserts, the 2×2's top in one go over three bottoms), whose member is chosen at the far
 * end of Learn's `All` line.
 */
type Tab = TrainSet | Family;
const SETS: readonly Tab[] = ["pll", "oll", "coll", "f2l", "ls"];
/** The 2×2's sets, in the set row while the 2×2 is chosen. */
const TWO_SETS: readonly Tab[] = ["two-oll", "two-pbl", "two-cll"];
const isTwo = (set: TrainSet) => set.startsWith("two-");
const setName = (id: Tab) => setWord(id);
const isFamily = (tab: Tab): tab is Family => tab in FAMILIES;
/** Every set a route can open: the row's own and each family's members. */
const ROUTE_SETS: readonly TrainSet[] = [...SETS, ...TWO_SETS].flatMap((tab) =>
  isFamily(tab) ? [...FAMILIES[tab].members] : [tab],
);
const FAMILY_IDS = Object.keys(FAMILIES) as Family[];
const isF2l = (set: TrainSet) => slotOf(set) !== null;
const isLastSlot = (set: TrainSet) => set.startsWith("ls-");
/** Sets whose drill scrambles come with their data: the 2×2's, CMLL and OLLCP. */
const shipsScrambles = (set: TrainSet) =>
  isTwo(set) || set === "cmll" || set === "ollcp";
/** The puzzle a set is for (OLLCP is the 3×3's). */
const puzzleFor = (set: TrainSet) => puzzleOf(set as SetId);

/**
 * OLLCP's own module (`@cubehaus/algs/ollcp`): its index, its groups and its pictures.
 * Loaded when OLLCP is first chosen, so the trainer's first screen does not carry it; the
 * algorithms of a group come in a file of their own when the group is asked for.
 */
type OllcpModule = typeof import("@cubehaus/algs/ollcp");
let ollcpModule: OllcpModule | null = null;
/** What OLLCP's first list needs: the groups, each with its OLL tile's picture. */
type OllcpSet = {
  groups: readonly (OllcpGroup & { stickers: string })[];
  /** Every case as listed, without its algorithms. */
  listed: readonly TrainerCaseData[];
  /** The group (its OLL case's number) each case belongs to. */
  groupOf: ReadonlyMap<string, number>;
  loadGroup(oll: number): Promise<readonly OllcpCaseData[]>;
};
async function loadOllcpSet(): Promise<OllcpSet> {
  // The first list is the OLL set's own tiles, so its pictures are the OLL set's.
  const [module, oll] = await Promise.all([
    import("@cubehaus/algs/ollcp"),
    loadTrainerSet("oll"),
  ]);
  ollcpModule = module;
  const groups = module.ollcpGroups().map((group) => {
    const tile = oll.find((c) => c.label === group.label);
    return {
      ...group,
      // The skip has no OLL case: its own top, every sticker up.
      stickers: tile
        ? pictureOf(tile)
        : module.ollcpPicture(group.cases[0] as OllcpGroup["cases"][number]),
    };
  });
  const loads = new Map<number, Promise<readonly OllcpCaseData[]>>();
  return {
    groups,
    listed: module.OLLCP_INDEX.map(ollcpListed),
    groupOf: new Map(module.OLLCP_INDEX.map((c) => [c.id, c.oll])),
    loadGroup(oll) {
      const pending = loads.get(oll);
      if (pending) return pending;
      const load = module.loadOllcpGroup(oll).catch((error: unknown) => {
        loads.delete(oll);
        throw error;
      });
      loads.set(oll, load);
      return load;
    },
  };
}
/** A short word's full name for a screen reader, the word on show first (voice control asks for it). */
const named = (word: string, name: string) =>
  name.includes(word) ? name : `${word}, ${name}`;
const showKey = "trainer.show";
const puzzleKey = "trainer.puzzle";
const poolKey = (set: TrainSet) => `trainer.pool.${set}`;
const algsKey = "trainer.algs";
const splitKey = "trainer.split";
/** F2L's pictures and scrambles on another cross colour (`trainer.f2lCross`). */
const f2lCrossKey = "trainer.f2lCross";
type Mode = "learn" | "drill" | "review";
const MODES: readonly Mode[] = ["learn", "drill", "review"];
type App = ReturnType<typeof createAppState>;

export function parseTrainRoute(hash: string): {
  set: TrainSet;
  mode: Mode;
  /** OLLCP: the group in view (its OLL case's number, 0 for the skip), or its first list. */
  group: number | null;
} {
  const [, , set, mode, group] = hash.split("/");
  const known = ROUTE_SETS.includes(set as TrainSet)
    ? (set as TrainSet)
    : "pll";
  return {
    set: known,
    mode: MODES.includes(mode as Mode) ? (mode as Mode) : "learn",
    group: known === "ollcp" ? ollcpGroupOf(group) : null,
  };
}

const kindOf = (move: string) =>
  /^[xyz]/.test(move)
    ? "rotation"
    : /w|^[MES]|^[rludfb]/.test(move)
      ? "wide"
      : /2'?$/.test(move)
        ? "double"
        : move.endsWith("'")
          ? "prime"
          : "plain";

/**
 * An algorithm as code: its triggers grouped, each move in its hue. It breaks only
 * between units (`algUnits`), so a trigger is never cut and no move stands alone on a
 * line. Real spaces sit between the moves, so a copied algorithm reads as one.
 */
function Alg({ moves }: { moves: string }) {
  const units = algUnits(moves);
  const gap = (piece: AlgPiece) =>
    piece.cont ? " " : <span data-part="train-gap"> </span>;
  return (
    <>
      {/* Read as one line, not move by move. */}
      <span data-heard>{moves}</span>
      <span data-part="train-moves" aria-hidden="true">
        {units.map((unit, u) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: units are positional.
          <Fragment key={u}>
            {u > 0 && gap(unit[0] as AlgPiece)}
            <span data-part="train-unit">
              {unit.map((piece, g) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: pieces are positional.
                <Fragment key={g}>
                  {g > 0 && gap(piece)}
                  <span
                    data-part="train-group"
                    data-trigger={piece.trigger ? "" : undefined}
                  >
                    {piece.moves.map((move, m) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: moves are positional.
                      <Fragment key={m}>
                        {m > 0 && " "}
                        <span data-move={kindOf(move)}>{move}</span>
                      </Fragment>
                    ))}
                  </span>
                </Fragment>
              ))}
            </span>
          </Fragment>
        ))}
      </span>
    </>
  );
}

/** One algorithm in the case view: its U turn before, the moves, the move count. */
function AlgLine({
  alg,
  words,
  children,
}: {
  alg: TrainerCaseData["algs"][number];
  words: Text;
  children?: ReactNode;
}) {
  return (
    <li data-part="train-alg">
      {alg.auf > 0 && (
        <span data-move="plain" data-part="train-auf">
          {["", "U", "U2", "U'"][alg.auf]}
        </span>
      )}
      <Alg moves={alg.moves} />
      <span data-part="train-alg-foot">
        <span data-part="train-count">
          {words.train.moves(alg.metrics.moves)}
        </span>
        {children}
      </span>
    </li>
  );
}

/** The colours of the faces as the person holds the cube, for every picture here. */
const Held = createContext<Record<string, string> | undefined>(undefined);

/**
 * A case's picture: a last-slot case as its top is read (the pair in colour, the corners
 * up or not; seen from above the slot, 26 cases at 60 px looked alike), every other as
 * `pictureOf` draws it after `turns` U turns.
 */
const stickersOf = (set: TrainSet, c: TrainerCaseData, turns = 0) =>
  isLastSlot(set)
    ? lastSlotTop(c)
    : set === "ollcp" && ollcpModule
      ? // The corners in colour; an edge says only whether it shows the top colour.
        ollcpModule.ollcpPicture(c, turns)
      : pictureOf(c, turns);

function Picture({
  set,
  stickers,
  arrows = false,
  tile = false,
}: {
  set: TrainSet;
  stickers: string;
  /** PLL: arrows on the top for which piece goes where. */
  arrows?: boolean;
  /** A tile in Learn's list: a PBL case shows its sides alone, large enough to read. */
  tile?: boolean;
}) {
  const faces = useContext(Held);
  if (tile && set === "two-pbl")
    return <TwoSides stickers={stickers} faces={faces} />;
  if (isTwo(set))
    return (
      <TwoDiagram
        stickers={stickers}
        faces={faces}
        orientationOnly={set === "two-oll"}
      />
    );
  if (isF2l(set) || (isLastSlot(set) && stickers.length === 27))
    return (
      <SlotDiagram
        stickers={stickers}
        faces={faces}
        mirrored={slotMirrored(slotOf(set) ?? "fr")}
      />
    );
  return (
    <CaseDiagram
      stickers={stickers}
      arrows={arrows && set === "pll" ? pllArrows(stickers) : undefined}
      faces={faces}
      orientationOnly={set === "oll"}
      edgesOnTop={set === "coll"}
    />
  );
}

export function Train({
  app,
  view,
  words,
  route,
}: {
  app: App;
  view: AppView;
  words: Text;
  route: string;
}) {
  const t = words.train;
  const { set, mode, group } = parseTrainRoute(route);
  const [loaded, setLoaded] = useState<{
    set: SetId;
    cases: readonly TrainerCaseData[];
  }>();
  // OLLCP: its index (the first list), then each group's algorithms as it is asked for.
  const [ollcp, setOllcp] = useState<OllcpSet | null>(null);
  const [ollcpData, setOllcpData] = useState<
    ReadonlyMap<number, readonly OllcpCaseData[]>
  >(new Map());
  useEffect(() => {
    let stale = false;
    if (set === "ollcp")
      void loadOllcpSet().then((found) => {
        if (!stale) setOllcp((was) => was ?? found);
      });
    else
      void loadTrainerSet(set).then((cases) => {
        if (!stale) setLoaded({ set, cases });
      });
    return () => {
      stale = true;
    };
  }, [set]);
  const store = app.trainer();
  const stored = app.storedSettings();
  const [rows, setRows] = useState<TrainerCase[] | null>(null);
  const membershipWrites = useRef<Promise<unknown>>(Promise.resolve());
  const [pendingWrites, setPendingWrites] = useState(0);
  const active = useRef({ set, store });
  active.current = { set, store };
  const [attempts, setAttempts] = useState<TrainerAttempt[]>([]);
  // How the drill shows a case: remembered, changed at the drill's foot.
  const [byPicture, setByPicture] = useState<boolean | null>(null);
  // The algorithm each case is learnt with, when not the best one (setting `trainer.algs`).
  const [choices, setChoices] = useState<AlgChoices>({});
  // Drill the person's own cases, or the whole set: remembered per set.
  const [whole, setWhole] = useState<boolean | null>(null);
  // Split: the first press marks the case recognised (off unless chosen; remembered).
  const [split, setSplit] = useState(false);
  // The trainer's keys, listed on `?`.
  const [keysOpen, setKeysOpen] = useState(false);
  // Each family's member last chosen (F2L's slot, last slot's insert, the 2×2's bottom):
  // its word in the set row opens that one.
  const [members, setMembers] = useState<Partial<Record<Family, string>>>({});
  // The set each puzzle was left on: the puzzle switch goes back to it.
  const [puzzleWas, setPuzzleWas] = useState<
    Partial<Record<"333" | "222", TrainSet>>
  >({});
  const ru = view.settings.language === "ru";
  // F2L on a chosen cross colour: the whole cube turned so that colour is at the bottom,
  // so every picture recolours by one rotation and each case keeps its slot. The person's
  // own colour (the one held at the bottom) unless another is chosen.
  const [f2lCross, setF2lCross] = useState<CrossColour | null>(null);
  const ownCross = crossColourOfFace(holdingFaces(view.settings.holding).D);
  const cross = f2lCross ?? ownCross;
  const holding =
    isF2l(set) && cross !== ownCross
      ? holdingWithBottom(view.settings.holding, faceOfCrossColour(cross))
      : view.settings.holding;
  const faces = useMemo(() => holdingFaces(holding), [holding]);

  // While the database opens there is no store yet: wait for it rather than draw the
  // cases without it and again with it, which would drop a case opened in between.
  const opening = view.dbState === null;
  useEffect(() => {
    let stale = false;
    setRows(null);
    if (!store && opening) return;
    if (!store) {
      setRows([]);
      setByPicture(true);
      setWhole(false);
      return;
    }
    void Promise.all([
      membershipWrites.current.then(() => store.cases(set)),
      store.attempts(set),
      stored?.get(showKey) ?? null,
      stored?.get(poolKey(set)) ?? null,
      stored?.get(algsKey) ?? null,
      stored?.get(splitKey) ?? null,
      stored?.get(puzzleKey) ?? null,
      Promise.all(FAMILY_IDS.map((f) => stored?.get(FAMILIES[f].key) ?? null)),
      stored?.get(f2lCrossKey) ?? null,
    ]).then(([c, a, show, pool, algs, splitOn, left, chosen, crossWas]) => {
      if (stale) return;
      setRows(c);
      setAttempts(a);
      setByPicture(show !== "scramble");
      setWhole(pool === "all");
      setChoices(parseChoices(algs));
      setSplit(splitOn === "on");
      setMembers(
        Object.fromEntries(
          FAMILY_IDS.map((f, i) => [f, storedMember(f, chosen[i] ?? null)]),
        ),
      );
      setF2lCross(isCrossColour(crossWas) ? crossWas : null);
      // The set last left on the other puzzle (setting `trainer.puzzle`).
      if (left && ROUTE_SETS.includes(left as TrainSet))
        setPuzzleWas((was) => ({
          ...was,
          [puzzleFor(left as TrainSet)]: left as TrainSet,
        }));
    });
    return () => {
      stale = true;
    };
  }, [store, stored, set, opening]);

  useEffect(() => {
    function close(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.key === "?" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setKeysOpen((open) => !open);
        return;
      }
      if (event.key !== "Escape") return;
      location.hash = "#/";
    }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  // The set a word in the row opens: a family's member last chosen, or the set itself.
  const setOfTab = (id: Tab): TrainSet =>
    isFamily(id) ? memberOf(id, storedMember(id, members[id] ?? null)) : id;
  // The trainer widget (phone, Mac desktop) shows one set (setting `trainer.widget`),
  // chosen by a long press on the set's word. OLLCP is listed a group at a time, so its
  // word gives OLL.
  const phone = inPhoneApp() || inMacDesktopApp();
  const widgetSetOf = (id: Tab): string => {
    const member = setOfTab(id);
    return member === "ollcp" ? "oll" : member;
  };
  const [widgetSet, setWidgetSet] = useState<string | null>(null);
  const [setMenu, setSetMenu] = useState<Tab | null>(null);
  // The sets' sheet (the narrowest phone), opened from the open set's word.
  const [setSheet, setSetSheet] = useState(false);
  const setOpener = useRef<HTMLButtonElement>(null);
  const setSheetBox = useRef<HTMLDialogElement>(null);
  const closeSetSheet = () => {
    setSetSheet(false);
    setSetMenu(null);
    requestAnimationFrame(() =>
      setOpener.current?.focus({ preventScroll: true }),
    );
  };
  useEffect(() => {
    if (setSheet && !setSheetBox.current?.open)
      setSheetBox.current?.showModal();
  }, [setSheet]);
  const swallowSetClick = useRef(false);
  useEffect(() => {
    if (!phone || !stored) return;
    let stale = false;
    void stored.get(WIDGET_SET_KEY).then((value) => {
      if (!stale) setWidgetSet(value || null);
    });
    return () => {
      stale = true;
    };
  }, [phone, stored]);
  // The cases as stored changed (put in drills, taken out, rescheduled by an attempt).
  useEffect(() => {
    if (phone && rows) widgetsChanged();
  }, [phone, rows]);
  const chooseWidgetSet = (next: string | null) => {
    setWidgetSet(next);
    void stored?.set(WIDGET_SET_KEY, next ?? "").then(widgetsChanged);
  };
  function pressSet(id: Tab, down: ReactPointerEvent) {
    const { clientX, clientY, pointerId } = down;
    const stop = () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    const move = (event: PointerEvent) => {
      if (
        event.pointerId === pointerId &&
        Math.hypot(event.clientX - clientX, event.clientY - clientY) > 8
      )
        stop();
    };
    // As long as a session tile's press.
    const timer = setTimeout(() => {
      stop();
      swallowSetClick.current = true;
      vibrate([10]);
      setSetMenu(id);
    }, 450);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }
  // The menu stays on screen (moved in from a side), and a press elsewhere closes it.
  const setMenuBox = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const box = element.getBoundingClientRect();
    const margin = 8;
    const shift =
      box.left < margin
        ? margin - box.left
        : box.right > innerWidth - margin
          ? innerWidth - margin - box.right
          : 0;
    if (shift) element.style.setProperty("--shift", `${shift}px`);
  }, []);
  useEffect(() => {
    if (setMenu === null) return;
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-part="switch-menu"]')
      )
        return;
      setSetMenu(null);
      swallowSetClick.current = false;
    };
    // After the press that opened it has ended.
    const armed = setTimeout(
      () => window.addEventListener("pointerdown", close),
      0,
    );
    return () => {
      clearTimeout(armed);
      window.removeEventListener("pointerdown", close);
    };
  }, [setMenu]);

  // A mode keeps OLLCP's group; another set, or the way back to the first list, leaves it.
  const go = (next: { set?: TrainSet; mode?: Mode; group?: number | null }) => {
    const to = next.set ?? set;
    const at =
      next.group !== undefined ? next.group : to === set ? group : null;
    location.hash = `#/train/${to}/${next.mode ?? mode}${
      to === "ollcp" && at !== null ? `/${at}` : ""
    }`;
  };

  // An open group loads as a unit. At the first level, the practice order needs only
  // the index, and the chosen case's algorithms arrive before the other groups.
  useEffect(() => {
    if (set !== "ollcp" || !ollcp || group === null || ollcpData.has(group))
      return;
    let stale = false;
    void ollcp.loadGroup(group).then((found) => {
      if (!stale) setOllcpData((was) => new Map(was).set(group, found));
    });
    return () => {
      stale = true;
    };
  }, [set, group, ollcp, ollcpData]);
  const ollcpGroup = ollcp?.groups.find((g) => g.oll === group) ?? null;
  const ollcpLoaded = group === null || ollcpData.has(group);
  const cases = useMemo(() => {
    if (set !== "ollcp") return loaded?.set === set ? loaded.cases : null;
    if (!ollcp) return null;
    return ollcpGroup
      ? (ollcpData.get(ollcpGroup.oll) ?? ollcpGroup.cases.map(ollcpListed))
      : ollcp.listed;
  }, [set, loaded, ollcp, ollcpGroup, ollcpData]);
  const loadPracticeCase = useMemo(() => {
    if (set !== "ollcp" || group !== null || !ollcp || mode === "learn")
      return undefined;
    const groups = whole
      ? ollcp.groups.map((g) => g.oll)
      : [...new Set(rows?.map((row) => ollcp.groupOf.get(row.caseId)))];
    let prefetching = false;
    return async (id: string) => {
      const oll = ollcp.groupOf.get(id);
      if (oll === undefined) return undefined;
      const found = await ollcp.loadGroup(oll);
      if (!prefetching) {
        prefetching = true;
        for (const other of groups)
          if (other !== undefined && other !== oll)
            void ollcp.loadGroup(other).catch(() => {
              // The case can try again when drawn.
            });
      }
      return found.find((c) => c.id === id);
    };
  }, [set, group, mode, ollcp, whole, rows]);
  // A drill of one group holds that group's cards alone.
  const scoped = useMemo(() => {
    if (!ollcpGroup || rows === null) return rows;
    const ids = new Set(ollcpGroup.cases.map((c) => c.id));
    return rows.filter((r) => ids.has(r.caseId));
  }, [ollcpGroup, rows]);
  const learning = useMemo(() => new Set(rows?.map((r) => r.caseId)), [rows]);
  const bottoms = words.train.memberWords["two-cll"];
  // OLLCP's group with nothing to orient, and its cases (`Skip 1`).
  const skipWord = words.train.skip;
  const labels = useMemo(
    () => caseLabels(set, cases ?? [], bottoms, skipWord),
    [set, cases, bottoms, skipWord],
  );
  // What each case shows: the person's own choice, else the algorithm they learnt it with.
  const learnt = useMemo(
    () => learntChoices({}, set, attempts),
    [set, attempts],
  );
  const shownChoices = useMemo(
    () => learntChoices(choices, set, attempts),
    [choices, set, attempts],
  );
  const family = familyOf(set);

  const otherPuzzle = puzzleFor(set) === "222" ? "333" : "222";
  const rowSets = isTwo(set) ? TWO_SETS : SETS;
  // A set's word, in the row or in the sheet; `menu` says where its long press menu goes.
  const setItem = (id: Tab, menu: boolean) => {
    const word = (
      <button
        key={id}
        type="button"
        data-action="train-set"
        data-set={id}
        aria-pressed={id === family}
        onPointerDown={phone ? (event) => pressSet(id, event) : undefined}
        onClick={() => {
          if (swallowSetClick.current) {
            swallowSetClick.current = false;
            return;
          }
          if (setSheet) closeSetSheet();
          go({ set: setOfTab(id) });
        }}
      >
        {setName(id)}
      </button>
    );
    // The phone app only: a long press on the word opens its one action, the session
    // tiles' menu.
    if (!phone) return word;
    const chosen = widgetSet === widgetSetOf(id);
    return (
      <span key={id} data-part="train-set-item">
        {word}
        {menu && setMenu === id && (
          <span data-part="switch-menu" role="menu" ref={setMenuBox}>
            <button
              type="button"
              role="menuitem"
              data-action="train-widget"
              onClick={() => {
                setSetMenu(null);
                chooseWidgetSet(chosen ? null : widgetSetOf(id));
              }}
            >
              {chosen ? t.widgetRemove : t.widgetShow}
            </button>
          </span>
        )}
      </span>
    );
  };
  return (
    <Held.Provider value={faces}>
      <main data-no-timer data-part="train" data-mode={mode}>
        <nav>
          <a href="#/" data-action="train-close">
            {words.timer}
          </a>
        </nav>
        <h1>{t.title}</h1>
        <div data-part="train-bar">
          <p
            data-part="train-sets"
            data-many={rowSets.length > 3 ? "" : undefined}
          >
            {rowSets.map((id) => setItem(id, !setSheet))}
            {/* The narrowest phone: the set's own word, which opens the full list. */}
            <button
              ref={setOpener}
              type="button"
              data-action="train-set-open"
              aria-haspopup="dialog"
              aria-expanded={setSheet}
              onClick={() => setSetSheet(true)}
            >
              {setName(family as Tab)}
            </button>
          </p>
          <p data-part="train-modes">
            {MODES.map((id) => (
              <button
                key={id}
                type="button"
                data-action="train-mode"
                data-mode={id}
                aria-pressed={id === mode}
                onClick={() => go({ mode: id })}
              >
                {t.modes[id]}
              </button>
            ))}
            {/* The other puzzle, one quiet word at the bar's far end: the sets already say
                which puzzle is open. */}
            <button
              type="button"
              data-action="train-puzzle"
              data-puzzle={otherPuzzle}
              aria-label={t.puzzleNames[otherPuzzle]}
              onClick={() => {
                void stored?.set(puzzleKey, set);
                setPuzzleWas((was) => ({ ...was, [puzzleFor(set)]: set }));
                go({
                  set:
                    puzzleWas[otherPuzzle] ??
                    (otherPuzzle === "222" ? "two-oll" : "pll"),
                });
              }}
            >
              {t.puzzles[otherPuzzle]}
            </button>
          </p>
        </div>
        {cases === null ||
        rows === null ||
        scoped === null ||
        byPicture === null ||
        whole === null ? null : mode === "learn" ? (
          <Learn
            key={set}
            set={set}
            cases={cases}
            ollcp={
              set === "ollcp" && ollcp
                ? {
                    groups: ollcp.groups,
                    open: ollcpGroup,
                    loading: !ollcpLoaded,
                    skipWord,
                    onGroup: (oll) => go({ group: oll }),
                  }
                : null
            }
            learning={learning}
            attempts={attempts}
            words={words}
            ru={ru}
            precision={view.settings.precision}
            labels={labels}
            choices={shownChoices}
            onChoose={(c, moves) => {
              const next = chooseAlg(choices, set, c, moves, learnt);
              setChoices(next);
              void stored?.set(algsKey, JSON.stringify(next));
            }}
            cross={isF2l(set) ? cross : null}
            crossOrder={crossOrder(ownCross)}
            onCross={(next) => {
              setF2lCross(next);
              void stored?.set(f2lCrossKey, next);
            }}
            onMember={(f, next) => {
              setMembers((was) => ({ ...was, [f]: next }));
              void stored?.set(FAMILIES[f].key, next);
              go({ set: memberOf(f, next as never) });
            }}
            onDrill={(added, removed) => {
              if (!store)
                return Promise.reject(new Error("Database unavailable"));
              setPendingWrites((count) => count + 1);
              const write = membershipWrites.current.then(async () => {
                const now = Date.now();
                const cards = await Promise.all(
                  added.map(async (caseId) => ({
                    caseId,
                    ...(await newCard(caseId, now)),
                  })),
                );
                await store.setCaseMembership(set, cards, removed);
                const next = await store.cases(set);
                if (
                  active.current.set === set &&
                  active.current.store === store
                )
                  setRows(next);
              });
              membershipWrites.current = write.catch(() => {});
              return write.finally(() =>
                setPendingWrites((count) => count - 1),
              );
            }}
          />
        ) : pendingWrites > 0 || (set === "ollcp" && !ollcpLoaded) ? null : (
          <Practice
            key={`${set}/${group}/${mode}/${whole}`}
            set={set}
            review={mode === "review"}
            cases={cases}
            loadCase={loadPracticeCase}
            rows={scoped}
            attempts={attempts}
            words={words}
            precision={view.settings.precision}
            labels={labels}
            running={view.settings.running}
            byPicture={byPicture}
            choices={shownChoices}
            holding={holding}
            whole={whole}
            split={split}
            paused={keysOpen}
            onSplit={(next) => {
              setSplit(next);
              void stored?.set(splitKey, next ? "on" : "off");
            }}
            onWhole={(next) => {
              setWhole(next);
              void stored?.set(poolKey(set), next ? "all" : "mine");
            }}
            onShow={(picture) => {
              setByPicture(picture);
              void stored?.set(showKey, picture ? "picture" : "scramble");
            }}
            onSaved={(nextRows, nextAttempts) => {
              setRows(nextRows);
              setAttempts(nextAttempts);
            }}
            app={app}
          />
        )}
      </main>
      {setSheet && (
        <dialog
          ref={setSheetBox}
          data-part="train-set-sheet"
          aria-label={t.sets}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            // Before the screen's own Escape, which leaves Algorithms.
            event.preventDefault();
            closeSetSheet();
          }}
          onCancel={(event) => {
            event.preventDefault();
            closeSetSheet();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeSetSheet();
          }}
        >
          <button
            type="button"
            data-action="dialog-close"
            onClick={closeSetSheet}
          >
            {t.title}
          </button>
          <ul data-part="train-set-list">
            {rowSets.map((id) => (
              <li key={id}>{setItem(id, true)}</li>
            ))}
          </ul>
        </dialog>
      )}
      {keysOpen && (
        <TrainKeys words={words} ru={ru} onClose={() => setKeysOpen(false)} />
      )}
    </Held.Provider>
  );
}

/**
 * The trainer's keys, as the timer's Keys sheet lists its own. They are fixed (Space, M),
 * so they are listed as they are rather than taken from the keymap.
 */
function TrainKeys({
  words,
  ru,
  onClose,
}: {
  words: Text;
  ru: boolean;
  onClose(): void;
}) {
  useEffect(() => {
    // Esc and ? close the list first, before the trainer hears them.
    function key(event: KeyboardEvent) {
      if (event.key !== "Escape" && event.key !== "?") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    }
    window.addEventListener("keydown", key, { capture: true });
    return () => window.removeEventListener("keydown", key, { capture: true });
  }, [onClose]);
  const bindings = words.train.keys.map(([keys, title], i) => ({
    action: {
      id: `train.${i}`,
      title: { en: title, ru: title },
      keys: keys.split(" "),
      when: [],
      run() {},
    } satisfies Action,
    keys: keys.split(" "),
  }));
  return (
    <Help
      bindings={bindings}
      language={ru ? "ru" : "en"}
      title={words.keysTitle}
      closeLabel={words.train.title}
      onClose={onClose}
    />
  );
}

const wideLearn = () => matchMedia("(min-width: 900px)");
const isWideLearn = () => wideLearn().matches;
/** A family's word just pressed: the next list focuses it (the list is new, the word too). */
let memberFocus: { set: TrainSet; id: string } | null = null;

function watchWideLearn(change: () => void) {
  const media = wideLearn();
  media.addEventListener("change", change);
  return () => media.removeEventListener("change", change);
}

function Learn({
  set,
  cases,
  learning,
  attempts,
  words,
  ru,
  precision,
  labels,
  onDrill,
  choices,
  onChoose,
  onMember,
  cross,
  crossOrder: order,
  onCross,
  ollcp,
}: {
  /** F2L: the cross colour the pictures are drawn for, and the order a press steps in. */
  cross: CrossColour | null;
  crossOrder: readonly CrossColour[];
  onCross(next: CrossColour): void;
  /**
   * OLLCP's two levels: its groups as the OLL set's tiles, then the open group's cases
   * (`cases`) in the list's place. Null for every other set.
   */
  ollcp: {
    groups: readonly (OllcpGroup & { stickers: string })[];
    open: OllcpGroup | null;
    /** The open group's algorithms are on their way. */
    loading: boolean;
    /** The name of the group with nothing to orient. */
    skipWord: string;
    onGroup(oll: number | null): void;
  } | null;
  set: TrainSet;
  cases: readonly TrainerCaseData[];
  learning: ReadonlySet<string>;
  attempts: readonly TrainerAttempt[];
  words: Text;
  ru: boolean;
  precision: 2 | 3;
  /** Each case's name (F2L numbered in the learner's order). */
  labels: ReadonlyMap<string, string>;
  /** Puts the cases into the drills, or takes them out. */
  onDrill(added: readonly string[], removed: readonly string[]): Promise<void>;
  choices: AlgChoices;
  onChoose(c: TrainerCaseData, moves: string): void;
  /** A family's member: F2L's slot, last slot's insert, the 2×2's bottom. */
  onMember(family: Family, choice: string): void;
}) {
  const t = words.train;
  const labelOf = (c: TrainerCaseData) => labels.get(c.id) ?? c.label;
  // Under its group's heading an OLLCP case's tile is named by its number alone.
  const tileLabel = (c: TrainerCaseData) =>
    ollcp ? ollcpMember(labelOf(c)) : labelOf(c);
  const family = familyOf(set);
  const groupName = (g: OllcpGroup) =>
    g.oll === 0 ? ollcp?.skipWord : g.label;
  // OLLCP's first list: its groups, no cases yet.
  const levelOne = ollcp !== null && ollcp.open === null;
  const openGroup = ollcp?.open ?? null;
  // F2L in the learner's order and its four groups; OLLCP's open group under its OLL
  // case's name; every other set as one list.
  const groups = useMemo(() => {
    const found = learnGroups(set);
    const byId = new Map(cases.map((c) => [c.id, c]));
    return found
      ? found.map((g) => ({
          id: g.id,
          name: ru ? g.ru : g.en,
          cases: g.ids.map((id) => byId.get(id) as TrainerCaseData),
        }))
      : [{ id: "all", name: null, cases }];
  }, [set, cases, ru]);
  const [open, setOpen] = useState<string | null>(null);
  // The other algorithms of the open case, one tap away.
  const [more, setMore] = useState(false);
  // Layer each pending edit over the last committed rows, including during a quick
  // second tap. Dropping a failed edit restores the affected rings.
  const [pending, setPending] = useState<
    readonly ReadonlyMap<string, boolean>[]
  >([]);
  const [writeFailed, setWriteFailed] = useState(false);
  const selected = useMemo(() => {
    const selected = new Set(learning);
    for (const edit of pending)
      for (const [id, on] of edit)
        if (on) selected.add(id);
        else selected.delete(id);
    return selected;
  }, [learning, pending]);
  const changeDrill = async (
    added: readonly string[],
    removed: readonly string[],
  ) => {
    const edit = new Map<string, boolean>();
    for (const id of removed) edit.set(id, false);
    for (const id of added) edit.set(id, true);
    setPending((was) => [...was, edit]);
    setWriteFailed(false);
    try {
      await onDrill(added, removed);
    } catch {
      setWriteFailed(true);
    } finally {
      setPending((was) => was.filter((item) => item !== edit));
    }
  };
  const twoLook = cases
    .filter((c) => c.subsets.includes("2-look"))
    .map((c) => c.id);
  const all = cases.map((c) => c.id);
  const inDrills = (ids: readonly string[]) =>
    ids.length > 0 && ids.every((id) => selected.has(id));
  const current = cases.find((c) => c.id === open) ?? null;
  const twoLookOnly = inDrills(twoLook) && selected.size === twoLook.length;

  // A case swiped sideways goes into the drills, or out of them.
  const caseList = useRef<HTMLElement>(null);
  // Opened from a family's word: that word keeps the keyboard.
  // The list can mount twice while the set loads, so the word is kept a moment (or until
  // another set's list mounts).
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as the list mounts.
  useEffect(() => {
    if (memberFocus?.set !== set) {
      memberFocus = null;
      return;
    }
    caseList.current
      ?.querySelector<HTMLElement>(
        `[data-part="train-slot"] [data-member="${memberFocus.id}"]`,
      )
      ?.focus({ preventScroll: true });
    const was = memberFocus;
    setTimeout(() => {
      if (memberFocus === was) memberFocus = null;
    }, 1500);
  }, []);
  const toggleDrill = (id: string) =>
    selected.has(id) ? changeDrill([], [id]) : changeDrill([id], []);
  useSwipe(caseList, {
    config: { ...DEFAULT_SWIPE, directions: ["left", "right"], commitPx: 56 },
    // A tile has a neighbour 12 px away: it shows the way, it does not travel far.
    travel: 0.4,
    wordAt: "above",
    subject: (element) =>
      element.closest<HTMLElement>("[data-part='train-case-list'] > li"),
    // OLLCP's groups are not cases: nothing to put in the drills there.
    enabled: () => !levelOne,
    word: (_direction, line) =>
      selected.has(line.dataset.caseId ?? "") ? t.remove : t.add,
    onCommit: (_direction, line) => {
      const id = line.dataset.caseId;
      if (!id) return;
      void toggleDrill(id);
      learnGesture("learn");
    },
  });
  // On a touch screen, a few visits say how, once each.
  const [learnHint] = useState(() =>
    isTouchScreen() && !ollcp ? takeHint(["learn"], HINT_GAP) : null,
  );
  useEffect(() => {
    if (!learnHint) return;
    return nudge(
      caseList.current?.querySelector("[data-part='train-case-list'] > li"),
      "right",
    );
  }, [learnHint]);

  // Narrow, the case takes the list's place: show it from its top, and on the way back
  // the list where it was left.
  const listScroll = useRef(0);
  const caseTitle = useRef<HTMLHeadingElement>(null);
  const wide = useSyncExternalStore(watchWideLearn, isWideLearn);
  const casePanel = useRef<HTMLElement>(null);
  const openTile = useRef<HTMLButtonElement>(null);
  const openPick = useRef<HTMLInputElement>(null);
  const caseTabIndex = wide ? -1 : undefined;

  // Insert the side panel between the open tile's picture and its checkbox.
  const tabThroughCase = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!wide || event.key !== "Tab" || event.defaultPrevented) return;
    const controls = Array.from(
      casePanel.current?.querySelectorAll<HTMLButtonElement>(
        "button:enabled",
      ) ?? [],
    ).filter((button) => button.getClientRects().length > 0);
    const stops: (EventTarget | null)[] = [
      openTile.current,
      ...controls,
      openPick.current,
    ];
    const at = stops.indexOf(event.target);
    const next = stops[at + (event.shiftKey ? -1 : 1)];
    if (at < 0 || !(next instanceof HTMLElement)) return;
    event.preventDefault();
    next.focus();
  };
  const choose = (id: string | null, byKey = false) => {
    const narrow = matchMedia("(max-width: 899px)").matches;
    if (id && !open) listScroll.current = window.scrollY;
    setOpen(id);
    setMore(false);
    const was = open;
    requestAnimationFrame(() => {
      if (narrow) window.scrollTo({ top: id ? 0 : listScroll.current });
      // Narrow, the list and the tile that had the keyboard have gone: the keyboard goes
      // into the case with it. Escape comes back to the tile.
      if (id && byKey && narrow)
        caseTitle.current?.focus({ preventScroll: true });
      // Back on the list, the keyboard is on the case it came from (beside the list too:
      // the case's column it was in has gone).
      if (!id && was)
        document
          .querySelector<HTMLElement>(
            `[data-part="train-case-list"] [data-case-id="${was}"] button`,
          )
          ?.focus({ preventScroll: true });
    });
  };

  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  useEffect(() => {
    if (!open) return;
    function back(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      chooseRef.current(null);
    }
    // Captured, so it comes before the screen's own Escape, which leaves Algorithms.
    window.addEventListener("keydown", back, true);
    return () => window.removeEventListener("keydown", back, true);
  }, [open]);

  // OLLCP: a group takes the list's place, shown from its top; on the way back the first
  // list stands where it was left and the keyboard is on the group it came from.
  const groupId = useId();
  const groupAt = openGroup?.oll ?? null;
  const groupWas = useRef(groupAt);
  const groupsScroll = useRef(0);
  const groupByKey = useRef(false);
  const groupTitle = useRef<HTMLHeadingElement>(null);
  const toGroup = (oll: number, byKey: boolean) => {
    groupsScroll.current = window.scrollY;
    groupByKey.current = byKey;
    ollcp?.onGroup(oll);
  };
  useLayoutEffect(() => {
    const was = groupWas.current;
    groupWas.current = groupAt;
    if (was === groupAt) return;
    setOpen(null);
    setMore(false);
    if (groupAt !== null) {
      window.scrollTo({ top: 0 });
      // The tile that had the keyboard has gone: the keyboard goes into the group.
      if (groupByKey.current)
        groupTitle.current?.focus({ preventScroll: true });
      groupByKey.current = false;
      return;
    }
    window.scrollTo({ top: groupsScroll.current });
    document
      .querySelector<HTMLElement>(
        `[data-part="train-case-list"] [data-group="${was}"] button`,
      )
      ?.focus({ preventScroll: true });
  }, [groupAt]);
  const leaveGroup = ollcp?.onGroup;
  const leaveRef = useRef(leaveGroup);
  leaveRef.current = leaveGroup;
  useEffect(() => {
    // With a case open, Escape closes the case first (above).
    if (groupAt === null || open) return;
    function back(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      leaveRef.current?.(null);
    }
    window.addEventListener("keydown", back, true);
    return () => window.removeEventListener("keydown", back, true);
  }, [groupAt, open]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Tab is delegated from the tile and case controls.
    <div
      data-part="train-learn"
      data-open={current ? "" : undefined}
      onKeyDown={tabThroughCase}
    >
      <section data-part="train-cases" ref={caseList}>
        {learnHint && (
          <p data-part="gesture-hint" data-input="touch">
            {words.gestures.hint.learn}
          </p>
        )}
        {openGroup && (
          // The way back to OLLCP's first list, in the form of the screen's own.
          <a
            href={`#/train/${set}/learn`}
            data-action="train-group-close"
            onClick={(click) => {
              click.preventDefault();
              ollcp?.onGroup(null);
            }}
          >
            {setName(set)}
          </a>
        )}
        <p data-part="train-filter">
          {/* Presets: the one that describes the drills stands pressed, and pressed
              again it empties them, so no third word is needed for none. */}
          <button
            type="button"
            data-action="train-all"
            aria-pressed={inDrills(all)}
            onClick={() =>
              void (inDrills(all) ? changeDrill([], all) : changeDrill(all, []))
            }
          >
            {t.all}
          </button>
          {twoLook.length > 0 && (
            <button
              type="button"
              data-action="train-two-look"
              aria-pressed={twoLookOnly}
              onClick={() =>
                twoLookOnly
                  ? void changeDrill([], all)
                  : void changeDrill(
                      twoLook,
                      all.filter((id) => !twoLook.includes(id)),
                    )
              }
            >
              {t.twoLook}
            </button>
          )}
          {isFamily(family) && (
            // The family's member, at the line's far end, apart from what goes in drills.
            // F2L keeps its slot words and data hooks.
            <span data-part="train-slot" data-family={family}>
              {FAMILIES[family].choices.map((id) => (
                <button
                  key={id}
                  type="button"
                  data-action={family === "f2l" ? "train-slot" : "train-member"}
                  data-slot={family === "f2l" ? id : undefined}
                  data-member={id}
                  aria-label={
                    family === "f2l"
                      ? named(
                          t.slots[id as F2lSlot],
                          t.slotNames[id as F2lSlot],
                        )
                      : named(
                          t.memberWords[family][id as never],
                          t.members[family][id as never],
                        )
                  }
                  aria-pressed={choiceOf(family, set) === id}
                  onClick={() => {
                    // The member opens as a new list: the keyboard stays on its word.
                    if (choiceOf(family, set) !== id)
                      memberFocus = { set: memberOf(family, id as never), id };
                    onMember(family, id);
                  }}
                >
                  {family === "f2l"
                    ? t.slots[id as F2lSlot]
                    : t.memberWords[family][id as never]}
                </button>
              ))}
            </span>
          )}
        </p>
        {writeFailed && (
          <p data-part="db-state" data-kind="failed" role="alert">
            {words.dbFailed}
          </p>
        )}
        {levelOne && (
          // OLLCP's groups, each the OLL set's own tile; a group opens in the list's place.
          <ul data-part="train-case-list" data-level="groups">
            {ollcp.groups.map((g) => (
              <li key={g.oll} data-group={g.oll}>
                <button
                  type="button"
                  id={`${groupId}-${g.oll}`}
                  aria-label={groupName(g)}
                  onClick={(click) => toGroup(g.oll, click.detail === 0)}
                >
                  <Picture set="oll" stickers={g.stickers} tile />
                </button>
                {/* The name belongs to the picture: a press on it opens the group too. */}
                <label data-part="train-pick" htmlFor={`${groupId}-${g.oll}`}>
                  {groupName(g)}
                </label>
              </li>
            ))}
          </ul>
        )}
        {openGroup && (
          <h2 data-part="train-group-name" ref={groupTitle} tabIndex={-1}>
            {groupName(openGroup)}
          </h2>
        )}
        {(levelOne ? [] : groups).map((group) => (
          <Fragment key={group.id}>
            {group.name && <h2 data-part="train-group-name">{group.name}</h2>}
            <ul data-part="train-case-list">
              {group.cases.map((c) => (
                <li
                  key={c.id}
                  data-case-id={c.id}
                  data-learning={selected.has(c.id) ? "" : undefined}
                >
                  <button
                    type="button"
                    ref={c.id === open ? openTile : undefined}
                    aria-label={labelOf(c)}
                    aria-current={c.id === open ? "true" : undefined}
                    data-learning={selected.has(c.id) ? "" : undefined}
                    onClick={(click) => choose(c.id, click.detail === 0)}
                  >
                    <Picture set={set} stickers={stickersOf(set, c)} tile />
                  </button>
                  <label data-part="train-pick">
                    <input
                      type="checkbox"
                      ref={c.id === open ? openPick : undefined}
                      data-action="train-pick"
                      aria-label={ollcp ? labelOf(c) : undefined}
                      checked={selected.has(c.id)}
                      onChange={() => void toggleDrill(c.id)}
                    />
                    <span>{tileLabel(c)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </Fragment>
        ))}
      </section>
      {current && (
        <article
          ref={casePanel}
          data-part="train-case"
          data-case-id={current.id}
        >
          <button
            type="button"
            data-action="train-case-close"
            onClick={() => choose(null)}
          >
            {t.back}
          </button>
          <div data-part="train-case-head">
            <Picture set={set} stickers={stickersOf(set, current)} arrows />
            {/* Last slot: beside its top, the cube from above the slot, the pair ready. */}
            {isLastSlot(set) && current.pictures && (
              <Picture set={set} stickers={current.pictures.slot} />
            )}
            <div data-part="train-case-title">
              <h2 ref={caseTitle} tabIndex={-1}>
                {labelOf(current)}
              </h2>
              {family === "f2l" && cross && (
                // The cross colour every F2L picture is drawn for, as the timer marks a
                // cross: its sticker and its name. A press steps to the next colour (the
                // person's own, its opposite, then the other pairs) and the list follows.
                <button
                  type="button"
                  tabIndex={caseTabIndex}
                  data-action="train-cross"
                  data-colour={cross}
                  aria-label={t.crossOn(words.cross.name[cross])}
                  onClick={() =>
                    onCross(
                      order[(order.indexOf(cross) + 1) % order.length] ?? cross,
                    )
                  }
                >
                  <span
                    data-part="cross-swatch"
                    data-face={faceOfCrossColour(cross)}
                    aria-hidden="true"
                  />
                  <span data-part="train-cross-name">
                    {words.cross.mark(words.cross.name[cross])}
                  </span>
                </button>
              )}
            </div>
          </div>
          <CaseNumbers
            attempts={attempts}
            caseId={current.id}
            words={words}
            precision={precision}
          />
          {/* One line: how to recognise it, or for F2L what the algorithm does. */}
          {(current.recognise ?? current.idea) && (
            <p data-part="train-recognise">
              {ru
                ? (current.recognise ?? current.idea)?.ru
                : (current.recognise ?? current.idea)?.en}
            </p>
          )}
          {current.algs.length === 0 && ollcp?.loading ? (
            // The group's algorithms are on their way: their room is kept, so nothing
            // under them moves when they come.
            <div data-part="train-algs-wait" aria-hidden="true">
              <ol data-part="train-algs">
                <AlgLine alg={WAITING_ALG} words={words} />
              </ol>
              <button
                type="button"
                data-action="train-more"
                tabIndex={-1}
                disabled
              >
                {t.more(1)}
              </button>
            </div>
          ) : current.algs.length === 0 ? (
            <p data-part="train-recognise">{t.noAlg}</p>
          ) : (
            <>
              <ol data-part="train-algs">
                <AlgLine alg={myAlg(current, choices, set)} words={words} />
              </ol>
              {otherAlgs(current, choices, set).length > 0 && (
                <>
                  <button
                    type="button"
                    tabIndex={caseTabIndex}
                    data-action="train-more"
                    aria-expanded={more}
                    onClick={() => setMore(!more)}
                  >
                    {t.more(otherAlgs(current, choices, set).length)}
                  </button>
                  {more && (
                    <ol data-part="train-algs" data-others="">
                      {otherAlgs(current, choices, set).map((alg) => (
                        <AlgLine key={alg.moves} alg={alg} words={words}>
                          <button
                            type="button"
                            tabIndex={caseTabIndex}
                            data-action="train-use"
                            onClick={(event) => {
                              // The chosen line moves up and its Use goes: the keyboard
                              // stays on the word that lists the others.
                              event.currentTarget
                                .closest('[data-part="train-case"]')
                                ?.querySelector<HTMLElement>(
                                  '[data-action="train-more"]',
                                )
                                ?.focus();
                              onChoose(current, alg.moves);
                            }}
                          >
                            {t.use}
                          </button>
                        </AlgLine>
                      ))}
                    </ol>
                  )}
                </>
              )}
            </>
          )}
          <p data-part="train-case-actions">
            {selected.has(current.id) ? (
              <button
                type="button"
                data-action="train-remove"
                onClick={() => void changeDrill([], [current.id])}
              >
                {t.remove}
              </button>
            ) : (
              <button
                type="button"
                data-action="train-add"
                onClick={() => void changeDrill([current.id], [])}
              >
                {t.add}
              </button>
            )}
          </p>
        </article>
      )}
    </div>
  );
}

/** Stands in an algorithm's place, unseen, while an OLLCP group loads: two lines' worth. */
const WAITING_ALG = {
  moves: "R U R' U' R U R' U' R U R' U' R U",
  auf: 0,
  metrics: { moves: 14 },
} as TrainerCaseData["algs"][number];

/**
 * The case's own medians where they help: recognition and execution over its last
 * attempts, each once it has three. Nothing before that.
 */
function CaseNumbers({
  attempts,
  caseId,
  words,
  precision,
}: {
  attempts: readonly TrainerAttempt[];
  caseId: string;
  words: Text;
  precision: 2 | 3;
}) {
  const recog = recogMedian(attempts, caseId);
  const exec = caseMedian(attempts, caseId);
  if (recog === null && exec === null) return null;
  const format = (ms: number) => formatTime(ms, { precision });
  return (
    <p data-part="train-numbers" data-case-numbers="">
      {recog !== null && (
        <span>
          {words.train.recognition} <b>{format(recog)}</b>
        </span>
      )}
      {exec !== null && (
        <span>
          {words.train.execution} <b>{format(exec)}</b>
        </span>
      )}
    </p>
  );
}

type Shown = {
  caseId: string;
  data?: TrainerCaseData;
  /** U turns before the picture or the scramble, and the colour turn (y). */
  auf: number;
  colour: number;
  scramble: string | null;
};
type Saved = {
  attempt: TrainerAttempt;
  before: TrainerAttempt[];
  /** The card before this attempt, so marking it missed reviews it again; none for a
   * case drilled with the whole set but not added. */
  card: string | null;
};

// Test hooks only: `?test-turn=0` shows every case unturned and in its own colours.
const pinnedTurn =
  import.meta.env.VITE_TEST_HOOKS === "1"
    ? new URLSearchParams(location.search).get("test-turn")
    : null;

/** The ids in random order (test builds with `?test-turn` keep them in order). */
const shuffle = (ids: readonly string[]): string[] => {
  const out = [...ids];
  if (pinnedTurn !== null) return out;
  for (let i = out.length - 1; i > 0; i--) {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    const j = (value[0] as number) % (i + 1);
    [out[i], out[j]] = [out[j] as string, out[i] as string];
  }
  return out;
};

const random4 = () => {
  if (pinnedTurn !== null) return Number(pinnedTurn) % 4;
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return (value[0] as number) % 4;
};

function Practice({
  app,
  set,
  review: onlyWeak,
  cases,
  loadCase,
  rows,
  attempts,
  words,
  precision,
  labels,
  running,
  byPicture,
  choices,
  holding,
  onShow,
  whole,
  onWhole,
  split,
  onSplit,
  paused,
  onSaved,
}: {
  app: App;
  set: TrainSet;
  review: boolean;
  cases: readonly TrainerCaseData[];
  loadCase?: ((id: string) => Promise<TrainerCaseData | undefined>) | undefined;
  rows: readonly TrainerCase[];
  attempts: readonly TrainerAttempt[];
  words: Text;
  precision: 2 | 3;
  labels: ReadonlyMap<string, string>;
  running: Settings["running"];
  byPicture: boolean;
  choices: AlgChoices;
  holding: string;
  onShow(picture: boolean): void;
  whole: boolean;
  onWhole(whole: boolean): void;
  split: boolean;
  onSplit(split: boolean): void;
  /** The key list is open: the drill hears no keys. */
  paused: boolean;
  onSaved(rows: TrainerCase[], attempts: TrainerAttempt[]): void;
}) {
  const t = words.train;
  const store = app.trainer();
  const [shown, setShown] = useState<Shown | null>(null);
  const [drill, setDrill] = useState<Drill>(() => showCase(true, split));
  // The attempt as the input sees it, ahead of the next render: two events can arrive
  // before React draws the first.
  const drillNow = useRef(drill);
  const moveDrill = useCallback((next: Drill) => {
    drillNow.current = next;
    setDrill(next);
  }, []);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [missed, setMissed] = useState(false);
  // The running figures, as the timer shows them (the running display setting). Drawn
  // from the attempt's own start; a render happens only when the figures change.
  const [clock, setClock] = useState<string | null>(null);
  const counting = drill.phase === "running" || drill.phase === "recognising";
  // biome-ignore lint/correctness/useExhaustiveDependencies: a recognising press restarts the count.
  useEffect(() => {
    if (!counting) {
      setClock(null);
      return;
    }
    let frame = 0;
    const tick = () => {
      const elapsed = drillElapsed(drillNow.current, performance.now());
      setClock(elapsed === null ? null : formatRunning(elapsed, running));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [counting, drill.recognisedAt, running]);
  const [pictureScramble, setPictureScramble] = useState<{
    picture: Shown;
    text: string;
  } | null>(null);
  const client = useRef<TrainingClient | null>(null);
  const sequence = useRef(0);
  const loadingCase = useRef(false);
  const live = useRef({ rows, attempts });
  live.current = { rows, attempts };

  const ids = useMemo(
    () => (whole ? cases.map((c) => c.id) : rows.map((r) => r.caseId)),
    [whole, cases, rows],
  );
  // Review: what today holds (due, slow, missed, each with its look-alike), worked
  // through in order and drawn again once done; the counts are said before the first case.
  const todayQueue = useCallback(() => {
    const now = Date.now();
    return reviewQueue({
      caseIds: whole
        ? cases.map((c) => c.id)
        : live.current.rows.map((r) => r.caseId),
      cards: live.current.rows,
      attempts: live.current.attempts,
      now,
      // OLLCP has no look-alikes of its own: its set id is none of theirs.
      lookalikes:
        set === "ollcp" ? new Map() : lookalikesFor(set as SetId, cases),
      // One order per local day.
      seed: Math.floor(
        (now - new Date(now).getTimezoneOffset() * 60_000) / 86_400_000,
      ),
    });
  }, [whole, cases, set]);
  const queue = useRef<string[]>([]);
  const reviewed = useRef(new Set<string>());
  // When each case drilled in this sitting is due next, as written after its attempt.
  const rescheduled = useRef(new Map<string, number>());
  // Review worked through all it held and nothing new came due.
  const [done, setDone] = useState(false);
  const [started, setStarted] = useState(false);
  // Follows the stored cases until the first attempt (a case added a moment ago may
  // still be on its way), then holds.
  // biome-ignore lint/correctness/useExhaustiveDependencies: read again when they change.
  const fresh = useMemo(
    () => (onlyWeak ? todayQueue() : null),
    [onlyWeak, todayQueue, rows, attempts],
  );
  const held = useRef(fresh);
  if (!started) held.current = fresh;
  const today = held.current;
  const pool = onlyWeak ? (done ? [] : (today?.order ?? [])) : ids;
  // The whole set is drilled in rounds: due and weak cases first, then the rest shuffled.
  const round = useRef<string[]>([]);

  useEffect(
    () => () => {
      sequence.current++;
      client.current?.close();
    },
    [],
  );

  const next = useCallback(
    async (last: string | null) => {
      if (last !== null && loadingCase.current) return;
      const draw = loadCase ? ++sequence.current : null;
      if (loadCase) loadingCase.current = true;
      const { rows: current } = live.current;
      const now = Date.now();
      let id: string | null;
      if (onlyWeak) {
        if (queue.current.length === 0) {
          // Drawn again: what came due since (a miss comes back within minutes), and
          // what this sitting has not shown yet; a slow case shown once waits for tomorrow.
          // The last attempt's new schedule first: a quick Space after the stop must not
          // find the case due as it was before it.
          await writes.current;
          if (draw !== null && draw !== sequence.current) return;
          const dueNow = new Set(
            current
              .filter(
                (r) => (rescheduled.current.get(r.caseId) ?? r.dueAt) <= now,
              )
              .map((r) => r.caseId),
          );
          queue.current = todayQueue().order.filter(
            (id) => dueNow.has(id) || !reviewed.current.has(id),
          );
          // Never the same case twice running.
          if (queue.current.length > 1 && queue.current[0] === last)
            queue.current.push(queue.current.shift() as string);
        }
        id = queue.current.shift() ?? null;
        if (!id) setDone(true);
        else reviewed.current.add(id);
      } else if (whole) {
        if (round.current.length === 0) {
          const queued = await Promise.all(
            current.map(async (r) => ({
              caseId: r.caseId,
              dueAt: r.dueAt,
              recall: await recall(r.card, now),
            })),
          );
          if (draw !== null && draw !== sequence.current) return;
          round.current = roundOf(
            queued,
            pool,
            weakCases(live.current.attempts, pool),
            now,
            last,
            shuffle,
          );
        }
        id = round.current.shift() ?? null;
      } else {
        const queued = await Promise.all(
          current.map(async (r) => ({
            caseId: r.caseId,
            dueAt: r.dueAt,
            recall: await recall(r.card, now),
          })),
        );
        if (draw !== null && draw !== sequence.current) return;
        id = nextCase(queued, now, last);
      }
      let data: TrainerCaseData | undefined;
      if (loadCase) {
        try {
          if (id) data = await loadCase(id);
        } catch {
          // Keep the draw, so a later press can retry this group.
          if (id && draw === sequence.current) {
            if (onlyWeak) queue.current.unshift(id);
            else if (whole) round.current.unshift(id);
          }
          return;
        } finally {
          if (draw === sequence.current) loadingCase.current = false;
        }
        if (draw !== sequence.current) return;
      }
      setSaved(null);
      setMissed(false);
      missedNow.current = false;
      writes.current = Promise.resolve(null);
      if (!id) {
        setShown(null);
        return;
      }
      // A last-slot case's pair stands where its insert wants it: no U turn before.
      const auf = isLastSlot(set) && byPicture ? 0 : random4();
      // A last-layer case comes up with any side in front; an F2L or last-slot case is
      // its slot's, so its colours stay.
      // A CMLL scramble keeps its sides too: the blocks are the left and the right.
      const colour =
        isF2l(set) || isLastSlot(set) || (set === "cmll" && !byPicture)
          ? 0
          : random4();
      const picture: Shown = {
        caseId: id,
        ...(data ? { data } : {}),
        auf,
        colour,
        scramble: null,
      };
      setShown(picture);
      moveDrill(showCase(byPicture, split));
      const ask = draw ?? ++sequence.current;
      const showScramble = (text: string) => {
        if (byPicture) setPictureScramble({ picture, text });
        else setShown({ ...picture, scramble: text });
      };
      if (shipsScrambles(set)) {
        // The 2×2's and CMLL's scrambles come with the data, each one leading to its case.
        const list = (data ?? cases.find((c) => c.id === id))?.scrambles ?? [];
        const picked =
          list[
            byPicture
              ? auf % list.length
              : Math.floor(Math.random() * list.length)
          ];
        if (picked !== undefined)
          showScramble(
            renameTurns(turnScramble(picked, colour), holdingFaces(holding)),
          );
        return;
      }
      client.current ??= createTrainingClient(
        () =>
          new Worker(
            new URL("../scramble/training-worker.ts", import.meta.url),
            {
              type: "module",
            },
          ) as unknown as WorkerLike,
      );
      // Another slot's scramble is its front right case's, renamed for the slot (seen
      // after a y turn, or in the mirror).
      const at = slotOf(set);
      const other = at !== null && at !== "fr";
      const request = {
        kind:
          at !== null
            ? ("f2l" as const)
            : (set as Exclude<
                TrainSet,
                `f2l${string}` | `two-${string}` | "cmll" | "ollcp"
              >),
        caseIds: [other ? `f2l-${id.slice(-4)}` : id],
      } as const;
      const result = await client.current
        .requestTraining({ request }, ask)
        .catch(() => null);
      if (!result || ask !== sequence.current) return;
      showScramble(
        heldScramble(
          request,
          turnScramble(
            other ? slotAlg(result.scramble, at) : result.scramble,
            colour,
          ),
          holding,
        ),
      );
    },
    [
      byPicture,
      split,
      onlyWeak,
      whole,
      pool,
      set,
      cases,
      loadCase,
      holding,
      moveDrill,
      todayQueue,
    ],
  );

  // A new sitting, or the way of showing changed: the first case.
  const nextRef = useRef(next);
  nextRef.current = next;
  const empty = pool.length === 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new way of showing starts over.
  useEffect(() => {
    if (empty) setShown(null);
    else void nextRef.current(null);
  }, [empty, byPicture, split]);

  // The picture's first frame starts recognition. Keyed on the case shown only: a key
  // pressed before that frame must not cancel it.
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useLayoutEffect(() => {
    if (!shown || !byPicture) return;
    const frame = requestAnimationFrame((at) => {
      if (shownRef.current !== shown) return;
      moveDrill(drillStep(drillNow.current, { type: "shown", at }));
    });
    return () => cancelAnimationFrame(frame);
  }, [shown, byPicture, moveDrill]);

  // Writes for the attempt on screen run one after another: a quick M right after the
  // stop waits for the attempt to be stored, then marks it.
  const writes = useRef<Promise<Saved | null>>(Promise.resolve(null));
  const missedNow = useRef(false);

  const save = useCallback(
    (result: NonNullable<Drill["result"]>, at: number) => {
      if (!shown || !store) return;
      const row = live.current.rows.find((r) => r.caseId === shown.caseId);
      // A case not added is drilled with the whole set: its attempt is kept, no card.
      if (!row && !whole) return;
      const before = [...live.current.attempts];
      const grade = gradeOf(
        result.execMs,
        false,
        before,
        shown.caseId,
        result.recogMs,
      );
      const attempt: TrainerAttempt = {
        id: newId(),
        setId: set,
        caseId: shown.caseId,
        mode: byPicture ? "picture" : "scramble",
        auf: shown.auf,
        scramble: shown.scramble,
        recogMs: result.recogMs,
        execMs: result.execMs,
        split: result.split,
        missed: false,
        grade,
        at,
      };
      writes.current = (async () => {
        await store.addAttempt(attempt);
        if (row) {
          const scheduled = await review(row.card, grade, at);
          await store.putCase({ setId: set, caseId: row.caseId, ...scheduled });
          rescheduled.current.set(row.caseId, scheduled.dueAt);
        }
        const saved = { attempt, before, card: row?.card ?? null };
        setSaved(saved);
        setStarted(true);
        onSaved(await store.cases(set), [...before, attempt]);
        return saved;
      })();
    },
    [shown, store, set, byPicture, whole, onSaved],
  );

  const toggleMissed = useCallback(() => {
    if (!store || drill.phase !== "stopped") return;
    const now = !missedNow.current;
    missedNow.current = now;
    setMissed(now);
    writes.current = writes.current.then(async (done) => {
      if (!done) return done;
      const grade: Grade = now
        ? "again"
        : gradeOf(
            done.attempt.execMs,
            false,
            done.before,
            done.attempt.caseId,
            done.attempt.recogMs,
          );
      await store.markAttempt(done.attempt.id, { missed: now, grade });
      if (done.card !== null) {
        const scheduled = await review(done.card, grade, done.attempt.at);
        await store.putCase({
          setId: set,
          caseId: done.attempt.caseId,
          ...scheduled,
        });
        rescheduled.current.set(done.attempt.caseId, scheduled.dueAt);
      }
      onSaved(await store.cases(set), await store.attempts(set));
      return done;
    });
  }, [store, drill.phase, set, onSaved]);

  // Stopped on a short screen: bring the answer and its buttons into view.
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (drill.phase !== "stopped") return;
    const el = resultRef.current;
    if (!el) return;
    // Where it rests, from layout: its landing shift is a transform and must not count.
    let top = 0;
    for (
      let e: HTMLElement | null = el;
      e;
      e = e.offsetParent as HTMLElement | null
    )
      top += e.offsetTop;
    const bottom = top + el.offsetHeight;
    if (bottom > window.scrollY + window.innerHeight)
      window.scrollTo({ top: bottom - window.innerHeight });
  }, [drill.phase]);

  const ready = shown !== null && (byPicture || shown.scramble !== null);
  const step = useCallback(
    (event: { type: "down" | "up"; at: number }) => {
      if (!ready) return;
      const d = drillNow.current;
      const after = drillStep(d, event);
      if (after === d) return;
      moveDrill(after);
      if (after.phase === "stopped" && after.result)
        save(after.result, Date.now());
    },
    [ready, save, moveDrill],
  );

  useEffect(() => {
    function down(event: KeyboardEvent) {
      if (paused || event.defaultPrevented) return;
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey)
        return;
      // Any fresh key marks the case recognised or stops the clock, as on the timer.
      if (
        (drill.phase === "running" || drill.phase === "recognising") &&
        event.key !== "?" &&
        event.key !== "Shift"
      ) {
        event.preventDefault();
        step({ type: "down", at: event.timeStamp });
        return;
      }
      if (drill.phase === "stopped") {
        // Enter on a focused control presses that control (Missed, a set), not Next;
        // so does Space on Next and Missed themselves. Space elsewhere (a mode word
        // left focused by a click) still goes on, as on the timer.
        const control =
          event.target instanceof Element &&
          event.target.closest("button, a, input, select, textarea, summary");
        if (
          control &&
          (event.key === "Enter" ||
            (event.code === "Space" &&
              control.closest('[data-part="train-after"]')))
        )
          return;
        if (event.code === "Space" || event.key === "Enter") {
          event.preventDefault();
          void next(shown?.caseId ?? null);
        } else if (event.code === "KeyM") {
          event.preventDefault();
          toggleMissed();
        }
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        step({ type: "down", at: event.timeStamp });
      }
    }
    function up(event: KeyboardEvent) {
      if (paused || event.code !== "Space") return;
      // Space is let through to Next and Missed: the button acts on its key up.
      if (
        drill.phase === "stopped" &&
        event.target instanceof Element &&
        event.target.closest('[data-part="train-after"] button')
      )
        return;
      event.preventDefault();
      step({ type: "up", at: event.timeStamp });
    }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [drill.phase, step, next, toggleMissed, shown, paused]);

  // After a case: swipe left for the next, right for missed. Not in the moments after the
  // stop, when the other hand may still be coming down.
  const surface = useRef<HTMLElement>(null);
  const stoppedAt = useRef(Number.NEGATIVE_INFINITY);
  const [drillHint, setDrillHint] = useState(false);
  useEffect(() => {
    if (drill.phase !== "stopped") {
      setDrillHint(false);
      return;
    }
    stoppedAt.current = performance.now();
    if (isTouchScreen() && takeHint(["drill"], HINT_GAP) === "drill")
      setDrillHint(true);
  }, [drill.phase]);
  useEffect(() => {
    if (!drillHint) return;
    return nudge(
      surface.current?.querySelector("[data-part='train-stage']"),
      "left",
    );
  }, [drillHint]);
  useSwipe(
    surface,
    {
      config: { ...DEFAULT_SWIPE, directions: ["left", "right"] },
      subject: (element) =>
        element
          .closest("[data-part='train-drill']")
          ?.querySelector<HTMLElement>("[data-part='train-stage']") ?? null,
      enabled: () =>
        !paused &&
        drillNow.current.phase === "stopped" &&
        performance.now() - stoppedAt.current > 700,
      word: (direction) => (direction === "left" ? t.next : t.missed),
      tone: (direction) => (direction === "right" ? "error" : undefined),
      onCommit: (direction) => {
        if (direction === "left") void next(shown?.caseId ?? null);
        else toggleMissed();
        learnGesture("drill");
      },
    },
    pool.length > 0,
  );

  const pointer = (type: "down" | "up") => (event: ReactPointerEvent) => {
    if (drill.phase === "stopped") return;
    if (type === "down")
      event.currentTarget.setPointerCapture?.(event.pointerId);
    step({ type, at: event.timeStamp });
  };

  // The choices at the foot change nothing once an attempt is under way; a split picture
  // runs from the moment it shows, so there they stay open until the first press.
  const choosable =
    drill.phase === "shown" ||
    (drill.phase === "recognising" && byPicture && drill.recognisedAt === null);

  const poolChoice = (
    <span data-part="train-pool">
      <button
        type="button"
        data-action="train-pool"
        data-pool="mine"
        aria-pressed={!whole}
        disabled={!choosable}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onWhole(false)}
      >
        {t.mine}
      </button>
      <button
        type="button"
        data-action="train-pool"
        data-pool="all"
        aria-pressed={whole}
        disabled={!choosable}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onWhole(true)}
      >
        {t.everyCase}
      </button>
    </span>
  );

  const emptyNotice =
    pool.length === 0 ? (onlyWeak ? t.noWeak : t.nothing) : "";
  const emptyContent = (
    <div data-part="train-empty">
      <p>{onlyWeak ? t.noWeak : t.nothing}</p>
      {!whole && !onlyWeak && (
        <p>
          <button
            type="button"
            data-action="train-drill-all"
            onClick={() => onWhole(true)}
          >
            {t.drillAll}
          </button>
        </p>
      )}
      {onlyWeak && <p data-part="train-show">{poolChoice}</p>}
    </div>
  );

  const c = shown?.data ?? cases.find((x) => x.id === shown?.caseId);
  const result = drill.result;
  const before = saved?.before ?? attempts;
  const typical = c ? caseMedian(before, c.id) : null;
  const format = (ms: number) => formatTime(ms, { precision });
  const faster = result && typical !== null && result.execMs < typical;

  const activeContent = (
    <section
      ref={surface}
      data-part="train-drill"
      data-phase={drill.phase}
      data-show={byPicture ? "picture" : "scramble"}
      onPointerDown={pointer("down")}
      onPointerUp={pointer("up")}
    >
      <div data-part="train-stage" tabIndex={-1}>
        {c && shown && byPicture && (
          <div
            data-part="train-picture"
            role="img"
            aria-label={
              pictureScramble?.picture === shown
                ? pictureScramble.text
                : t.preparing
            }
          >
            <Picture
              set={set}
              stickers={recolour(stickersOf(set, c, shown.auf), shown.colour)}
              arrows={drill.phase === "stopped"}
            />
          </div>
        )}
        {c && shown && !byPicture && (
          <p data-part="train-scramble" data-ready={shown.scramble !== null}>
            {shown.scramble === null
              ? t.preparing
              : shown.scramble.split(" ").map((move, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional moves.
                  <span key={i}>
                    {i > 0 && " "}
                    <span data-move={kindOf(move)}>{move}</span>
                  </span>
                ))}
          </p>
        )}
        <output
          data-part="train-time"
          aria-live="off"
          data-missed={missed ? "" : undefined}
          data-faster={faster && !missed ? "" : undefined}
          data-hidden={
            !result && clock !== null && running === "hidden" ? "" : undefined
          }
        >
          {result ? format(result.execMs) : (clock ?? "0.00")}
        </output>
        {/* Heard once the clock stops: the case and the time, not the running figures. */}
        <p data-part="train-said" aria-live="polite">
          {drill.phase === "stopped" && result && c
            ? `${labels.get(c.id) ?? c.label}, ${format(result.execMs)}`
            : ""}
        </p>
        {drill.phase === "stopped" && result && c ? (
          <div data-part="train-result" ref={resultRef}>
            <p data-part="train-numbers">
              {result.recogMs !== null && (
                <span>
                  {t.recognition} <b>{format(result.recogMs)}</b>
                </span>
              )}
              {typical !== null && (
                <span>
                  {t.median} <b>{format(typical)}</b>
                </span>
              )}
            </p>
            <p data-part="train-answer">
              <span data-part="train-label">{labels.get(c.id) ?? c.label}</span>
              {c.algs[0] && <Alg moves={myAlg(c, choices, set).moves} />}
            </p>
            <p data-part="train-after">
              <button
                type="button"
                data-action="train-next"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  // The button goes with the result: the keyboard and a screen reader
                  // move on to the next case's picture, not to the top of the page.
                  surface.current
                    ?.querySelector<HTMLElement>('[data-part="train-stage"]')
                    ?.focus({ preventScroll: true });
                  void next(c.id);
                }}
              >
                {t.next}
              </button>
              <button
                type="button"
                data-action="train-missed"
                aria-pressed={missed}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={toggleMissed}
              >
                {t.missed}
              </button>
              <span data-input="keys">{t.afterKeys}</span>
              {drillHint && (
                <span data-part="gesture-hint" data-input="touch">
                  {words.gestures.hint.drill}
                </span>
              )}
            </p>
          </div>
        ) : (
          <p data-part="train-hint">
            {split && (
              <span data-input="keys">
                {byPicture ? t.splitHint.pictureKey : t.splitHint.scrambleKey}
              </span>
            )}
            {split && (
              <span data-input="touch">
                {byPicture
                  ? t.splitHint.pictureTouch
                  : t.splitHint.scrambleTouch}
              </span>
            )}
            {today && !started && (
              <span data-part="train-today">{t.today(today.counts)}</span>
            )}
          </p>
        )}
        {drill.phase !== "stopped" && (
          <p data-part="train-show" data-no-drill>
            {/* Mine and All differ only while some cases, not all, are the person's. */}
            {rows.length > 0 && rows.length < cases.length && poolChoice}
            <span data-part="train-view">
              <button
                type="button"
                aria-pressed={byPicture}
                disabled={!choosable}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onShow(true)}
              >
                {t.picture}
              </button>
              <button
                type="button"
                aria-pressed={!byPicture}
                disabled={!choosable}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onShow(false)}
              >
                {t.scramble}
              </button>
            </span>
            <button
              type="button"
              data-action="train-split"
              aria-pressed={split}
              disabled={!choosable}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onSplit(!split)}
            >
              {t.split}
            </button>
          </p>
        )}
      </div>
    </section>
  );
  return (
    <>
      <p data-heard role="status">
        {emptyNotice}
      </p>
      {empty ? emptyContent : activeContent}
    </>
  );
}

/** The cross colours from the person's own: it, its opposite, then the other two pairs. */
function crossOrder(own: CrossColour): CrossColour[] {
  const face = faceOfCrossColour(own);
  const opposite = crossColourOfFace(
    ({ U: "D", D: "U", F: "B", B: "F", R: "L", L: "R" } as const)[face],
  );
  return [
    own,
    opposite,
    ...CROSS_COLOURS.filter((colour) => colour !== own && colour !== opposite),
  ];
}
