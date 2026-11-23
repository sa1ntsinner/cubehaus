import {
  type EventId,
  inspectionPenalty,
  isEventId,
  type Solve,
} from "@cubehaus/core";
import type { Store } from "@cubehaus/storage";
import type { TimerInput, TimerPhase } from "@cubehaus/timer";
import { currentSessionKey, previousSessionKey } from "../db/flow";
import type { BackupMeta, NativeBackups } from "../db/native";
import { type DbState, openDatabase } from "../db/open";
import { targetKey } from "../screens/ProgressTarget";
import {
  DEFAULT_SETTINGS,
  globalSettingsKey,
  type Settings,
} from "../settings";
import { isThemeChoice } from "../theme";
import { customThemeKey, luminance, type ThemeDocument } from "../theme-editor";
import {
  cleanSizes,
  DEFAULT_SIZES,
  VIEW_PARTS,
  type ViewSizes,
  viewSizesKey,
} from "../view-size";
import { inspectionStates, namedStates, progressHistories } from "./states";

export interface TimerSeed {
  steps: readonly TimerInput[];
  elapsedMs: number;
}

export interface Seed {
  state: string;
  event: EventId;
  name: string;
  settings: Settings;
  phase: TimerPhase;
  timer?: TimerSeed;
  /** The URL's theme: a seeded custom theme's base. */
  base: "dark" | "light";
}

const stoppedTimes: Partial<Record<string, number>> = {
  stopped: 11_284,
  "cross-line": 11_284,
  "stopped-plus2": 11_284,
  "stopped-dnf": 11_284,
  record: 8_284,
};

const rowCounts: Partial<Record<string, number>> = {
  "stat-picker": 60,
  "stat-custom": 60,
  one: 1,
  two: 2,
  long: 1,
  mbld: 1,
  session: 60,
  today: 12,
  progress: 60,
  browsing: 60,
  repeat: 60,
  "repeat-long": 60,
  comment: 12,
  selection: 60,
  move: 60,
  stopped: 12,
  "stopped-plus2": 12,
  "stopped-dnf": 12,
  record: 12,
  "layout-times": 12,
  "layout-focus": 12,
  "quiet-record": 12,
  "wide-time": 12,
  "too-short": 12,
  switch: 12,
  "switch-archive": 12,
  "switch-trash": 12,
  "switch-few": 12,
  "switch-many": 12,
  "switch-folder": 12,
  "switch-new": 12,
  "switch-menu": 12,
  "switch-rename": 12,
  "sizes-large": 12,
  "sizes-small": 12,
  "theme-custom": 12,
  "theme-image": 12,
  "cross-mark": 60,
  "cross-line": 60,
  "settings-cross": 60,
  "drill-cross": 60,
};

/**
 * Colour neutrality's shots: solves in blocks of 12 on white, then yellow, white, … with
 * yellow slower, so the assignment has a history and Progress a gap to show.
 */
const crossStates = new Set([
  "cross-mark",
  "cross-line",
  "settings-cross",
  "drill-cross",
  "progress-cross",
]);

// The switch shows a practice of several puzzles, each session with its last result.
const switchSessions: readonly {
  name: string;
  event: EventId;
  timeMs: number;
  plus2?: number;
  dnf?: boolean;
}[] = [
  { name: "2×2", event: "222", timeMs: 3_871 },
  { name: "OH", event: "333oh", timeMs: 19_402, plus2: 1 },
  { name: "4×4 reduction", event: "444", timeMs: 51_236 },
  { name: "Blindfolded", event: "333bf", timeMs: 94_510, dnf: true },
];

// Where solves can go from the 3×3 session (the move sheet), and one that cannot take them.
const moveSessions: readonly {
  name: string;
  event: EventId;
  timeMs: number;
}[] = [
  { name: "Home", event: "333", timeMs: 11_384 },
  { name: "Comp prep", event: "333", timeMs: 9_917 },
  { name: "2×2", event: "222", timeMs: 3_871 },
];

const fixtureEvents: Partial<Record<string, EventId>> = {
  long: "777",
  fm: "333fm",
  mbld: "333mbf",
};

function timerFor(state: string): Pick<Seed, "phase" | "timer"> {
  const inspect = inspectionStates[state as keyof typeof inspectionStates];
  if (inspect !== undefined)
    return {
      phase: "inspecting",
      timer: {
        steps: [
          { type: "press", at: -inspect - 10 },
          { type: "release", at: -inspect },
        ],
        elapsedMs: inspect,
      },
    };

  switch (state) {
    case "holding":
      return {
        phase: "holding",
        timer: { steps: [{ type: "press", at: -150 }], elapsedMs: 0 },
      };
    case "ready":
      return {
        phase: "ready",
        timer: {
          steps: [
            { type: "press", at: -300 },
            { type: "tick", at: 0 },
          ],
          elapsedMs: 0,
        },
      };
    case "running":
    case "cross-line":
    case "stopped":
    case "stopped-plus2":
    case "stopped-dnf":
    case "record":
    case "too-short": {
      const elapsedMs =
        stoppedTimes[state] ?? (state === "running" ? 8_437 : 42);
      const inspection = stoppedInspection(state);
      const steps: TimerInput[] = [];
      if (inspection !== null) {
        const begins = -elapsedMs - inspection;
        steps.push(
          { type: "press", at: begins - 10 },
          { type: "release", at: begins },
        );
      }
      steps.push(
        { type: "press", at: -elapsedMs - 300 },
        { type: "release", at: -elapsedMs },
      );
      if (state !== "running") steps.push({ type: "press", at: 0 });
      return {
        phase:
          state === "running"
            ? "running"
            : state === "too-short"
              ? "idle"
              : "stopped",
        timer: { steps, elapsedMs },
      };
    }
    case "drill-choice":
    case "drill-choice-result":
      return {
        phase: "inspecting",
        timer: {
          steps: [
            { type: "press", at: -4_010 },
            { type: "release", at: -4_000 },
          ],
          elapsedMs: 4_000,
        },
      };
    default:
      return { phase: "idle" };
  }
}

export function parseSeed(search: string): Seed | undefined {
  const params = new URLSearchParams(search);
  const state = params.get("state");
  if (!state) return undefined;
  const eventState = state.startsWith("event-") ? state.slice(6) : "";
  if (
    !isEventId(eventState) &&
    !(namedStates as readonly string[]).includes(state)
  )
    return undefined;
  const event = isEventId(eventState)
    ? eventState
    : (fixtureEvents[state] ?? "333");
  const theme = params.get("theme");
  const timer = timerFor(state);
  return {
    state,
    event,
    base: theme === "light" ? "light" : "dark",
    name:
      state === "long"
        ? "Seven by seven practice — Saturday evening session number 01"
        : state === "progress-scopes"
          ? "A"
          : params.get("lang") === "ru"
            ? "Тренировка"
            : "Practice",
    settings: {
      ...DEFAULT_SETTINGS,
      theme: customStates.has(state)
        ? "custom"
        : isThemeChoice(theme)
          ? theme
          : "system",
      language: params.get("lang") === "ru" ? "ru" : "en",
      calls: "off",
      startMode: state.startsWith("two-hand-") ? "two-hand" : "space",
      layout:
        state === "layout-times"
          ? "times"
          : state === "layout-focus"
            ? "focus"
            : "lift",
      recordCue: state !== "quiet-record",
      today: state === "today",
      sizes: sizesFor(state, params.get("sizes")),
      // White on top for these shots; the rest keep the default, yellow on top.
      holding: state.endsWith("-white") ? "UF" : "DF",
      precision: state === "wide-time" ? 3 : 2,
      inspection:
        state.startsWith("two-hand-") ||
        (timer.timer &&
          timer.phase !== "inspecting" &&
          stoppedInspection(state) === null)
          ? "off"
          : "official",
      entry: state === "entry" || state === "entry-error" ? "typing" : "timer",
      cross: crossStates.has(state) ? "assigned" : "any",
      crossColours:
        state === "settings-cross" || state.startsWith("drill-choice")
          ? ["white", "yellow", "green", "blue"]
          : null,
      training: state.startsWith("drill-choice")
        ? { request: null, choice: true }
        : state === "drill-cross"
          ? { request: { kind: "easy-cross", face: "U", length: 4 } }
          : state === "drill-line"
            ? { request: { kind: "easy-xcross", face: "U", length: 3 } }
            : state === "drills" ||
                state === "drill-none" ||
                state === "drills-white"
              ? { request: { kind: "pll", caseIds: [] } }
              : state === "drills-oll"
                ? { request: { kind: "oll", caseIds: [] } }
                : { request: null },
    },
    ...timer,
  };
}

const customStates = new Set(["theme-custom", "theme-image", "settings-theme"]);

/**
 * A custom theme on the URL's theme as its base: a blue-black or paper ground with its
 * own text, and for `theme-image` a soft diagonal picture drawn here.
 */
function seededTheme(state: string, base: "dark" | "light"): ThemeDocument {
  const tokens =
    base === "dark"
      ? {
          ground: "#121820",
          ink: "#ece8e1",
          line: "#1e2631",
          gutter: "#9aa6b2",
        }
      : { ground: "#f8f4ec", ink: "#1d1a16", line: "#efe9dd" };
  if (state !== "theme-image") return { version: 1, base, tokens, image: null };
  const [from, to] =
    base === "dark" ? ["#0f2236", "#2c4f6b"] : ["#e9a56a", "#efd389"];
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 300;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 480, 300);
    gradient.addColorStop(0, from);
    gradient.addColorStop(1, to);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 480, 300);
  }
  const data = canvas.toDataURL("image/png").split(",")[1] ?? "";
  const tones = [luminance(from), luminance(to)].sort((a, b) => a - b) as [
    number,
    number,
  ];
  return {
    version: 1,
    base,
    tokens,
    image: {
      mime: "image/png",
      data,
      strength: base === "dark" ? 0.3 : 0.2,
      tones,
    },
  };
}

/** `sizes=70,150,…` sets the parts in VIEW_PARTS order (the layout sweep); a part not
 * given keeps its state's size, a value off the scale falls back to 100. */
function sizesFor(state: string, param: string | null): ViewSizes {
  const base = stateSizes(state);
  if (!param) return base;
  const values = param.split(",").map(Number);
  return cleanSizes(
    Object.fromEntries(
      VIEW_PARTS.map((part, index) => [
        part,
        Number.isInteger(values[index]) ? values[index] : base[part],
      ]),
    ),
  );
}

function stateSizes(state: string): ViewSizes {
  const all = (percent: number): ViewSizes => ({
    scramble: percent,
    picture: percent,
    time: percent,
    averages: percent,
    times: percent,
  });
  if (state === "sizes-large") return all(150);
  if (state === "sizes-small") return all(70);
  return DEFAULT_SIZES;
}

function stoppedInspection(state: string): number | null {
  if (state === "stopped-plus2") return 15_800;
  if (state === "stopped-dnf") return 17_200;
  return null;
}

const sample333 = "R2 U' F2 D L2 B' R U2 F' D2 L B2 U R' D' F L' U B";
const sample777 =
  "3Rw2 Uw' R2 Dw 3Lw2 Bw' R U2 Fw' D2 L 3Bw2 Uw Rw' D' 3Fw L' U B";
const sampleMulti = [
  sample333,
  "F2 U R2 D' L2 B2 R' F U2 L D2 B' U' R2 D F' U L' B2",
  "U2 L' B2 D R' F2 U L2 D' B R2 F' D2 U' L B2 D R U2",
].join("\n");

const sampleBrowsed =
  "D2 B2 U' L2 F2 D' R2 U2 F2 U' B' L' U2 F D' L2 B' R D2 F'";

export function seededSolves(seed: Seed, sessionId: string): Solve[] {
  const { state, event } = seed;
  if (state === "average-window" || state === "average-fallback") {
    const values = [
      [10000, "R"],
      [11000, "U"],
      [12000, "F"],
      [11000, "L"],
      [15000, "D"],
      [1000, "B"],
    ] as const;
    return values.map(([timeMs, scramble], index) => ({
      id: `average-${index + 1}`,
      sessionId,
      event,
      timeMs,
      plus2: index === 3 ? 1 : 0,
      dnf: index === 4,
      scramble,
      startedAt: Date.UTC(2025, 10, 1, 11, Math.min(index, 4)),
      inspectionMs: null,
      comment: null,
      input: "keyboard",
    }));
  }
  let random = 0x2f6b9a1d;
  const count = rowCounts[state] ?? 0;
  const history = count === 60;
  const scramble =
    event === "777" ? sample777 : event === "333mbf" ? sampleMulti : sample333;
  const finalTime =
    state === "wide-time"
      ? 599_999
      : state === "quiet-record"
        ? stoppedTimes.record
        : (stoppedTimes[state] ?? (history ? 8_284 : undefined));
  return Array.from({ length: count }, (_, index) => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const newest = index === count - 1;
    const inspectionMs = history
      ? index === 30
        ? 15_800
        : index === 40
          ? 17_200
          : null
      : newest
        ? stoppedInspection(state)
        : null;
    const automatic = inspectionPenalty(inspectionMs);
    // Browsing shows the fifth newest: a +2, a comment and a scramble of its own.
    const browsed = state === "browsing" && index === count - 5;
    const manualPlus2 =
      history && (index === 10 || index === 30 || browsed) ? 1 : 0;
    let timeMs = 12_000 + (random % 8_000);
    const crossColour = crossStates.has(state)
      ? Math.floor(index / 12) % 2
        ? ("yellow" as const)
        : ("white" as const)
      : undefined;
    if (crossColour === "yellow") timeMs = Math.round(timeMs * 1.3);
    if (state === "long") timeMs = 3_723_000;
    else if (state === "mbld") timeMs = 1_470_000;
    else if (newest && finalTime !== undefined) timeMs = finalTime;
    else if (!history && index === 0 && state !== "record") timeMs = 10_000;
    return {
      id: `eyes-solve-${index}`,
      sessionId,
      event,
      timeMs,
      plus2: automatic.plus2 + manualPlus2,
      dnf: automatic.dnf,
      inspectionMs,
      scramble: browsed ? sampleBrowsed : scramble,
      // Solves today are dated by the page's clock: the last minutes before it opened.
      startedAt:
        state === "today"
          ? Date.now() - (count - index) * 90_000
          : Date.UTC(2026, 10, 1) + index * 3_600_000,
      comment: browsed ? "Lost the last pair, found it again" : null,
      input: "keyboard",
      ...(event === "333mbf" ? { cubesSolved: 3, cubesAttempted: 3 } : {}),
      ...(crossColour ? { crossColour } : {}),
    };
  });
}

/**
 * Twenty blocks of 12 on white and yellow in turn, then a mix: white about 12.4, yellow
 * from 40 % slower closing to about 12 %; green and blue joined later, still far behind.
 */
function colourHistory(sessionId: string): Solve[] {
  let random = 0x1c0105;
  const next = () => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    return random / 2 ** 32;
  };
  const solves: Solve[] = [];
  const first = Date.UTC(2026, 9, 1, 17);
  const total = 360;
  for (let index = 0; index < total; index++) {
    const colour =
      index < 240
        ? Math.floor(index / 12) % 2
          ? "yellow"
          : "white"
        : index < 312
          ? ((["white", "yellow", "green", "blue"] as const)[
              Math.floor(next() * 4)
            ] ?? "white")
          : index % 2
            ? "green"
            : "blue";
    const gap =
      colour === "yellow"
        ? 0.4 - 0.28 * (index / total)
        : colour === "green"
          ? 0.3
          : colour === "blue"
            ? 0.36
            : 0;
    const base = 12_400 * (1 + gap);
    solves.push({
      id: `eyes-colour-${String(index).padStart(4, "0")}`,
      sessionId,
      event: "333",
      timeMs: Math.round(base + (next() - 0.5) * 2_400),
      plus2: index % 41 === 17 ? 1 : 0,
      dnf: index % 53 === 29,
      inspectionMs: null,
      scramble: sample333,
      startedAt:
        first + Math.floor(index / 12) * 86_400_000 + (index % 12) * 150_000,
      comment: null,
      input: "keyboard",
      crossColour: colour,
    });
  }
  return solves;
}

type ProgressHistory = keyof typeof progressHistories;

/**
 * Weeks of practice ending `ago` days before today, at local evening hours: most days
 * hold ten solves spread round the day's median (a DNF or a +2 now and then), some days
 * are skipped, and today has three. Dated from the page's own clock, so the estimate,
 * the calendar and "today" read as they would for a person practising now.
 */
function historySolves(
  history: (typeof progressHistories)[ProgressHistory],
  sessionId: string,
): Solve[] {
  const { from, to, days, ago } = history;
  const spread = [-1_800, -1_100, -600, -250, 0, 300, 700, 1_300, 2_100, 3_000];
  const now = new Date();
  let random = 0x51ed27;
  const next = () => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    return random / 2 ** 32;
  };
  // A flat history keeps every day's median exactly the same: no penalties move it.
  const penalties = from !== to;
  const solves: Solve[] = [];
  const add = (startedAt: number, timeMs: number) => {
    const index = solves.length;
    solves.push({
      id: `eyes-history-${String(index).padStart(4, "0")}`,
      sessionId,
      event: "333",
      timeMs: Math.round(timeMs),
      plus2: penalties && index % 37 === 11 ? 1 : 0,
      dnf: penalties && index % 29 === 7,
      inspectionMs: null,
      scramble: sample333,
      startedAt,
      comment: null,
      input: "keyboard",
    });
  };
  for (let step = days - 1; step >= 0; step--) {
    // The last day always counts; about one in four of the others is skipped.
    if (step > 0 && step < days - 1 && next() < 0.25) continue;
    const median =
      to +
      ((from - to) * step) / Math.max(1, days - 1) +
      (penalties ? (next() - 0.5) * 500 : 0);
    const evening = new Date(now);
    evening.setDate(evening.getDate() - (ago + step + 1));
    evening.setHours(18, 0, 0, 0);
    for (const [slot, offset] of spread.entries())
      add(evening.getTime() + slot * 180_000, median + offset);
  }
  // Today: three solves in the last few minutes.
  if (ago === 0)
    for (const slot of [0, 1, 2])
      add(now.getTime() - (3 - slot) * 120_000, to + (spread[slot * 4] ?? 0));
  return solves;
}

/**
 * The database that would not open, in each form the banner takes. Nothing here touches a
 * file: a restore that "works" never settles, so the shot shows it under way.
 */
function failedSeed(state: string): DbState | undefined {
  const never = () => new Promise<never>(() => {});
  const readable = async () => "{}";
  switch (state) {
    case "db-failed":
      return {
        kind: "failed",
        reason: "file is not a database",
        recovery: { restoreFile: never, saveReadable: readable },
      };
    case "db-failed-desktop":
    case "db-restoring":
      return {
        kind: "failed",
        reason: "file is not a database",
        recovery: { restoreLatest: never, saveReadable: readable },
      };
    case "db-restore-failed":
      return {
        kind: "failed",
        reason: "file is not a database",
        recovery: {
          restoreLatest: async () => {
            throw new Error("disk full");
          },
          saveReadable: readable,
        },
      };
    case "db-newer":
      return { kind: "failed", reason: "schema 99", newer: true };
    case "db-unwritable":
      return { kind: "failed", reason: "no storage" };
  }
  return undefined;
}

export async function openSeed(seed: Seed): Promise<DbState> {
  if (seed.state === "db-busy") return { kind: "busy" };
  const failed = failedSeed(seed.state);
  if (failed) return failed;
  const db = await openDatabase({ memory: true }).initial;
  if (db.kind !== "memory") return db;
  const { store } = db;
  const session = await store.sessions.create({
    event: seed.event,
    name: seed.name,
  });
  await store.settings.set(currentSessionKey, session.id);
  await store.settings.set(globalSettingsKey, JSON.stringify(seed.settings));
  await store.settings.set(viewSizesKey, JSON.stringify(seed.settings.sizes));
  if (customStates.has(seed.state))
    await store.settings.set(
      customThemeKey,
      JSON.stringify(seededTheme(seed.state, seed.base)),
    );
  for (const solve of seededSolves(seed, session.id))
    await store.solves.add(solve);
  if (seed.state.startsWith("train")) await seedTrainer(store);
  if (seed.state === "train-f2l-cross")
    await store.settings.set("trainer.f2lCross", "green");
  if (seed.state === "repeat" || seed.state === "repeat-long") {
    // Three more attempts on the fourth newest solve's scramble, one of them the best; a
    // long practice of one scramble has twelve.
    const attempts: [number, number][] =
      seed.state === "repeat"
        ? [
            [11_240, 0],
            [13_910, 1],
            [10_380, 0],
          ]
        : Array.from({ length: 12 }, (_, index) => [
            11_900 - index * 110 + (index % 3) * 260,
            index === 4 ? 1 : 0,
          ]);
    for (const [index, [timeMs, plus2]] of attempts.entries())
      await store.solves.add({
        id: `eyes-repeat-${index}`,
        sessionId: session.id,
        event: seed.event,
        timeMs,
        plus2,
        dnf: false,
        scramble: sample333,
        startedAt: Date.UTC(2026, 10, 3, 18, 20 + index * 3),
        ...(seed.state === "repeat-long" && index === 7 ? { dnf: true } : {}),
        inspectionMs: null,
        comment: null,
        input: "keyboard",
        repeatOf: "eyes-solve-56",
      });
  }
  if (seed.state === "progress-cross")
    for (const solve of colourHistory(session.id))
      await store.solves.add(solve);
  const history = progressHistories[seed.state as ProgressHistory];
  if (history) {
    for (const solve of historySolves(history, session.id))
      await store.solves.add(solve);
    if (history.target !== null)
      await store.settings.set(targetKey("333"), String(history.target));
  }
  if (seed.state === "progress-scopes") {
    const b = await store.sessions.create({ event: "333", name: "B" });
    const c = await store.sessions.create({ event: "333fm", name: "C" });
    await store.folders.create("F", [session.id, b.id, c.id]);
    const first = Date.UTC(2026, 10, 1, 11);
    for (let index = 0; index < 105; index++) {
      const destination = index % 2 ? b : session;
      await store.solves.add({
        id: `progress-${String(index).padStart(3, "0")}`,
        sessionId: destination.id,
        event: destination.event,
        timeMs: index >= 100 ? (index - 90) * 1000 : 15000 + (index % 12) * 100,
        startedAt: first + Math.floor(index / 2) * 60_000,
        plus2: 0,
        dnf: false,
        scramble: "R U",
        inspectionMs: null,
        comment: null,
        input: "keyboard",
      });
    }
    for (const moves of [21, 22, 23]) {
      await store.solves.add({
        id: `progress-fmc-${moves}`,
        sessionId: c.id,
        event: c.event,
        moves,
        timeMs: 0,
        startedAt: first + moves,
        plus2: 0,
        dnf: false,
        scramble: "R U",
        inspectionMs: null,
        comment: null,
        input: "keyboard",
      });
    }
    await store.sessions.setArchived(b.id, true);
  }
  if (seed.state.startsWith("switch")) {
    const made: string[] = [];
    // Few: the usual practice of two or three puzzles. Many: a long-kept history.
    const extra: (typeof switchSessions)[number][] =
      seed.state === "switch-many"
        ? (
            [
              "222",
              "444",
              "555",
              "666",
              "777",
              "333bf",
              "333fm",
              "333oh",
              "clock",
              "minx",
              "pyram",
              "skewb",
              "sq1",
              "444bf",
              "555bf",
              "333mbf",
              "fto",
            ] as const
          ).flatMap((event, index) => [
            {
              name: `Practice ${index + 1}`,
              event,
              timeMs: 10_000 + index * 997,
            },
            { name: `Comp ${index + 1}`, event, timeMs: 12_000 + index * 991 },
          ])
        : [];
    const list: readonly (typeof switchSessions)[number][] =
      seed.state === "switch-few"
        ? switchSessions.slice(0, 2)
        : [...switchSessions, ...extra];
    for (const [index, item] of list.entries()) {
      const other = await store.sessions.create({
        event: item.event,
        name: item.name,
      });
      made.push(other.id);
      if (index === 0) await store.settings.set(previousSessionKey, other.id);
      await store.solves.add({
        id: `eyes-switch-${index}`,
        sessionId: other.id,
        event: item.event,
        timeMs: item.timeMs,
        plus2: item.plus2 ?? 0,
        dnf: item.dnf ?? false,
        inspectionMs: null,
        scramble: sample333,
        startedAt: Date.UTC(2026, 9, 20) + index * 3_600_000,
        comment: null,
        input: "keyboard",
      });
    }
    // One folder, open: the side events together.
    const [, oh, , blind] = made;
    if (oh && blind && seed.state !== "switch-few")
      await store.folders.create("Side events", [oh, blind]);
    // Put away: two old sessions in the archive, one in the trash with its solves, and a
    // solve deleted on its own.
    for (const [name, event] of [
      ["Clock", "clock"],
      ["Pyraminx 2025", "pyram"],
    ] as const) {
      const old = await store.sessions.create({ event, name });
      await store.sessions.setArchived(old.id, true);
    }
    const gone = await store.sessions.create({ event: "555", name: "5×5" });
    for (const index of [0, 1, 2])
      await store.solves.add({
        id: `eyes-trash-${index}`,
        sessionId: gone.id,
        event: "555",
        timeMs: 98_000 + index * 1_210,
        plus2: 0,
        dnf: false,
        inspectionMs: null,
        scramble: sample333,
        startedAt: Date.UTC(2026, 9, 18) + index * 60_000,
        comment: null,
        input: "keyboard",
      });
    await store.sessions.remove(gone.id);
    const solves = await store.solves.page(session.id, { limit: 1 });
    if (solves[0]) await store.solves.remove(solves[0].id);
  }
  if (seed.state === "move")
    for (const [index, item] of moveSessions.entries()) {
      const other = await store.sessions.create({
        event: item.event,
        name: item.name,
      });
      await store.solves.add({
        id: `eyes-move-${index}`,
        sessionId: other.id,
        event: item.event,
        timeMs: item.timeMs,
        plus2: 0,
        dnf: false,
        inspectionMs: null,
        scramble: sample333,
        startedAt: Date.UTC(2026, 9, 20) + index * 3_600_000,
        comment: null,
        input: "keyboard",
      });
    }
  if (seed.state === "db-memory") return db;
  // The desktop file with history of its own, the earlier version's kept apart.
  if (seed.state === "db-earlier" || seed.state === "settings-earlier")
    return {
      ...db,
      kind: "persistent",
      handoff: "needs-recovery",
      mergeEarlier: async () => true,
    };
  if (
    seed.state === "settings-backups" ||
    seed.state === "settings-backup-failed"
  )
    return { ...db, kind: "persistent", backups: seededBackups(seed.state) };
  return { ...db, kind: "persistent" };
}

/**
 * The trainer as its shots show it: five PLL cases being learnt, due now, with a few
 * attempts each (Y slow and Jb missed twice, so Review has both kinds of weak case), and
 * three F2L cases.
 */
async function seedTrainer(store: Store): Promise<void> {
  const { newCard, trainerSet } = await import("@cubehaus/algs");
  const now = Date.now();
  const pll = trainerSet("pll");
  const id = (label: string) => pll.find((c) => c.label === label)?.id ?? label;
  const typical: Record<string, number> = {
    T: 1_400,
    Y: 4_200,
    Ua: 1_600,
    Jb: 1_500,
    Aa: 1_800,
  };
  let n = 0;
  for (const [label, ms] of Object.entries(typical)) {
    const caseId = id(label);
    const { card } = await newCard(caseId, now);
    await store.trainer.putCase({ setId: "pll", caseId, card, dueAt: now });
    for (let i = 0; i < 4; i++) {
      const missed = label === "Jb" && i >= 2;
      await store.trainer.addAttempt({
        id: `train-${label}-${i}`,
        setId: "pll",
        caseId,
        mode: "picture",
        auf: 0,
        scramble: null,
        recogMs: 600 + i * 40,
        execMs: ms + i * 70,
        missed,
        grade: missed ? "again" : "good",
        at: now - 86_400_000 + n++ * 60_000,
      });
    }
  }
  // Three F2L cases in each slot, for the slots' own shots.
  for (const setId of [
    "f2l",
    "f2l-left",
    "f2l-back",
    "f2l-back-left",
  ] as const) {
    const f2l = trainerSet(setId);
    for (const label of ["F2L 7", "F2L 13", "F2L 26"]) {
      const caseId = f2l.find((c) => c.label === label)?.id ?? label;
      const { card } = await newCard(caseId, now);
      await store.trainer.putCase({ setId, caseId, card, dueAt: now });
    }
  }
  // Two cases of each 2×2 set and each last-slot set, so its drill has cases of its own.
  for (const setId of [
    "two-oll",
    "two-pbl",
    "two-cll",
    "two-adj",
    "two-diag",
    "ls-right",
    "ls-front",
  ] as const)
    for (const c of trainerSet(setId).slice(0, 2)) {
      const { card } = await newCard(c.id, now);
      await store.trainer.putCase({ setId, caseId: c.id, card, dueAt: now });
    }
}

/** The desktop's copies as the Settings shots show them: a week, one a day. */
function seededBackups(state: string): NativeBackups {
  const copies: BackupMeta[] = Array.from({ length: 7 }, (_, index) => ({
    id: `2026112${2 - Math.min(index, 2)}T204000Z-0a1b${index}c`,
    createdAt: Date.UTC(2026, 10, 22 - index, 20, 40),
    bytes: 1_843_200,
    status: "complete",
  }));
  return {
    lastError:
      state === "settings-backup-failed" ? "No space left on device" : null,
    folder: async () =>
      "/Users/you/Library/Application Support/app.cubehaus.desktop/Backups",
    list: async () => copies,
    now: async () => copies[0] as BackupMeta,
    restore: async () => {},
    choose: async () => null,
    lastChange: async () => null,
  };
}
