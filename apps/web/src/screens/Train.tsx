import {
  caseMedian,
  type Grade,
  gradeOf,
  groupMoves,
  newCard,
  nextCase,
  pictureOf,
  recall,
  recolour,
  review,
  type SetId,
  type TrainerCaseData,
  trainerSet,
  turnScramble,
} from "@cubehaus/algs";
import { formatTime, newId } from "@cubehaus/core";
import type { TrainerAttempt, TrainerCase } from "@cubehaus/storage";
import {
  Fragment,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AppView, createAppState } from "../app-state";
import { CaseDiagram } from "../scramble/Training";
import {
  createTrainingClient,
  type TrainingClient,
  type WorkerLike,
} from "../scramble/training-client";
import type { Text } from "../text";
import {
  type Drill,
  drillStep,
  reviewCase,
  reviewPool,
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
const SETS: readonly SetId[] = ["pll", "oll", "coll"];
const showKey = "trainer.show";
type Mode = "learn" | "drill" | "review";
const MODES: readonly Mode[] = ["learn", "drill", "review"];
type App = ReturnType<typeof createAppState>;

export function parseTrainRoute(hash: string): { set: SetId; mode: Mode } {
  const [, , set, mode] = hash.split("/");
  return {
    set: SETS.includes(set as SetId) ? (set as SetId) : "pll",
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
 * An algorithm as code: its triggers grouped, each move in its hue. Real spaces sit
 * between the moves, so a copied algorithm reads as one.
 */
function Alg({ moves }: { moves: string }) {
  return (
    <span data-part="train-moves">
      {groupMoves(moves).map((group, g) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: groups are positional.
        <Fragment key={g}>
          {g > 0 && " "}
          <span data-part="train-group">
            {group.map((move, m) => (
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
  );
}

function Picture({ set, stickers }: { set: SetId; stickers: string }) {
  return (
    <CaseDiagram
      stickers={stickers}
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
  const ru = view.settings.language === "ru";

  useEffect(() => {
    let stale = false;
    setRows(null);
    if (!store) {
      setRows([]);
      setByPicture(true);
      return;
    }
    void Promise.all([
      store.cases(set),
      store.attempts(set),
      stored?.get(showKey) ?? null,
    ]).then(([c, a, show]) => {
      if (stale) return;
      setRows(c);
      setAttempts(a);
      setByPicture(show !== "scramble");
    });
    return () => {
      stale = true;
    };
  }, [store, stored, set]);

  useEffect(() => {
    function close(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      location.hash = "#/";
    }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  const go = (next: { set?: SetId; mode?: Mode }) => {
    location.hash = `#/train/${next.set ?? set}/${next.mode ?? mode}`;
  };
  const learning = new Set(rows?.map((r) => r.caseId));

  return (
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
              aria-pressed={id === set}
              onClick={() => go({ set: id })}
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
      {rows === null || byPicture === null ? null : mode === "learn" ? (
        <Learn
          key={set}
          set={set}
          cases={cases}
          learning={learning}
          words={words}
          ru={ru}
          onAdd={async (id) => {
            if (!store) return;
            const { card, dueAt } = await newCard(id, Date.now());
            await store.putCase({ setId: set, caseId: id, card, dueAt });
            setRows(await store.cases(set));
          }}
          onRemove={async (id) => {
            if (!store) return;
            await store.removeCase(set, id);
            setRows(await store.cases(set));
          }}
        />
      ) : (
        <Practice
          key={`${set}/${mode}`}
          set={set}
          review={mode === "review"}
          cases={cases}
          rows={rows}
          attempts={attempts}
          words={words}
          ru={ru}
          precision={view.settings.precision}
          byPicture={byPicture}
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
  );
}

function Learn({
  set,
  cases,
  learning,
  words,
  ru,
  onAdd,
  onRemove,
}: {
  set: SetId;
  cases: readonly TrainerCaseData[];
  learning: ReadonlySet<string>;
  words: Text;
  ru: boolean;
  onAdd(id: string): Promise<void>;
  onRemove(id: string): Promise<void>;
}) {
  const t = words.train;
  const [open, setOpen] = useState<string | null>(null);
  const [twoLook, setTwoLook] = useState(false);
  const shown = twoLook
    ? cases.filter((c) => c.subsets.includes("2-look"))
    : cases;
  const current = cases.find((c) => c.id === open) ?? null;

  // Narrow, the case takes the list's place: show it from its top, and on the way back
  // the list where it was left.
  const listScroll = useRef(0);
  const choose = (id: string | null) => {
    const narrow = matchMedia("(max-width: 899px)").matches;
    if (id && !open) listScroll.current = window.scrollY;
    setOpen(id);
    if (narrow)
      requestAnimationFrame(() =>
        window.scrollTo({ top: id ? 0 : listScroll.current }),
      );
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
    window.addEventListener("keydown", back);
    return () => window.removeEventListener("keydown", back);
  }, [open]);

  return (
    <div data-part="train-learn" data-open={current ? "" : undefined}>
      <section data-part="train-cases">
        {set === "oll" && (
          <p data-part="train-filter">
            <button
              type="button"
              aria-pressed={!twoLook}
              onClick={() => setTwoLook(false)}
            >
              {t.all}
            </button>
            <button
              type="button"
              data-action="train-two-look"
              aria-pressed={twoLook}
              onClick={() => setTwoLook(true)}
            >
              {t.twoLook}
            </button>
          </p>
        )}
        <ul data-part="train-case-list">
          {shown.map((c) => (
            <li key={c.id} data-case-id={c.id}>
              <button
                type="button"
                aria-current={c.id === open ? "true" : undefined}
                data-learning={learning.has(c.id) ? "" : undefined}
                onClick={() => choose(c.id)}
              >
                <Picture set={set} stickers={pictureOf(c)} />
                <span>{c.label}</span>
              </button>
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
            <Picture set={set} stickers={pictureOf(current)} />
            <h2>{current.label}</h2>
          </div>
          {current.recognise && (
            <p data-part="train-recognise">
              {ru ? current.recognise.ru : current.recognise.en}
            </p>
          )}
          {current.algs.length === 0 ? (
            <p data-part="train-recognise">{t.noAlg}</p>
          ) : (
            <ol data-part="train-algs">
              {current.algs.map((alg) => (
                <li key={alg.moves} data-part="train-alg">
                  {alg.auf > 0 && (
                    <span data-move="plain" data-part="train-auf">
                      {["", "U", "U2", "U'"][alg.auf]}
                    </span>
                  )}
                  <Alg moves={alg.moves} />
                  <span data-part="train-count">
                    {t.moves(alg.metrics.moves)}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p data-part="train-case-actions">
            {learning.has(current.id) ? (
              <button
                type="button"
                data-action="train-remove"
                onClick={() => void onRemove(current.id)}
              >
                {t.remove}
              </button>
            ) : (
              <button
                type="button"
                data-action="train-add"
                onClick={() => void onAdd(current.id)}
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
  /** The card before this attempt, so marking it missed reviews it again. */
  card: string;
};

// Test hooks only: `?test-turn=0` shows every case unturned and in its own colours.
const pinnedTurn =
  import.meta.env.VITE_TEST_HOOKS === "1"
    ? new URLSearchParams(location.search).get("test-turn")
    : null;

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
  ru,
  precision,
  byPicture,
  onShow,
  onSaved,
}: {
  app: App;
  set: SetId;
  review: boolean;
  cases: readonly TrainerCaseData[];
  rows: readonly TrainerCase[];
  attempts: readonly TrainerAttempt[];
  words: Text;
  ru: boolean;
  precision: 2 | 3;
  byPicture: boolean;
  onShow(picture: boolean): void;
  onSaved(rows: TrainerCase[], attempts: TrainerAttempt[]): void;
}) {
  const t = words.train;
  const store = app.trainer();
  const [shown, setShown] = useState<Shown | null>(null);
  const [drill, setDrill] = useState<Drill>(() => showCase(true));
  // The attempt as the input sees it, ahead of the next render: two events can arrive
  // before React draws the first.
  const drillNow = useRef(drill);
  const moveDrill = useCallback((next: Drill) => {
    drillNow.current = next;
    setDrill(next);
  }, []);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [missed, setMissed] = useState(false);
  const client = useRef<TrainingClient | null>(null);
  const sequence = useRef(0);
  const live = useRef({ rows, attempts });
  live.current = { rows, attempts };

  const pool = useMemo(() => {
    const ids = rows.map((r) => r.caseId);
    return onlyWeak ? reviewPool(attempts, ids) : ids;
    // Review follows the attempts: a case leaves once it is no longer weak.
  }, [onlyWeak, rows, attempts]);

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
        id = reviewCase(pool, last, Math.random());
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
      const colour = random4();
      if (byPicture) {
        setShown({ caseId: id, auf, colour, scramble: null });
        moveDrill(showCase(true));
        return;
      }
      setShown({ caseId: id, auf, colour, scramble: null });
      moveDrill(showCase(false));
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
      const result = await client.current.requestTraining(
        { request: { kind: set, caseIds: [id] } },
        ask,
      );
      if (!result || ask !== sequence.current) return;
      setShown({
        caseId: id,
        auf,
        colour,
        scramble: turnScramble(result.scramble, colour),
      });
    },
    [byPicture, onlyWeak, pool, set, moveDrill],
  );

  // A new sitting, or the way of showing changed: the first case.
  const nextRef = useRef(next);
  nextRef.current = next;
  const empty = pool.length === 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new way of showing starts over.
  useEffect(() => {
    if (empty) setShown(null);
    else void nextRef.current(null);
  }, [empty, byPicture]);

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
      if (!row) return;
      const before = [...live.current.attempts];
      const grade = gradeOf(result.execMs, false, before, shown.caseId);
      const attempt: TrainerAttempt = {
        id: newId(),
        setId: set,
        caseId: shown.caseId,
        mode: byPicture ? "picture" : "scramble",
        auf: shown.auf,
        scramble: shown.scramble,
        recogMs: result.recogMs,
        execMs: result.execMs,
        missed: false,
        grade,
        at,
      };
      writes.current = (async () => {
        await store.addAttempt(attempt);
        const scheduled = await review(row.card, grade, at);
        await store.putCase({ setId: set, caseId: row.caseId, ...scheduled });
        const done = { attempt, before, card: row.card };
        setSaved(done);
        onSaved(await store.cases(set), [...before, attempt]);
        return done;
      })();
    },
    [shown, store, set, byPicture, onSaved],
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
        : gradeOf(done.attempt.execMs, false, done.before, done.attempt.caseId);
      await store.markAttempt(done.attempt.id, { missed: now, grade });
      const scheduled = await review(done.card, grade, done.attempt.at);
      await store.putCase({
        setId: set,
        caseId: done.attempt.caseId,
        ...scheduled,
      });
      onSaved(await store.cases(set), await store.attempts(set));
      return done;
    });
  }, [store, drill.phase, set, onSaved]);

  // Stopped on a short screen: bring the answer and its buttons into view.
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (drill.phase !== "stopped") return;
    const box = resultRef.current?.getBoundingClientRect();
    if (box && box.bottom > window.innerHeight)
      resultRef.current?.scrollIntoView({ block: "end" });
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
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (drill.phase === "running") {
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
      if (event.code !== "Space") return;
      event.preventDefault();
      step({ type: "up", at: event.timeStamp });
    }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [drill.phase, step, next, toggleMissed, shown]);

  const pointer = (type: "down" | "up") => (event: ReactPointerEvent) => {
    if (drill.phase === "stopped") return;
    if (type === "down")
      event.currentTarget.setPointerCapture?.(event.pointerId);
    step({ type, at: event.timeStamp });
  };

  if (pool.length === 0)
    return (
      <p data-part="train-empty" role="status">
        {onlyWeak ? t.noWeak : t.nothing}
      </p>
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
          data-missed={missed ? "" : undefined}
          data-faster={faster && !missed ? "" : undefined}
        >
          {result ? format(result.execMs) : "0.00"}
        </output>
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
              {c.algs[0] && <Alg moves={c.algs[0].moves} />}
            </p>
            {c.recognise && (
              <p data-part="train-recognise">
                {ru ? c.recognise.ru : c.recognise.en}
              </p>
            )}
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
            <span data-input="keys">{words.emptyHintKey}</span>
            <span data-input="touch">{words.emptyHintTouch}</span>
          </p>
        )}
        {drill.phase !== "stopped" && (
          <p data-part="train-show" data-no-drill>
            <button
              type="button"
              aria-pressed={byPicture}
              disabled={drill.phase !== "shown"}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onShow(true)}
            >
              {t.picture}
            </button>
            <button
              type="button"
              aria-pressed={!byPicture}
              disabled={drill.phase !== "shown"}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onShow(false)}
            >
              {t.scramble}
            </button>
          </p>
        )}
      </div>
    </section>
  );
}
