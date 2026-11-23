import {
  type AlgPiece,
  algUnits,
  caseMedian,
  type Grade,
  gradeOf,
  lookalikes,
  mirrorAlg,
  newCard,
  nextCase,
  pictureOf,
  pllArrows,
  recall,
  recogMedian,
  recolour,
  review,
  reviewQueue,
  roundOf,
  type SetId,
  type TrainerCaseData,
  trainerSet,
  turnScramble,
  weakCases,
} from "@cubehaus/algs";
import { formatTime, newId } from "@cubehaus/core";
import { holdingFaces } from "@cubehaus/cube/holding";
import type { TrainerAttempt, TrainerCase } from "@cubehaus/storage";
import {
  createContext,
  Fragment,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AppView, createAppState } from "../app-state";
import type { Action } from "../keys/engine";
import { Help } from "../keys/Help";
import { formatRunning } from "../running";
import { CaseDiagram, SlotDiagram } from "../scramble/Training";
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
  chooseAlg,
  type Drill,
  drillElapsed,
  drillStep,
  myAlg,
  otherAlgs,
  parseChoices,
  showCase,
} from "../train-state";
import "../design/train.css";
import "../input/train-behavior.css";

/**
 * The algorithm trainer: a set (PLL,
 * OLL, COLL) and a mode. Learn shows every case with its picture, how to recognise it and
 * its algorithms, and puts cases into drills. Drill shows the cases due first, as a
 * picture turned and recoloured at random or as a scramble; Review shows only the slow
 * and often missed ones. Attempts are stored apart from solves.
 */
const SETS: readonly SetId[] = ["pll", "oll", "coll", "f2l"];
/** F2L's front left slot: the same cases in the mirror, a set of its own under F2L's tab. */
const ROUTE_SETS: readonly SetId[] = [...SETS, "f2l-left"];
const isF2l = (set: SetId) => set === "f2l" || set === "f2l-left";
const showKey = "trainer.show";
const slotKey = "trainer.slot";
const poolKey = (set: SetId) => `trainer.pool.${set}`;
const algsKey = "trainer.algs";
const splitKey = "trainer.split";
type Mode = "learn" | "drill" | "review";
const MODES: readonly Mode[] = ["learn", "drill", "review"];
type App = ReturnType<typeof createAppState>;

export function parseTrainRoute(hash: string): { set: SetId; mode: Mode } {
  const [, , set, mode] = hash.split("/");
  return {
    set: ROUTE_SETS.includes(set as SetId) ? (set as SetId) : "pll",
    mode: MODES.includes(mode as Mode) ? (mode as Mode) : "learn",
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
    <span data-part="train-moves">
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

function Picture({
  set,
  stickers,
  arrows = false,
}: {
  set: SetId;
  stickers: string;
  /** PLL: arrows on the top for which piece goes where. */
  arrows?: boolean;
}) {
  const faces = useContext(Held);
  if (isF2l(set))
    return (
      <SlotDiagram
        stickers={stickers}
        faces={faces}
        mirrored={set === "f2l-left"}
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
  const { set, mode } = parseTrainRoute(route);
  const cases = useMemo(() => trainerSet(set), [set]);
  const store = app.trainer();
  const stored = app.storedSettings();
  const [rows, setRows] = useState<TrainerCase[] | null>(null);
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
  // F2L's slot, front right or front left: the tab opens the one last chosen.
  const [slot, setSlot] = useState<"right" | "left">("right");
  const ru = view.settings.language === "ru";
  const holding = view.settings.holding;
  const faces = useMemo(() => holdingFaces(holding), [holding]);

  useEffect(() => {
    let stale = false;
    setRows(null);
    if (!store) {
      setRows([]);
      setByPicture(true);
      setWhole(false);
      return;
    }
    void Promise.all([
      store.cases(set),
      store.attempts(set),
      stored?.get(showKey) ?? null,
      stored?.get(poolKey(set)) ?? null,
      stored?.get(algsKey) ?? null,
      stored?.get(splitKey) ?? null,
      stored?.get(slotKey) ?? null,
    ]).then(([c, a, show, pool, algs, splitOn, slotWas]) => {
      if (stale) return;
      setRows(c);
      setAttempts(a);
      setByPicture(show !== "scramble");
      setWhole(pool === "all");
      setChoices(parseChoices(algs));
      setSplit(splitOn === "on");
      setSlot(slotWas === "left" ? "left" : "right");
    });
    return () => {
      stale = true;
    };
  }, [store, stored, set]);

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

  const go = (next: { set?: SetId; mode?: Mode }) => {
    location.hash = `#/train/${next.set ?? set}/${next.mode ?? mode}`;
  };
  const learning = useMemo(() => new Set(rows?.map((r) => r.caseId)), [rows]);

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
          <p data-part="train-sets">
            {SETS.map((id) => (
              <button
                key={id}
                type="button"
                data-action="train-set"
                data-set={id}
                aria-pressed={id === set || (id === "f2l" && isF2l(set))}
                onClick={() =>
                  go({
                    set: id === "f2l" && slot === "left" ? "f2l-left" : id,
                  })
                }
              >
                {id.toUpperCase()}
              </button>
            ))}
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
          </p>
        </div>
        {rows === null || byPicture === null || whole === null ? null : mode ===
          "learn" ? (
          <Learn
            key={set}
            set={set}
            cases={cases}
            learning={learning}
            attempts={attempts}
            words={words}
            ru={ru}
            precision={view.settings.precision}
            choices={choices}
            onChoose={(next) => {
              setChoices(next);
              void stored?.set(algsKey, JSON.stringify(next));
            }}
            onSlot={(next) => {
              setSlot(next);
              void stored?.set(slotKey, next);
              go({ set: next === "left" ? "f2l-left" : "f2l" });
            }}
            onDrill={async (ids, on) => {
              if (!store) return;
              const current = new Set(
                (await store.cases(set)).map((r) => r.caseId),
              );
              for (const id of ids) {
                if (on === current.has(id)) continue;
                if (!on) await store.removeCase(set, id);
                // Back in: the schedule it had, else a new card due now.
                else if (!(await store.restoreCase(set, id))) {
                  const { card, dueAt } = await newCard(id, Date.now());
                  await store.putCase({ setId: set, caseId: id, card, dueAt });
                }
              }
              setRows(await store.cases(set));
            }}
          />
        ) : (
          <Practice
            key={`${set}/${mode}/${whole}`}
            set={set}
            review={mode === "review"}
            cases={cases}
            rows={rows}
            attempts={attempts}
            words={words}
            precision={view.settings.precision}
            running={view.settings.running}
            byPicture={byPicture}
            choices={choices}
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

function Learn({
  set,
  cases,
  learning,
  attempts,
  words,
  ru,
  precision,
  onDrill,
  choices,
  onChoose,
  onSlot,
}: {
  set: SetId;
  cases: readonly TrainerCaseData[];
  learning: ReadonlySet<string>;
  attempts: readonly TrainerAttempt[];
  words: Text;
  ru: boolean;
  precision: 2 | 3;
  /** Puts the cases into the drills, or takes them out. */
  onDrill(ids: readonly string[], on: boolean): Promise<void>;
  choices: AlgChoices;
  onChoose(next: AlgChoices): void;
  /** F2L only: the slot, front right or front left. */
  onSlot(next: "right" | "left"): void;
}) {
  const t = words.train;
  const [open, setOpen] = useState<string | null>(null);
  // The other algorithms of the open case, one tap away.
  const [more, setMore] = useState(false);
  // A tap shows at once; the stored list catches up a moment later.
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(
    new Map(),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: the stored list arrived.
  useEffect(() => setPending(new Map()), [learning]);
  const picked = (id: string) => pending.get(id) ?? learning.has(id);
  const twoLook = cases
    .filter((c) => c.subsets.includes("2-look"))
    .map((c) => c.id);
  const all = cases.map((c) => c.id);
  const inDrills = (ids: readonly string[]) =>
    ids.length > 0 && ids.every((id) => learning.has(id));
  const current = cases.find((c) => c.id === open) ?? null;

  // Narrow, the case takes the list's place: show it from its top, and on the way back
  // the list where it was left.
  const listScroll = useRef(0);
  const choose = (id: string | null) => {
    const narrow = matchMedia("(max-width: 899px)").matches;
    if (id && !open) listScroll.current = window.scrollY;
    setOpen(id);
    setMore(false);
    const was = open;
    requestAnimationFrame(() => {
      if (narrow) window.scrollTo({ top: id ? 0 : listScroll.current });
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

  return (
    <div data-part="train-learn" data-open={current ? "" : undefined}>
      <section data-part="train-cases">
        <p data-part="train-filter">
          <button
            type="button"
            data-action="train-all"
            aria-pressed={inDrills(all)}
            onClick={() => void onDrill(all, true)}
          >
            {t.all}
          </button>
          <button
            type="button"
            data-action="train-none"
            aria-pressed={learning.size === 0}
            onClick={() => void onDrill(all, false)}
          >
            {t.none}
          </button>
          {twoLook.length > 0 && (
            <button
              type="button"
              data-action="train-two-look"
              aria-pressed={
                inDrills(twoLook) && learning.size === twoLook.length
              }
              onClick={() =>
                void onDrill(twoLook, true).then(() =>
                  onDrill(
                    all.filter((id) => !twoLook.includes(id)),
                    false,
                  ),
                )
              }
            >
              {t.twoLook}
            </button>
          )}
          {isF2l(set) && (
            <span data-part="train-slot">
              {(["right", "left"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  data-action="train-slot"
                  data-slot={id}
                  aria-label={t.slotNames[id]}
                  aria-pressed={(set === "f2l-left") === (id === "left")}
                  onClick={() => onSlot(id)}
                >
                  {t.slots[id]}
                </button>
              ))}
            </span>
          )}
        </p>
        <ul data-part="train-case-list">
          {cases.map((c) => (
            <li
              key={c.id}
              data-case-id={c.id}
              data-learning={learning.has(c.id) ? "" : undefined}
            >
              <button
                type="button"
                aria-label={c.label}
                aria-current={c.id === open ? "true" : undefined}
                data-learning={learning.has(c.id) ? "" : undefined}
                onClick={() => choose(c.id)}
              >
                <Picture set={set} stickers={pictureOf(c)} />
              </button>
              <label data-part="train-pick">
                <input
                  type="checkbox"
                  data-action="train-pick"
                  checked={picked(c.id)}
                  onChange={(event) => {
                    const on = event.currentTarget.checked;
                    setPending((was) => new Map(was).set(c.id, on));
                    void onDrill([c.id], on);
                  }}
                />
                <span>{c.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>
      {current && (
        <article data-part="train-case" data-case-id={current.id}>
          <button
            type="button"
            data-action="train-case-close"
            onClick={() => choose(null)}
          >
            {t.back}
          </button>
          <div data-part="train-case-head">
            <Picture set={set} stickers={pictureOf(current)} arrows />
            <h2>{current.label}</h2>
          </div>
          <CaseNumbers
            attempts={attempts}
            caseId={current.id}
            words={words}
            precision={precision}
          />
          {current.recognise && (
            <p data-part="train-recognise">
              {ru ? current.recognise.ru : current.recognise.en}
            </p>
          )}
          {current.algs.length === 0 ? (
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
                            data-action="train-use"
                            onClick={() =>
                              onChoose(
                                chooseAlg(choices, set, current, alg.moves),
                              )
                            }
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
            {learning.has(current.id) ? (
              <button
                type="button"
                data-action="train-remove"
                onClick={() => void onDrill([current.id], false)}
              >
                {t.remove}
              </button>
            ) : (
              <button
                type="button"
                data-action="train-add"
                onClick={() => void onDrill([current.id], true)}
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
  rows,
  attempts,
  words,
  precision,
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
  set: SetId;
  review: boolean;
  cases: readonly TrainerCaseData[];
  rows: readonly TrainerCase[];
  attempts: readonly TrainerAttempt[];
  words: Text;
  precision: 2 | 3;
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
  const client = useRef<TrainingClient | null>(null);
  const sequence = useRef(0);
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
      lookalikes: lookalikes(set),
      // One order per local day.
      seed: Math.floor(
        (now - new Date(now).getTimezoneOffset() * 60_000) / 86_400_000,
      ),
    });
  }, [whole, cases, set]);
  const queue = useRef<string[]>([]);
  const reviewed = useRef(new Set<string>());
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
      client.current?.close();
    },
    [],
  );

  const next = useCallback(
    async (last: string | null) => {
      const { rows: current } = live.current;
      const now = Date.now();
      let id: string | null;
      if (onlyWeak) {
        if (queue.current.length === 0) {
          // Drawn again: what came due since (a miss comes back within minutes), and
          // what this sitting has not shown yet; a slow case shown once waits for tomorrow.
          const dueNow = new Set(
            current.filter((r) => r.dueAt <= now).map((r) => r.caseId),
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
        id = nextCase(queued, now, last);
      }
      setSaved(null);
      setMissed(false);
      missedNow.current = false;
      writes.current = Promise.resolve(null);
      if (!id) {
        setShown(null);
        return;
      }
      const auf = random4();
      // A last-layer case comes up with any side in front; an F2L case is the front
      // right slot's, so its colours stay.
      const colour = isF2l(set) ? 0 : random4();
      if (byPicture) {
        setShown({ caseId: id, auf, colour, scramble: null });
        moveDrill(showCase(true, split));
        return;
      }
      setShown({ caseId: id, auf, colour, scramble: null });
      moveDrill(showCase(false, split));
      client.current ??= createTrainingClient(
        () =>
          new Worker(
            new URL("../scramble/training-worker.ts", import.meta.url),
            {
              type: "module",
            },
          ) as unknown as WorkerLike,
      );
      const ask = ++sequence.current;
      // The left slot's scramble is its right case's, seen in the mirror.
      const left = set === "f2l-left";
      const request = {
        kind: left ? ("f2l" as const) : set,
        caseIds: [left ? id.replace("f2l-left-", "f2l-") : id],
      };
      const result = await client.current.requestTraining({ request }, ask);
      if (!result || ask !== sequence.current) return;
      setShown({
        caseId: id,
        auf,
        colour,
        scramble: heldScramble(
          request,
          turnScramble(
            left ? mirrorAlg(result.scramble) : result.scramble,
            colour,
          ),
          holding,
        ),
      });
    },
    [
      byPicture,
      split,
      onlyWeak,
      whole,
      pool,
      set,
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

  if (pool.length === 0)
    return (
      <div data-part="train-empty" role="status">
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

  const c = shown ? cases.find((x) => x.id === shown.caseId) : undefined;
  const result = drill.result;
  const before = saved?.before ?? attempts;
  const typical = c ? caseMedian(before, c.id) : null;
  const format = (ms: number) => formatTime(ms, { precision });
  const faster = result && typical !== null && result.execMs < typical;

  return (
    <section
      data-part="train-drill"
      data-phase={drill.phase}
      data-show={byPicture ? "picture" : "scramble"}
      onPointerDown={pointer("down")}
      onPointerUp={pointer("up")}
    >
      <div data-part="train-stage">
        {c && shown && byPicture && (
          <div data-part="train-picture">
            <Picture
              set={set}
              stickers={recolour(pictureOf(c, shown.auf), shown.colour)}
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
            ? `${c.label}, ${format(result.execMs)}`
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
              <span data-part="train-label">{c.label}</span>
              {c.algs[0] && <Alg moves={myAlg(c, choices, set).moves} />}
            </p>
            <p data-part="train-after">
              <button
                type="button"
                data-action="train-next"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => void next(c.id)}
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
            </p>
          </div>
        ) : (
          <p data-part="train-hint">
            <span data-input="keys">
              {!split
                ? words.emptyHintKey
                : byPicture
                  ? t.splitHint.pictureKey
                  : t.splitHint.scrambleKey}
            </span>
            <span data-input="touch">
              {!split
                ? words.emptyHintTouch
                : byPicture
                  ? t.splitHint.pictureTouch
                  : t.splitHint.scrambleTouch}
            </span>
            {today && !started && (
              <span data-part="train-today">{t.today(today.counts)}</span>
            )}
          </p>
        )}
        {drill.phase !== "stopped" && (
          <p data-part="train-show" data-no-drill>
            {poolChoice}
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
}
