import {
  type EventId,
  eventInfo,
  type Folder,
  hasTimePenalty,
  nextPlus2,
  type Penalty,
  resultValue,
  type Session,
  type Solve,
} from "@cubehaus/core";
import { parseStat, type StatId } from "@cubehaus/stats";
import {
  type Layout,
  MergeError,
  type MergeReceipt,
  MoveError,
  RepeatError,
  SplitError,
  type SplitReceipt,
  type Store,
  type TrashEntry,
} from "@cubehaus/storage";
import type { ExportFileResult, RestoreFileResult } from "./backup-file";
import {
  createDefaultSession,
  currentSessionKey,
  flushPending,
  loadSessions,
  previousSessionKey,
} from "./db/flow";
import type { DbState } from "./db/open";
import type { PendingJournal } from "./db/pending";
import type {
  ImportFileResult,
  ImportInput,
  ImportPreviewResult,
} from "./import";
import {
  type Keymap,
  keymapKey,
  parseKeymap,
  validateBindings,
} from "./keys/keymap";
import { isMacPlatform } from "./keys/label";
import { cleanName, lonelyFolders } from "./session-grid";
import {
  type LayoutItem,
  listed,
  type Place,
  sessionOrder,
  tree,
} from "./session-order";
import {
  createSessionStats,
  type SessionStats,
  selectedSlots,
  sessionWindows,
  slotKey,
  supportsStat,
} from "./session-stats";
import {
  changeSetting,
  defaultSettings,
  loadSettings,
  type Settings,
  sessionSettingsKey,
} from "./settings";
import { text } from "./text";
import { loadTheme, saveTheme, type ThemeDocument } from "./theme-editor";
import { createUndoStack } from "./undo";

const defaultPageSize = 200;

// The interface starts in the browser's language until one is chosen.
const browserLanguage = () => globalThis.navigator?.language;

export interface SolveRow {
  solve: Solve;
  no: number;
  ao5: number;
  ao12: number;
  // The newest solve equals or beats every earlier single (9i1a: equal counts).
  record?: boolean;
}

const windowSize = { ao5: 5, ao12: 12, mo3: 3, ao100: 100 } as const;

// Which of the newest numbers equal or beat every earlier one of their kind.
// A number with nothing earlier to compare with is not a record.
export type Records = { best: boolean } & Partial<Record<StatId, boolean>>;

export interface AppView {
  dbState: DbState | null;
  current: Session | null;
  sessions: readonly Session[];
  rows: readonly SolveRow[];
  stats: SessionStats;
  newestIsBest: boolean;
  records: Records;
  canUndo: boolean;
  settings: Settings;
  keymap: Keymap;
  /** The custom theme as stored, or null when none was made. */
  customTheme: ThemeDocument | null;
  /** Pending solves held only in memory: neither the database nor storage has them. */
  unsaved: number;
  /** The session open before this one, for S then Enter. */
  previousId: string | null;
  /** Folders of sessions; `sessions` is in list order, folders opened. */
  folders: readonly Folder[];
  /**
   * A past solve shown in place of the newest (↑ ↓, or picked in the file): its number
   * and the numbers as they stood then. Null while the newest is shown.
   */
  shown: ShownSolve | null;
  browsing: boolean;
  /** Solves of the open session picked together (Shift or Mod with a click or arrow). */
  selected: ReadonlySet<string>;
  /**
   * R: the timer takes the scramble of a past solve (the root) again. Every attempt on it
   * is listed, the root first; edits go to the attempt on show.
   */
  repeat: RepeatView | null;
  /** Solves of the open session since local midnight. */
  today: number;
}

export interface RepeatView {
  root: Solve;
  /** The root's number in the session. */
  no: number;
  /** The root, then its repeats, oldest first. */
  attempts: readonly Solve[];
  /** The attempt on show: the newest, or one picked from the list. */
  shown: Solve;
}

/** What a move did: how many went where, or why none did. */
export type MoveResult =
  | { moved: number; to: Session }
  | { error: MoveError["reason"] | "nothing" };

/** What a split did: the new session and how many solves it took, or why none moved. */
export type SplitResult =
  | { moved: number; into: Session }
  | { error: SplitError["reason"] | "nothing" };

/** What a merge did: the session the others went into, or why nothing changed. */
export type MergeResult =
  | { into: Session }
  | { error: MergeError["reason"] | "nothing" };

export interface ShownSolve {
  solve: Solve;
  no: number;
  stats: ReturnType<ReturnType<typeof createSessionStats>["upTo"]>;
}

function recordsOf(stats: SessionStats, newestIsBest: boolean): Records {
  const records = {
    best: stats.count >= 2 && newestIsBest,
  } as Records;
  for (const [name, n] of Object.entries(windowSize) as [
    keyof typeof windowSize,
    number,
  ][]) {
    const current = stats[name];
    records[name] =
      stats.count > n &&
      Number.isFinite(current) &&
      current === stats[`${name}-best`];
  }
  for (const name of Object.keys(stats) as StatId[]) {
    if (!name.startsWith("ao") || Object.hasOwn(records, name)) continue;
    const stat = parseStat(name);
    if (stat)
      records[name] =
        stats.count > stat.n &&
        Number.isFinite(stats[name]) &&
        stats[name] === stats[`${name as `ao${number}`}-best`];
  }
  return records;
}

type PenaltyFields = Pick<Solve, "plus2" | "dnf">;

function compare(a: Solve, b: Solve): number {
  return a.startedAt - b.startedAt || (a.id < b.id ? -1 : Number(a.id > b.id));
}

function dateBound(dates: Float64Array, at: number, upper = false): number {
  let low = 0;
  let high = dates.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const date = dates[mid] as number;
    if (date < at || (upper && date === at)) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function createAppState(
  journal: PendingJournal,
  onChange: (view: AppView) => void,
  /** `pageSize`: newest solves held in memory (tests use a small one). */
  { pageSize = defaultPageSize }: { pageSize?: number } = {},
) {
  const history = createUndoStack();
  const knownSessions = new Set<string>();
  // The dropped-write hook can leave a solve visible before replay. The cache
  // already contains these solves, so their eventual insert only confirms them.
  let staged: Solve | null = null;
  let stagedInSeries = false;
  let unwrittenIndex: number | undefined;
  let dbState: DbState | null = null;
  let current: Session | null = null;
  let previousId: string | null = null;
  let settings = defaultSettings(browserLanguage());
  let keymap: Keymap = {};
  let customTheme: ThemeDocument | null = null;
  let sessions: Session[] = [];
  let folders: Folder[] = [];
  let rows: Solve[] = [];
  let series = createSessionStats();
  let limit = pageSize;
  let store: Store | undefined;
  // The past solve on show, by its row; null: the newest, live. Its index is kept with it.
  let shown: Solve | null = null;
  let shownIndex = 0;
  // Solves picked together, by ID, and the solve a range is counted from.
  let selected = new Set<string>();
  let anchor: Solve | null = null;
  let queue = Promise.resolve();
  let published: AppView | undefined;
  // R: the solve whose scramble is timed again, its repeats, the one on show.
  let again: {
    root: Solve;
    no: number;
    repeats: Solve[];
    shownId: string;
  } | null = null;

  function solveRow(solve: Solve, offset: number, stats = series): SolveRow {
    const index = stats.count - 1 - offset;
    return {
      solve,
      no: index + 1,
      ao5: stats.at("ao5", index),
      ao12: stats.at("ao12", index),
    };
  }

  function markOpenStep(name: string) {
    if (
      import.meta.env.VITE_TEST_HOOKS === "1" &&
      new URLSearchParams(globalThis.location?.search).has("seed")
    )
      performance.mark(`cubehaus:${name}`);
  }

  function snapshot(): AppView {
    const fallback = store
      ? []
      : journal
          .all()
          .filter((solve) => solve.repeatOf === undefined)
          .sort(compare);
    const stats = store
      ? series
      : createSessionStats(Float64Array.from(fallback, resultValue));
    const visible = store ? rows : fallback.slice(-pageSize).reverse();
    const summary = stats.stats();
    const newest = visible[0];
    const value = newest ? resultValue(newest) : NaN;
    const newestIsBest = Number.isFinite(value) && value === summary.best;
    const records = recordsOf(summary, newestIsBest);
    return {
      dbState,
      current,
      sessions,
      rows: visible.map((solve, i) => {
        const row = solveRow(solve, i, stats);
        if (i === 0 && records.best) row.record = true;
        return row;
      }),
      stats: summary,
      newestIsBest,
      records,
      canUndo: history.size > 0,
      settings,
      keymap,
      customTheme,
      unsaved: journal.durability() === "memory" ? journal.all().length : 0,
      previousId,
      folders,
      shown:
        store && shown
          ? { solve: shown, no: shownIndex + 1, stats: series.upTo(shownIndex) }
          : null,
      browsing: store !== undefined && shown !== null,
      selected: new Set(selected),
      repeat: again && repeatView(again),
      today: store
        ? series.count -
          dateBound(series.dates, new Date().setHours(0, 0, 0, 0))
        : 0,
    };
  }

  function repeatView(state: NonNullable<typeof again>): RepeatView {
    const attempts = [state.root, ...state.repeats];
    return {
      root: state.root,
      no: state.no,
      attempts,
      shown:
        attempts.find((attempt) => attempt.id === state.shownId) ??
        attempts.at(-1) ??
        state.root,
    };
  }

  /** The root's row and the shown copy keep the count of its repeats. */
  function countRepeats(rootId: string, repeats: number) {
    const mark = (solve: Solve): Solve => {
      if (solve.id !== rootId) return solve;
      const { repeats: _, ...rest } = solve;
      return repeats ? { ...rest, repeats } : rest;
    };
    rows = rows.map(mark);
    if (shown) shown = mark(shown);
    if (again?.root.id === rootId) again = { ...again, root: mark(again.root) };
  }

  function publish() {
    published = snapshot();
    onChange(published);
  }

  function fail(error: unknown) {
    dbState = { kind: "failed", reason: String(error) };
    store = undefined;
    series = createSessionStats();
    publish();
  }

  function run(operation: () => Promise<void>): Promise<void> {
    queue = queue
      .then(async () => {
        await operation();
        publish();
      })
      .catch(fail);
    return queue;
  }

  async function select(db: Store, session: Session, pageLimit = pageSize) {
    const loaded = await db.solves.series(session.id);
    markOpenStep("series-read");
    const page = await db.solves.page(session.id, { limit: pageLimit });
    const loadedSettings = await loadSettings(
      db.settings,
      session.id,
      browserLanguage(),
      session.event,
    );
    // The one open before is kept with the current one, in one write.
    const previous =
      current && current.id !== session.id ? current.id : previousId;
    await db.settings.setAll({
      [currentSessionKey]: session.id,
      ...(previous ? { [previousSessionKey]: previous } : {}),
    });
    previousId = previous;
    settings = loadedSettings;
    current = session;
    // Another session: back to its newest, nothing picked, no repeat.
    shown = null;
    again = null;
    unselect();
    series = createSessionStats(
      loaded.values,
      loaded.startedAt,
      sessionWindows(session.event, settings.statSlots, settings.layout),
    );
    markOpenStep("statistics-ready");
    rows = page;
    limit = pageLimit;
    stagedInSeries = false;
    unwrittenIndex = undefined;
    if (staged?.sessionId === session.id) await stage(db, staged);
  }

  async function position(db: Store, solve: Solve) {
    const dates = series.dates;
    const first = dateBound(dates, solve.startedAt);
    const end = dateBound(dates, solve.startedAt, true);
    if (first === end) return { index: first, exists: false };
    const ties = await db.solves.page(solve.sessionId, {
      atOrBefore: solve.startedAt,
      limit: end - first,
    });
    const ids = new Set(
      ties
        .filter((item) => item.startedAt === solve.startedAt)
        .map((item) => item.id),
    );
    if (stagedInSeries && staged?.startedAt === solve.startedAt)
      ids.add(staged.id);
    let index = first;
    for (const id of ids) if (id < solve.id) index++;
    return { index, exists: ids.has(solve.id) };
  }

  async function insert(solve: Solve, index: number) {
    await series.change(index, false, {
      value: resultValue(solve),
      at: solve.startedAt,
    });
    const offset = series.count - 1 - index;
    if (offset < limit) {
      rows.splice(offset, 0, solve);
      if (rows.length > limit) rows.pop();
    }
  }

  async function stage(db: Store, solve: Solve) {
    const location = await position(db, solve);
    if (!location.exists) {
      await insert(solve, location.index);
      unwrittenIndex = location.index;
    }
    stagedInSeries = true;
  }

  async function sessionForPending(db: Store, solve: Solve, selected: Session) {
    if (knownSessions.has(solve.sessionId)) return solve;
    // A pre-open attempt used the startup puzzle. Replaying it into a
    // different event would pair that event with the wrong scramble.
    let session =
      selected.event === solve.event
        ? selected
        : (sessions.find(
            (item) => item.event === solve.event && !item.archived,
          ) ?? sessions.find((item) => item.event === solve.event));
    if (!session) {
      session =
        solve.event === "333"
          ? await createDefaultSession(db)
          : await db.sessions.create({
              event: solve.event,
              name:
                text.events.find((item) => item.id === solve.event)?.name ??
                solve.event,
            });
      knownSessions.add(session.id);
      sessions = [...sessions, session];
    }
    return { ...solve, sessionId: session.id };
  }

  async function flush(db: Store, update = true) {
    const selected = current;
    if (!selected) return;
    const dropped = await flushPending(
      journal,
      (solve) => sessionForPending(db, solve, selected),
      async (solve) => {
        if (solve.repeatOf !== undefined) {
          try {
            await db.solves.add(solve);
          } catch (error) {
            if (!(error instanceof RepeatError)) throw error;
            // Its solve went for good meanwhile: the time is kept as a solve of its own.
            const { repeatOf: _, ...plain } = solve;
            await db.solves.add(plain);
          }
          return;
        }
        const wasStaged = staged?.id === solve.id && stagedInSeries;
        const location =
          update && solve.sessionId === selected.id && !wasStaged
            ? await position(db, solve)
            : null;
        await db.solves.add(solve);
        if (staged?.id === solve.id) {
          staged = null;
          stagedInSeries = false;
          unwrittenIndex = undefined;
        }
        if (location && !location.exists) await insert(solve, location.index);
      },
    );
    if (dropped) {
      const alreadyVisible = staged?.id === dropped.id && stagedInSeries;
      staged = dropped;
      if (
        !alreadyVisible &&
        update &&
        dropped.sessionId === selected.id &&
        dropped.repeatOf === undefined
      )
        await stage(db, dropped);
    }
  }

  function edit(operation: (db: Store) => Promise<void>): Promise<void> {
    return run(async () => {
      if (!store) return;
      await flush(store);
      if (!staged) await operation(store);
    });
  }

  /** Sessions and folders as stored, sessions in list order. */
  async function readLayout(db: Store) {
    const [list, held] = await Promise.all([
      db.sessions.list(),
      db.folders.list(),
    ]);
    folders = held;
    sessions = sessionOrder(tree(list, held));
    const open = current?.id;
    current = sessions.find(({ id }) => id === open) ?? current;
  }

  /**
   * Before the open session leaves the list: its neighbour as the list shows it opens,
   * or, with none left, a new session.
   */
  async function leave(db: Store, id: string) {
    const shown = listed(sessions, current?.id);
    const index = shown.findIndex((session) => session.id === id);
    const next =
      shown[index - 1] ?? shown[index + 1] ?? (await createDefaultSession(db));
    knownSessions.add(next.id);
    await select(db, next);
  }

  function layoutNow(): Layout {
    return {
      sessions: sessions.map(({ id, folderId, orderKey }) => ({
        id,
        folderId,
        orderKey,
      })),
      folders: folders.map(({ id, orderKey, collapsed }) => ({
        id,
        orderKey,
        collapsed,
        deleted: false,
      })),
    };
  }

  /** One change of order, undone by putting every row back where it stood. */
  async function relayout(
    db: Store,
    change: () => Promise<string | null | undefined>,
  ) {
    const before = layoutNow();
    const known = new Set(folders.map(({ id }) => id));
    const made = await change();
    await readLayout(db);
    const created = folders.filter(({ id }) => !known.has(id));
    history.push({
      label: text.undoOrder,
      async undo() {
        await db.folders.restoreLayout({
          sessions: before.sessions,
          folders: [
            ...before.folders,
            ...created.map(({ id, orderKey, collapsed }) => ({
              id,
              orderKey,
              collapsed,
              deleted: true,
            })),
          ],
        });
        await readLayout(db);
      },
    });
    return made;
  }

  /**
   * The folders the given ones were and now hold one listed session let it go to where
   * the folder stood; the folder, left with none, goes. Part of the change that left it,
   * so one undo puts both back.
   */
  async function dissolve(db: Store, left: readonly (string | null)[]) {
    const lonely = lonelyFolders(
      tree(listed(sessions, current?.id), folders),
      left,
    );
    for (const { sessionId, place } of lonely)
      await db.folders.place(
        { kind: "session", id: sessionId },
        place.parent,
        place.before,
      );
    if (lonely.length) await readLayout(db);
  }

  /** Sessions into the trash, with one undo; the open one gives way to a neighbour. */
  function removeSessions(ids: readonly string[]): Promise<void> {
    return edit(async (db) => {
      const removed = ids.flatMap(
        (id) => sessions.find((session) => session.id === id) ?? [],
      );
      if (removed.length === 0) return;
      const before = layoutNow();
      const going = new Set(removed.map(({ id }) => id));
      const open = current;
      const wasCurrent = open !== null && going.has(open.id);
      if (wasCurrent) {
        // The neighbour that stays opens, or a new session when none does.
        const shown = listed(sessions, open.id);
        const index = shown.findIndex(({ id }) => id === open.id);
        const next =
          shown
            .slice(0, index)
            .reverse()
            .find(({ id }) => !going.has(id)) ??
          shown.slice(index + 1).find(({ id }) => !going.has(id)) ??
          (await createDefaultSession(db));
        knownSessions.add(next.id);
        await select(db, next);
      }
      for (const { id } of removed) await db.sessions.remove(id);
      await readLayout(db);
      await dissolve(
        db,
        removed.map(({ folderId }) => folderId),
      );
      history.push({
        label: text.undoSession,
        async undo() {
          for (const { id } of removed) await db.sessions.restore(id);
          await db.folders.restoreLayout(before);
          await readLayout(db);
          if (wasCurrent) {
            const back = sessions.find(({ id }) => id === open.id);
            if (back) await select(db, back);
          }
        },
      });
    });
  }

  /** Where the shown solve stands now; with it gone, the newest shows again. */
  async function locateShown(db: Store) {
    if (!shown) return;
    if (shown.sessionId !== current?.id) {
      shown = null;
      return;
    }
    const { index, exists } = await position(db, shown);
    if (exists) shownIndex = index;
    else shown = null;
  }

  function unselect() {
    selected = new Set();
    anchor = null;
  }

  /** The solve the arrows and edits answer for: the one on show, else the newest. */
  function lead(): Solve | undefined {
    return shown ?? rows[0];
  }

  /** One step from the solve on show; false when there is none that way. */
  async function step(db: Store, by: 1 | -1): Promise<boolean> {
    const session = current?.id;
    const from = lead();
    if (!session || !from) return false;
    const next = await beside(db, from, by);
    // A session changed meanwhile keeps its own view.
    if (current?.id !== session || !next) return false;
    await show(db, next);
    return true;
  }

  /** Shows the open session again from the database, then the given solve. */
  async function reread(db: Store, then: Solve | null) {
    if (!current) return;
    await select(db, current, limit);
    if (then) await show(db, then);
  }

  /** Shows a solve; the newest one is the live view. */
  async function show(db: Store, solve: Solve | null) {
    again = null;
    shown = solve && solve.id !== rows[0]?.id ? solve : null;
    await locateShown(db);
  }

  /** The solve before (-1) or after (1) another, from the newest page when it is there. */
  function beside(db: Store, from: Solve, step: 1 | -1) {
    const at = rows.findIndex((row) => row.id === from.id);
    const next = at >= 0 ? rows[at - step] : undefined;
    return next
      ? Promise.resolve(next)
      : db.solves.near(from.sessionId, from, step);
  }

  /** A solve on screen (the newest page or the shown one) by its row. */
  function onScreen(id: string): Solve | undefined {
    return (
      rows.find((row) => row.id === id) ??
      (shown?.id === id ? shown : undefined) ??
      (again?.root.id === id ? again.root : undefined)
    );
  }

  async function writePenalty(db: Store, solve: Solve, penalty: PenaltyFields) {
    const location =
      solve.sessionId === current?.id ? await position(db, solve) : null;
    await db.solves.setPenalty(solve.id, penalty);
    if (location?.exists) {
      await series.change(location.index, true, {
        value: resultValue({ ...solve, ...penalty }),
        at: solve.startedAt,
      });
      rows = rows.map((row) =>
        row.id === solve.id ? { ...row, ...penalty } : row,
      );
    }
    if (shown?.id === solve.id) shown = { ...shown, ...penalty };
    if (again?.root.id === solve.id)
      again = { ...again, root: { ...again.root, ...penalty } };
  }

  async function writeComment(db: Store, id: string, comment: string | null) {
    await db.solves.setComment(id, comment);
    rows = rows.map((row) => (row.id === id ? { ...row, comment } : row));
    if (shown?.id === id) shown = { ...shown, comment };
    if (again?.root.id === id)
      again = { ...again, root: { ...again.root, comment } };
  }

  /** A repeat's fields changed: in the store, and in the list when it is open. */
  async function writeRepeat(
    db: Store,
    repeat: Solve,
    change: Partial<Pick<Solve, "plus2" | "dnf" | "comment">>,
  ) {
    if ("comment" in change)
      await db.repeats.setComment(repeat.id, change.comment ?? null);
    if ("plus2" in change || "dnf" in change)
      await db.repeats.setPenalty(repeat.id, {
        plus2: change.plus2 ?? repeat.plus2,
        dnf: change.dnf ?? repeat.dnf,
      });
    if (again)
      again = {
        ...again,
        repeats: again.repeats.map((item) =>
          item.id === repeat.id ? { ...item, ...change } : item,
        ),
      };
  }

  /** The repeats of the open root as stored, after a delete or its undo. */
  async function rereadRepeats(db: Store, rootId: string, shownId?: string) {
    const repeats = await db.repeats.list(rootId);
    countRepeats(rootId, repeats.length);
    if (again?.root.id === rootId)
      again = {
        ...again,
        repeats,
        shownId: shownId ?? repeats.at(-1)?.id ?? rootId,
      };
  }

  return {
    async averageWindow(solve: Solve, name: StatId, best: boolean) {
      const stat = parseStat(name);
      await queue;
      const db = store;
      if (!stat || !db || current?.id !== solve.sessionId) return [];
      let end: Solve | undefined = solve;
      if (best) {
        const index = series.bestWindowEnd(name);
        if (index < 0) return [];
        const offset = series.count - 1 - index;
        end =
          rows[offset] ??
          (await db.solves.page(solve.sessionId, { limit: 1, offset }))[0];
      }
      return end ? db.solves.getStatWindow(solve.sessionId, end, stat.n) : [];
    },
    get view() {
      return published ?? snapshot();
    },
    session: () => current,
    /** The algorithm trainer's storage, once a database is open. */
    trainer: () => store?.trainer ?? null,
    /** Stored settings (in the backup), for screens that keep their own choices. */
    storedSettings: () => store?.settings ?? null,
    /** Every pending solve, for an emergency download. */
    pendingSolves: () => journal.all(),
    open(next: DbState): Promise<void> {
      return run(async () => {
        if (next === dbState || (next.kind === "busy" && dbState)) return;
        markOpenStep("db-open");
        if (next.kind === "failed" || next.kind === "busy") {
          dbState = next;
          store = undefined;
          series = createSessionStats();
          return;
        }
        store = next.store;
        keymap = parseKeymap(await store.settings.get(keymapKey));
        customTheme = await loadTheme(store.settings);
        ({
          sessions,
          folders,
          current,
          previous: previousId,
        } = await loadSessions(store));
        knownSessions.clear();
        staged = null;
        stagedInSeries = false;
        unwrittenIndex = undefined;
        for (const session of sessions) knownSessions.add(session.id);
        await flush(store, false);
        await select(store, current);
        dbState = next;
      });
    },
    add(solve: Solve): Promise<void> {
      // Journal in the same input turn, before any async database work.
      journal.add(solve);
      if (solve.repeatOf !== undefined) {
        // Another attempt on the repeated scramble: listed and on show at once.
        if (again?.root.id === solve.repeatOf) {
          again = {
            ...again,
            repeats: [...again.repeats, solve],
            shownId: solve.id,
          };
          countRepeats(solve.repeatOf, again.repeats.length);
        }
        return run(async () => {
          if (store) await flush(store);
        });
      }
      // A new solve is the newest: the view is live again, nothing picked.
      shown = null;
      again = null;
      unselect();
      return run(async () => {
        if (store) await flush(store);
      });
    },
    /** What a file holds; nothing is written. */
    async previewImport(file: ImportInput): Promise<ImportPreviewResult> {
      const next = dbState;
      if (
        (next?.kind !== "memory" && next?.kind !== "persistent") ||
        !next.previewImport
      )
        throw new Error("The database is not open");
      return next.previewImport(file);
    },
    async importFile(file: ImportInput): Promise<ImportFileResult> {
      const next = dbState;
      if (
        (next?.kind !== "memory" && next?.kind !== "persistent") ||
        !next.importFile
      )
        throw new Error("The database is not open");
      const importFile = next.importFile;
      let outcome: ImportFileResult | undefined;
      await run(async () => {
        const db = store;
        if (!db || db !== next.store) return;
        // Pending solves land first, so a solve in the starter keeps it.
        await flush(db);
        const result = await importFile(file).catch(() => undefined);
        outcome = result;
        if (!result || "formatError" in result) return;
        await readLayout(db);
        knownSessions.clear();
        for (const session of sessions) knownSessions.add(session.id);
        const shown =
          sessions.find((session) => session.id === current?.id) ??
          sessions.find((session) => session.id === result.firstSession) ??
          sessions[0];
        if (shown) await select(db, shown, limit);
      });
      if (!outcome) throw new Error("The import failed");
      return outcome;
    },
    /** The whole database as native backup JSON, pending solves written first. */
    async exportBackup(): Promise<string> {
      const next = dbState;
      if (
        (next?.kind !== "memory" && next?.kind !== "persistent") ||
        !next.exportBackup
      )
        throw new Error("The database is not open");
      const exportBackup = next.exportBackup;
      let text: string | undefined;
      await run(async () => {
        if (store) await flush(store);
        text = await exportBackup();
      });
      if (text === undefined) throw new Error("The backup failed");
      return text;
    },
    /** The history as another timer's file, pending solves written first. */
    /** Another timer's file of every session, or of the one given. */
    async exportFile(
      format: "cstimer" | "csv",
      sessionId?: string,
    ): Promise<ExportFileResult> {
      const next = dbState;
      if (
        (next?.kind !== "memory" && next?.kind !== "persistent") ||
        !next.exportFile
      )
        throw new Error("The database is not open");
      const exportFile = next.exportFile;
      let result: ExportFileResult | undefined;
      await run(async () => {
        if (store) await flush(store);
        result = await exportFile(format, sessionId);
      });
      if (!result) throw new Error("The export failed");
      return result;
    },
    /** Restores a native backup and reloads what is on screen from the result. */
    async restoreBackup(file: File): Promise<RestoreFileResult> {
      const next = dbState;
      if (
        (next?.kind !== "memory" && next?.kind !== "persistent") ||
        !next.restoreBackup
      )
        throw new Error("The database is not open");
      const restoreBackup = next.restoreBackup;
      let outcome: RestoreFileResult | undefined;
      await run(async () => {
        const db = store;
        if (!db || db !== next.store) return;
        await flush(db);
        outcome = await restoreBackup(file);
        if ("problem" in outcome) return;
        keymap = parseKeymap(await db.settings.get(keymapKey));
        customTheme = await loadTheme(db.settings);
        ({
          sessions,
          folders,
          current,
          previous: previousId,
        } = await loadSessions(db));
        knownSessions.clear();
        for (const session of sessions) knownSessions.add(session.id);
        if (current) await select(db, current);
      });
      if (!outcome) throw new Error("The restore failed");
      return outcome;
    },
    /** Writes every pending solve before the history is replaced (a desktop restore). */
    flushPending(): Promise<void> {
      return run(async () => {
        if (store) await flush(store);
      });
    },
    /**
     * Desktop, when the file had history of its own: merges the earlier version's solves
     * in (as a restore merges) and reloads what is on screen. False: not readable.
     */
    async mergeEarlier(): Promise<boolean> {
      const next = dbState;
      if (next?.kind !== "persistent" || !next.mergeEarlier)
        throw new Error("The database is not open");
      const merge = next.mergeEarlier;
      let merged = false;
      await run(async () => {
        const db = store;
        if (!db || db !== next.store) return;
        await flush(db);
        merged = await merge();
        if (!merged) return;
        ({
          sessions,
          folders,
          current,
          previous: previousId,
        } = await loadSessions(db));
        knownSessions.clear();
        for (const session of sessions) knownSessions.add(session.id);
        if (current) await select(db, current);
        const { mergeEarlier: _, ...rest } = next;
        dbState = { ...rest, handoff: "migrated" };
      });
      return merged;
    },
    setEntry(id: string, entry: Settings["entry"]): Promise<void> {
      return edit(async (db) => {
        if (current?.id !== id) return;
        await changeSetting(db.settings, "entry", entry, id, current.event);
        settings = { ...settings, entry };
      });
    },
    statPreview(ids: readonly StatId[]) {
      return Object.fromEntries(
        ids.map((id) => [
          id,
          series.preview(id, shown ? shownIndex : undefined),
        ]),
      ) as Partial<Record<StatId, number>>;
    },
    resetStatSlots(): Promise<void> {
      return edit(async (db) => {
        if (!current) return;
        const prefs = { ...settings.statSlots };
        delete prefs[slotKey(current.event, settings.layout)];
        await changeSetting(db.settings, "statSlots", prefs);
        settings = { ...settings, statSlots: prefs };
        series.request(sessionWindows(current.event, prefs, settings.layout));
      });
    },
    setStatSlot(index: number, stat: StatId): Promise<void> {
      return edit(async (db) => {
        if (!current || !supportsStat(current.event, stat)) return;
        const slots = [
          ...selectedSlots(current.event, settings.statSlots, settings.layout),
        ];
        const slot = slots[index];
        if (!slot || slot === stat) return;
        const other = slots.indexOf(stat);
        slots[index] = stat;
        if (other >= 0) slots[other] = slot;
        const prefs = {
          ...settings.statSlots,
          [slotKey(current.event, settings.layout)]: slots,
        };
        await changeSetting(db.settings, "statSlots", prefs);
        settings = { ...settings, statSlots: prefs };
        series.request(sessionWindows(current.event, prefs, settings.layout));
      });
    },
    /**
     * Saves a custom theme (validated) or clears its colours and picture (null: the
     * base's colours, no picture). False when it was refused or could not be written;
     * the stored theme is then the one before.
     */
    async setCustomTheme(next: ThemeDocument): Promise<boolean> {
      let saved = false;
      await edit(async (db) => {
        try {
          customTheme = await saveTheme(db.settings, next);
          saved = true;
        } catch {
          // Keep the theme in force when this one was refused or storage is full.
        }
      });
      return saved;
    },
    async setKeymap(next: Keymap): Promise<boolean> {
      if (validateBindings(next, isMacPlatform() ? "mac" : "other").length)
        return false;
      let saved = false;
      await edit(async (db) => {
        try {
          await db.settings.set(keymapKey, JSON.stringify(next));
          keymap = next;
          saved = true;
        } catch {
          // Keep the active bindings when the preference could not be saved.
        }
      });
      return saved;
    },
    // A setting for one session, or for every session without one of its own.
    setSetting<K extends keyof Settings>(
      key: K,
      value: Settings[K],
      sessionId?: string,
    ): Promise<void> {
      return edit(async (db) => {
        // A session's own setting is a choice about it: it stays after an import.
        if (sessionId) await db.sessions.adopt(sessionId);
        await changeSetting(
          db.settings,
          key,
          value,
          sessionId,
          sessions.find((session) => session.id === sessionId)?.event,
        );
        if (current) {
          settings = await loadSettings(
            db.settings,
            current.id,
            browserLanguage(),
            current.event,
          );
          if (key === "statSlots" || key === "layout")
            series.request(
              sessionWindows(
                current.event,
                settings.statSlots,
                settings.layout,
              ),
            );
        }
      });
    },
    selectSession(id: string): Promise<void> {
      return edit(async (db) => {
        const session = sessions.find((item) => item.id === id);
        if (session && current?.id !== id) {
          await db.sessions.adopt(id);
          await select(db, session);
        }
      });
    },
    /** Every session with its newest solve, for the switch. */
    async switchRows(): Promise<(Session & { last: Solve | null })[]> {
      let rows: (Session & { last: Solve | null })[] = sessions.map(
        (session) => ({ ...session, last: null }),
      );
      await run(async () => {
        if (store) rows = await store.sessions.switchRows();
      });
      return rows;
    },
    /**
     * Opens the puzzle's session, making one named `name` if it has none. A second pick
     * before the first lands finds the session the first made.
     */
    openEvent(event: EventId, name: string): Promise<void> {
      return edit(async (db) => {
        // An archived session is put away: its puzzle gets a new one.
        let session = sessions.find(
          (item) => item.event === event && !item.archived,
        );
        if (!session) {
          session = await db.sessions.create({ name, event });
          knownSessions.add(session.id);
          sessions = [...sessions, session];
        }
        if (current?.id !== session.id) await select(db, session);
      });
    },
    newSession(name: string, event: EventId): Promise<void> {
      return edit(async (db) => {
        if (!name.trim()) return;
        const created = await db.sessions.create({ name: name.trim(), event });
        knownSessions.add(created.id);
        sessions = [...sessions, created];
        await select(db, created);
      });
    },
    /**
     * A new session in the list, last, without opening it (the grid's new tile, named
     * in place next). Resolves to its id, or null for an empty name.
     */
    createSession(name: string, event: EventId): Promise<string | null> {
      let id: string | null = null;
      return edit(async (db) => {
        const clean = cleanName(name);
        if (!clean) return;
        const created = await db.sessions.create({ name: clean, event });
        knownSessions.add(created.id);
        await readLayout(db);
        id = created.id;
      }).then(() => id);
    },
    renameSession(id: string, name: string): Promise<void> {
      return edit(async (db) => {
        const session = sessions.find((item) => item.id === id);
        name = name.trim();
        if (!session || !name || session.name === name) return;
        await db.sessions.rename(id, name);
        const renamed = { ...session, name };
        sessions = sessions.map((item) => (item.id === id ? renamed : item));
        if (current?.id === id) current = renamed;
      });
    },
    /** A folder where the first session stands, holding them in order; resolves to its id. */
    groupSessions(
      sessionIds: readonly string[],
      name: string,
    ): Promise<string | null> {
      let id: string | null = null;
      return edit(async (db) => {
        id =
          (await relayout(
            db,
            async () => (await db.folders.create(name, sessionIds)).id,
          )) ?? null;
      }).then(() => id);
    },
    /** Moves a session or folder; one undo puts it back. */
    placeItem(item: LayoutItem, place: Place): Promise<void> {
      return edit(async (db) => {
        const from = sessions.find(({ id }) => id === item.id)?.folderId;
        await relayout(db, async () => {
          await db.folders.place(item, place.parent, place.before);
          if (item.kind === "session" && from && from !== place.parent) {
            await readLayout(db);
            await dissolve(db, [from]);
          }
          return null;
        });
      });
    },
    /** Every session out of a folder, where it stood, in order; the folder goes. One undo. */
    ungroupFolder(id: string): Promise<void> {
      return edit(async (db) => {
        const nodes = tree(listed(sessions, current?.id), folders);
        const at = nodes.findIndex(
          (node) => node.kind === "folder" && node.folder.id === id,
        );
        const host = nodes[at];
        if (host?.kind !== "folder") return;
        const next = nodes[at + 1];
        const before = next
          ? next.kind === "folder"
            ? next.folder.id
            : next.session.id
          : null;
        await relayout(db, async () => {
          for (const session of host.sessions)
            await db.folders.place(
              { kind: "session", id: session.id },
              null,
              before,
            );
          return null;
        });
      });
    },
    renameFolder(id: string, name: string): Promise<void> {
      return edit(async (db) => {
        name = name.trim();
        const folder = folders.find((item) => item.id === id);
        if (!folder || !name || folder.name === name) return;
        await db.folders.rename(id, name);
        folders = folders.map((item) =>
          item.id === id ? { ...item, name } : item,
        );
      });
    },
    /** Out of the list (`value`) or back into it; one undo reverses it. */
    archiveSession(id: string, value: boolean): Promise<void> {
      return edit(async (db) => {
        const session = sessions.find((item) => item.id === id);
        if (!session || session.archived === value) return;
        const wasCurrent = current?.id === id;
        const before = layoutNow();
        if (value && wasCurrent) await leave(db, id);
        await db.sessions.setArchived(id, value);
        await readLayout(db);
        await dissolve(db, [session.folderId]);
        history.push({
          label: text.undoArchive,
          async undo() {
            await db.sessions.setArchived(id, !value);
            await db.folders.restoreLayout(before);
            await readLayout(db);
            const back = sessions.find((item) => item.id === id);
            if (value && wasCurrent && back) await select(db, back);
          },
        });
      });
    },
    /** Several sessions into the trash at once, with one undo. */
    deleteSessions: removeSessions,
    more(): Promise<void> {
      return edit(async (db) => {
        const last = rows.at(-1);
        if (!current || !last || rows.length >= series.count) return;
        const page = await db.solves.page(current.id, {
          limit: pageSize,
          before: last,
        });
        rows.push(...page);
        limit += pageSize;
      });
    },
    page(view: AppView, first: number, last: number) {
      if (last <= view.rows.length || !view.current)
        return Promise.resolve(view.rows.slice(first, last));

      const read = queue.then(async () => {
        const db = store;
        const session = current;
        if (!db || !session || view !== published) return;
        const dates = series.dates;
        const at = dates[dates.length - 1 - first];
        if (at === undefined) return [];
        const limit = last - first;

        // The chronological series lets a deep jump seek into the SQL index.
        // OFFSET normally skips only solves tied at the first timestamp.
        let page: Solve[];
        if (staged && unwrittenIndex !== undefined) {
          const offset = dates.length - 1 - unwrittenIndex;
          const includesStaged = offset >= first && offset < last;
          page = await db.solves.page(session.id, {
            limit: limit - Number(includesStaged),
            offset: first - Number(offset < first),
          });
          if (includesStaged) page.splice(offset - first, 0, staged);
        } else {
          page = await db.solves.page(session.id, {
            atOrBefore: at,
            offset: dateBound(dates, at, true) - dates.length + first,
            limit,
          });
        }
        return page.map((solve, i) => solveRow(solve, first + i));
      });
      const result = read.catch((error: unknown) => {
        fail(error);
        return undefined;
      });
      queue = result.then(() => {});
      return result;
    },
    penalty(target: Solve, action: Penalty): Promise<void> {
      return edit(async (db) => {
        if (target.repeatOf !== undefined) {
          const repeat = again?.repeats.find((item) => item.id === target.id);
          if (!repeat) return;
          const before = { plus2: repeat.plus2, dnf: repeat.dnf };
          const after =
            action === "ok"
              ? { plus2: 0, dnf: false }
              : action === "dnf"
                ? { ...before, dnf: !repeat.dnf }
                : { ...before, plus2: nextPlus2(repeat) };
          if (before.plus2 === after.plus2 && before.dnf === after.dnf) return;
          await writeRepeat(db, repeat, after);
          history.push({
            label: text.undoPenalty,
            undo: () => writeRepeat(db, repeat, before),
          });
          return;
        }
        const solve = onScreen(target.id);
        if (!solve) return;
        if (action === "plus2" && !hasTimePenalty(solve.event)) return;
        const before = { plus2: solve.plus2, dnf: solve.dnf };
        const after =
          action === "ok"
            ? { plus2: 0, dnf: false }
            : action === "dnf"
              ? { ...before, dnf: !solve.dnf }
              : { ...before, plus2: nextPlus2(solve) };
        if (before.plus2 === after.plus2 && before.dnf === after.dnf) return;
        await writePenalty(db, solve, after);
        history.push({
          label: text.undoPenalty,
          undo: () => writePenalty(db, solve, before),
        });
      });
    },
    setComment(target: Solve, comment: string | null): Promise<void> {
      return edit(async (db) => {
        if (target.repeatOf !== undefined) {
          const repeat = again?.repeats.find((item) => item.id === target.id);
          const next = comment === "" ? null : comment;
          if (!repeat || repeat.comment === next) return;
          await writeRepeat(db, repeat, { comment: next });
          history.push({
            label: text.undoComment,
            undo: () => writeRepeat(db, repeat, { comment: repeat.comment }),
          });
          return;
        }
        if (target.sessionId !== current?.id) return;
        const solve = onScreen(target.id) ?? (await db.solves.get(target.id));
        const next = comment === "" ? null : comment;
        if (!solve || solve.comment === next) return;
        await writeComment(db, solve.id, next);
        history.push({
          label: text.undoComment,
          undo: () => writeComment(db, solve.id, solve.comment),
        });
      });
    },
    deleteSolve(target: Solve): Promise<void> {
      return edit(async (db) => {
        if (target.repeatOf !== undefined) {
          const rootId = target.repeatOf;
          const index = again?.repeats.findIndex(({ id }) => id === target.id);
          if (!again || index === undefined || index < 0) return;
          // The attempt before it shows, or the root.
          const before = again.repeats[index - 1]?.id ?? rootId;
          await db.repeats.remove(target.id);
          await rereadRepeats(db, rootId, before);
          history.push({
            label: text.undoSolve,
            async undo() {
              await db.repeats.restore(target.id);
              await rereadRepeats(db, rootId, target.id);
            },
          });
          return;
        }
        // A root goes with its repeats; the timer leaves its scramble.
        if (again?.root.id === target.id) again = null;
        const offset = rows.findIndex((row) => row.id === target.id);
        const solve = onScreen(target.id);
        if (!solve || solve.sessionId !== current?.id) return;
        const { index } = await position(db, solve);
        // A shown solve gives its place to the one before it, else the one after.
        const wasShown = shown?.id === solve.id;
        const replacement = wasShown
          ? ((await beside(db, solve, -1)) ??
            (await beside(db, solve, 1)) ??
            null)
          : undefined;
        const last = rows.at(-1);
        await db.solves.remove(solve.id);
        await series.change(index, true);
        if (offset >= 0) {
          rows.splice(offset, 1);
          if (last && rows.length < series.count) {
            rows.push(
              ...(await db.solves.page(solve.sessionId, {
                limit: 1,
                before: last,
              })),
            );
          }
        }
        if (replacement !== undefined) await show(db, replacement);
        else await locateShown(db);
        history.push({
          label: text.undoSolve,
          async undo() {
            const location =
              solve.sessionId === current?.id
                ? await position(db, solve)
                : null;
            await db.solves.restore(solve.id);
            if (location) await insert(solve, location.index);
            // Back the way it went: the restored solve shows again.
            if (wasShown && location) await show(db, solve);
          },
        });
      });
    },
    /**
     * ↑ (-1) or ↓ (1): the solve before or after the one shown; past the newest, live.
     * Resolves to whether there was one to go to.
     */
    browse(by: 1 | -1): Promise<boolean> {
      let moved = false;
      return edit(async (db) => {
        moved = await step(db, by);
        if (moved) unselect();
      }).then(() => moved);
    },
    /**
     * Shift+↑ ↓: a step that picks the solves from where the picking started to the one
     * now on show, so going back un-picks.
     */
    extend(by: 1 | -1): Promise<boolean> {
      let moved = false;
      return edit(async (db) => {
        const start = anchor ?? lead();
        if (!start || !current) return;
        moved = await step(db, by);
        const end = lead();
        if (!moved || !end) return;
        anchor = start;
        selected = new Set(await db.solves.ids(current.id, start, end));
      }).then(() => moved);
    },
    /** Mod+click: one solve in or out of the picked ones, with the one on show. */
    toggleSelected(id: string): Promise<void> {
      return edit(async (db) => {
        const solve = onScreen(id) ?? (await db.solves.get(id));
        if (!solve || solve.sessionId !== current?.id) return;
        const next = new Set(selected);
        if (next.size === 0 && shown && shown.id !== id) next.add(shown.id);
        if (next.has(id)) next.delete(id);
        else {
          next.add(id);
          anchor = solve;
        }
        selected = next;
        if (next.size === 0) anchor = null;
      });
    },
    /** Shift+click: the solves from where the picking started to this one. */
    selectRange(id: string): Promise<void> {
      return edit(async (db) => {
        const session = current?.id;
        const start = anchor ?? lead();
        const solve = onScreen(id) ?? (await db.solves.get(id));
        if (!session || !start || !solve || solve.sessionId !== session) return;
        anchor = start;
        selected = new Set(await db.solves.ids(session, start, solve));
      });
    },
    clearSelection(): Promise<void> {
      return run(async () => {
        unselect();
      });
    },
    /**
     * The picked solves, else the one on show, else the newest, into another session of
     * their puzzle, or into a new one by name; the open session stays open.
     */
    moveSolves(to: string | { name: string }): Promise<MoveResult> {
      let result: MoveResult = { error: "nothing" };
      return edit(async (db) => {
        const session = current;
        const first = lead();
        if (!session || !first) return;
        const ids = selected.size > 0 ? [...selected] : [first.id];
        const made =
          typeof to === "string"
            ? null
            : await db.sessions.create({ name: to.name, event: session.event });
        const target = made?.id ?? (to as string);
        let moved: Array<{ id: string; from: string }>;
        try {
          moved = await db.solves.move(ids, target);
        } catch (error) {
          if (!(error instanceof MoveError)) throw error;
          result = { error: error.reason };
          if (made) await readLayout(db);
          return;
        }
        await readLayout(db);
        if (made) knownSessions.add(made.id);
        const destination = sessions.find(({ id }) => id === target);
        if (!destination) return;
        result = { moved: moved.length, to: destination };
        if (moved.length === 0) return;
        // A shown solve that went gives its place to the one before it, else after it.
        const gone = new Set(moved.map(({ id }) => id));
        const wasShown = shown && gone.has(shown.id) ? shown : null;
        const after = wasShown
          ? ((await db.solves.near(session.id, wasShown, -1)) ??
            (await db.solves.near(session.id, wasShown, 1)) ??
            null)
          : shown;
        await reread(db, after);
        history.push({
          label: text.undoMove,
          async undo() {
            const back = new Map<string, string[]>();
            for (const { id, from } of moved) {
              const list = back.get(from);
              if (list) list.push(id);
              else back.set(from, [id]);
            }
            for (const [from, list] of back) {
              try {
                await db.solves.move(list, from);
              } catch (error) {
                // Its session went meanwhile: those stay where they are.
                if (!(error instanceof MoveError)) throw error;
              }
            }
            const returned = wasShown && (await db.solves.get(wasShown.id));
            await reread(
              db,
              returned && returned.sessionId === current?.id ? returned : shown,
            );
          },
        });
      }).then(() => result);
    },
    /**
     * Sessions of one puzzle into another of it, every solve with them, with one undo.
     * An open session that went gives way to the one it went into; undo opens it again.
     */
    mergeSessions(
      sourceIds: readonly string[],
      targetId: string,
    ): Promise<MergeResult> {
      let result: MergeResult = { error: "nothing" };
      return edit(async (db) => {
        if (sourceIds.length === 0) return;
        const openId = current?.id ?? null;
        let receipt: MergeReceipt;
        try {
          receipt = await db.sessions.merge(sourceIds, targetId);
        } catch (error) {
          if (!(error instanceof MergeError)) throw error;
          result = { error: error.reason };
          return;
        }
        await readLayout(db);
        const into = sessions.find(({ id }) => id === targetId);
        if (!into) return;
        result = { into };
        const absorbed = new Set(receipt.sources);
        if (previousId !== null && absorbed.has(previousId))
          previousId = openId === targetId ? null : targetId;
        const wasOpen = openId !== null && absorbed.has(openId);
        if (wasOpen) {
          knownSessions.add(into.id);
          await select(db, into);
        } else if (openId === targetId) await reread(db, shown);
        history.push({
          label: text.undoMerge,
          async undo() {
            try {
              await db.sessions.undoMerge(receipt);
            } catch (error) {
              // Its sessions are gone for good: there is nothing to put back.
              if (!(error instanceof MergeError)) throw error;
              return;
            }
            await readLayout(db);
            const back = sessions.find(({ id }) => id === openId);
            if (wasOpen && back && current?.id === targetId)
              await select(db, back);
            else if (current?.id === targetId) await reread(db, shown);
          },
        });
      }).then(() => result);
    },
    /**
     * Everything in the open session before the given solve into a new session of its
     * puzzle, just above it in the list, named from the last solve that goes; the open
     * session keeps the solve and what follows, and stays open, with one undo.
     */
    splitBefore(
      pivotId: string,
      name: (last: Solve, session: Session) => string,
    ): Promise<SplitResult> {
      let result: SplitResult = { error: "nothing" };
      return edit(async (db) => {
        const session = current;
        const pivot = onScreen(pivotId) ?? (await db.solves.get(pivotId));
        if (!session || !pivot || pivot.sessionId !== session.id) return;
        const last = await db.solves.near(session.id, pivot, -1);
        if (!last) {
          result = { error: "first" };
          return;
        }
        let receipt: SplitReceipt;
        try {
          receipt = await db.sessions.splitBefore(
            session.id,
            pivot.id,
            name(last, session),
            { settingKey: sessionSettingsKey },
          );
        } catch (error) {
          if (!(error instanceof SplitError)) throw error;
          result = { error: error.reason };
          return;
        }
        unselect();
        await readLayout(db);
        knownSessions.add(receipt.sessionId);
        const into = sessions.find(({ id }) => id === receipt.sessionId);
        // Hidden solves went too, but the count is of what the person sees.
        if (into)
          result = { moved: await db.solves.count(receipt.sessionId), into };
        // A solve on show that went gives way to the pivot, the first one left.
        const wasShown =
          shown && receipt.moved.includes(shown.id) ? shown : null;
        await reread(db, wasShown ? pivot : shown);
        history.push({
          label: text.undoSplit,
          async undo() {
            try {
              await db.sessions.undoSplit(receipt);
            } catch (error) {
              // A session went meanwhile: there is nothing to put back.
              if (!(error instanceof SplitError)) throw error;
              return;
            }
            await readLayout(db);
            if (!sessions.some(({ id }) => id === receipt.sessionId))
              knownSessions.delete(receipt.sessionId);
            if (current?.id === receipt.sessionId) {
              const back = sessions.find(({ id }) => id === session.id);
              if (back) await select(db, back);
            } else if (current?.id === session.id) await reread(db, shown);
          },
        });
      }).then(() => result);
    },
    /** ⌫ with solves picked: all of them, with one undo. */
    deleteSelected(): Promise<void> {
      return edit(async (db) => {
        const session = current;
        const ids = [...selected];
        if (!session || ids.length === 0) return;
        const wasShown = shown && selected.has(shown.id) ? shown : null;
        for (const id of ids) await db.solves.remove(id);
        const after = wasShown
          ? ((await db.solves.near(session.id, wasShown, -1)) ??
            (await db.solves.near(session.id, wasShown, 1)) ??
            null)
          : shown;
        await reread(db, after);
        history.push({
          label: text.undoSolves,
          async undo() {
            for (const id of ids) await db.solves.restore(id);
            const returned = wasShown && (await db.solves.get(wasShown.id));
            if (current?.id === session.id) await reread(db, returned || shown);
          },
        });
      });
    },
    /** Shows a solve of the open session, picked by its row in the file. */
    showSolve(id: string): Promise<void> {
      return edit(async (db) => {
        const session = current?.id;
        const solve = onScreen(id) ?? (await db.solves.get(id));
        if (!solve || current?.id !== session || solve.sessionId !== session)
          return;
        unselect();
        await show(db, solve);
      });
    },
    /** Back to the newest solve. */
    live(): Promise<void> {
      return run(async () => {
        shown = null;
        again = null;
        unselect();
      });
    },
    /**
     * R: the scramble of the solve on show (else the newest) is timed again; each timed
     * attempt is saved as a repeat of it. Resolves to false when there is no such solve
     * or its puzzle is not timed.
     */
    repeat(): Promise<boolean> {
      let entered = false;
      return edit(async (db) => {
        const from = lead();
        if (!from || !current || from.sessionId !== current.id) return;
        if (eventInfo(from.event).kind !== "time") return;
        const no = shown ? shownIndex + 1 : series.count;
        const repeats = await db.repeats.list(from.id);
        shown = null;
        unselect();
        again = {
          root: from,
          no,
          repeats,
          shownId: repeats.at(-1)?.id ?? from.id,
        };
        entered = true;
      }).then(() => entered);
    },
    /** An attempt in the list goes on show; edits go to it. */
    showAttempt(id: string): Promise<void> {
      return run(async () => {
        if (
          again &&
          (again.root.id === id || again.repeats.some((item) => item.id === id))
        )
          again = { ...again, shownId: id };
      });
    },
    /** Shows the view again, for a new local day (midnight, or the tab coming back). */
    refreshDay(): Promise<void> {
      return run(async () => {});
    },
    /** Esc, ← → or a new session: the timer takes new scrambles again. */
    leaveRepeat(): Promise<void> {
      return run(async () => {
        again = null;
      });
    },
    /** What is in the trash now, newest first. */
    async trash(at = Date.now()): Promise<TrashEntry[]> {
      let entries: TrashEntry[] = [];
      await run(async () => {
        if (store) entries = await store.trash.list(at);
      });
      return entries;
    },
    /** A session or solve out of the trash, back where it was. */
    restoreFromTrash(entry: TrashEntry): Promise<void> {
      return edit(async (db) => {
        await db.trash.restore(entry.kind, entry.id);
        if (entry.kind === "session") {
          await readLayout(db);
          knownSessions.add(entry.id);
        } else if (current && entry.solve.sessionId === current.id)
          await select(db, current, limit);
      });
    },
    /**
     * Removes for good what has been in the trash 30 days. Batches go straight to the
     * store, so the timer is never held behind them; nothing shown changes.
     */
    expireTrash(at = Date.now()): Promise<number> {
      return store ? store.trash.expire(at) : Promise.resolve(0);
    },
    undo(): Promise<void> {
      return edit(async (db) => {
        await history.undo();
        await locateShown(db);
        if (again && !(await db.solves.get(again.root.id))) again = null;
      });
    },
  };
}

export type AppState = ReturnType<typeof createAppState>;
