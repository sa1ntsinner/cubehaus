import type { EventId } from "@cubehaus/core";
import { DEFAULT_HOLDING, isHolding } from "@cubehaus/cube/holding";
import type { TrainingProfile } from "./scramble/training-client";
import { type SlotPreferences, statId } from "./session-stats";
import { isThemeChoice, type ThemeChoice } from "./theme";
import {
  cleanSizes,
  DEFAULT_SIZES,
  isViewSizes,
  type ViewSizes,
  viewSizesKey,
} from "./view-size";

export type Layout = "lift" | "times" | "focus";

export function isLayout(value: unknown): value is Layout {
  return value === "lift" || value === "times" || value === "focus";
}

// What the person can change, with the official choice as the default. A
// value is stored as JSON under `settings.global`, per event under
// `settings.event.<event>` and per session under `settings.session.<id>`; the
// session's value wins, then its event's. A choice made for a session is also
// its event's default, so a new Blindfolded session starts as the last one was
// set. Anything unknown or malformed falls back to the default and never throws.

export interface Settings {
  language: "en" | "ru";
  theme: ThemeChoice;
  // "official" follows the event: 15 s, none for blindfolded and Fewest Moves.
  inspection: "official" | "off";
  calls: "off" | "tick" | "voice";
  startMode: "space" | "two-hand";
  holdMs: number; // 0 to 1000
  precision: 2 | 3;
  running: "hundredths" | "tenths" | "seconds" | "hidden";
  entry: "timer" | "typing";
  picture: boolean;
  statSlots: SlotPreferences;
  layout: Layout;
  recordCue: boolean;
  /** A quiet slot after the stats: how many solves of the session today. */
  today: boolean;
  /** A drill instead of official scrambles; 3×3 sessions only. */
  training: TrainingProfile;
  /** The size of each part of the timer screen; per device, in its own row. */
  sizes: ViewSizes;
  /** The colours held on top and in front while solving (`@cubehaus/cube/holding`). */
  holding: string;
  /** The screen stays on while the app shows (Screen Wake Lock, where there is one). */
  awake: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  language: "en",
  theme: "system",
  inspection: "official",
  calls: "tick",
  startMode: "space",
  holdMs: 300,
  precision: 2,
  running: "seconds",
  entry: "timer",
  picture: true,
  statSlots: {},
  layout: "lift",
  recordCue: true,
  today: false,
  training: { request: null },
  sizes: DEFAULT_SIZES,
  holding: DEFAULT_HOLDING,
  awake: true,
};

export function languageFrom(tag: string | undefined): Settings["language"] {
  return tag?.toLowerCase().split("-")[0] === "ru" ? "ru" : "en";
}

export function defaultSettings(
  tag: string | undefined = globalThis.navigator?.language,
): Settings {
  return { ...DEFAULT_SETTINGS, language: languageFrom(tag) };
}

const choices: {
  [K in keyof Settings]: (value: unknown) => value is Settings[K];
} = {
  language: (v): v is Settings["language"] => v === "en" || v === "ru",
  theme: isThemeChoice,
  inspection: (v): v is Settings["inspection"] =>
    v === "official" || v === "off",
  calls: (v): v is Settings["calls"] =>
    v === "off" || v === "tick" || v === "voice",
  startMode: (v): v is Settings["startMode"] =>
    v === "space" || v === "two-hand",
  holdMs: (v): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1000,
  precision: (v): v is Settings["precision"] => v === 2 || v === 3,
  running: (v): v is Settings["running"] =>
    v === "hundredths" || v === "tenths" || v === "seconds" || v === "hidden",
  picture: (v): v is boolean => typeof v === "boolean",
  layout: isLayout,
  recordCue: (v): v is boolean => typeof v === "boolean",
  today: (v): v is boolean => typeof v === "boolean",
  statSlots: (value): value is SlotPreferences =>
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([key, ids]) =>
        /^(lift|times|focus)\.(time|moves|multi)\.(ao5|mo3|bo5|bo3|bo2|bo1)$/.test(
          key,
        ) &&
        Array.isArray(ids) &&
        ids.length <= 4 &&
        new Set(ids).size === ids.length &&
        ids.every(statId),
    ),
  entry: (v): v is Settings["entry"] => v === "timer" || v === "typing",
  training: isTrainingProfile,
  sizes: isViewSizes,
  holding: isHolding,
  awake: (v): v is boolean => typeof v === "boolean",
};

const FACE_NAMES = ["U", "L", "F", "R", "B", "D"];
const isLength = (v: unknown, most: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= most;

/** A drill as stored: anything not quite right falls back to official scrambles. */
export function isTrainingProfile(value: unknown): value is TrainingProfile {
  if (!value || typeof value !== "object" || !("request" in value))
    return false;
  const request = (value as { request: unknown }).request;
  if (request === null) return true;
  if (!request || typeof request !== "object") return false;
  const r = request as Record<string, unknown>;
  switch (r.kind) {
    case "easy-cross":
      return FACE_NAMES.includes(r.face as string) && isLength(r.length, 8);
    case "easy-xcross":
      return FACE_NAMES.includes(r.face as string) && isLength(r.length, 6);
    case "cross-solved":
      return FACE_NAMES.includes(r.face as string);
    case "edges-only":
    case "corners-only":
    case "two-gen":
      return true;
    case "oll":
    case "pll":
    case "ll":
      return (
        Array.isArray(r.caseIds) &&
        r.caseIds.length <= 4000 &&
        r.caseIds.every(
          (id) => typeof id === "string" && id.startsWith(`${r.kind}-`),
        )
      );
    default:
      return false;
  }
}

// Keep only the fields that hold a valid value.
export function cleanSettings(value: unknown): Partial<Settings> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  const out: Partial<Record<keyof Settings, unknown>> = {};
  for (const key of Object.keys(choices) as (keyof Settings)[]) {
    const field = (value as Record<string, unknown>)[key];
    if (choices[key](field)) out[key] = field;
  }
  return out as Partial<Settings>;
}

export function parseStoredSettings(text: string | null): Partial<Settings> {
  if (text === null) return {};
  try {
    return cleanSettings(JSON.parse(text));
  } catch {
    return {};
  }
}

function parseSizes(text: string | null): ViewSizes {
  try {
    return cleanSizes(text === null ? null : JSON.parse(text));
  } catch {
    return DEFAULT_SIZES;
  }
}

export function resolveSettings(
  global: Partial<Settings>,
  session: Partial<Settings>,
  tag?: string,
): Settings {
  const device = { ...defaultSettings(tag), ...cleanSettings(global) };
  return {
    ...device,
    ...cleanSettings(session),
    picture: device.picture,
    statSlots: device.statSlots,
    layout: device.layout,
    recordCue: device.recordCue,
    today: device.today,
    theme: device.theme,
    sizes: device.sizes,
  };
}

export const globalSettingsKey = "settings.global";
export const sessionSettingsKey = (sessionId: string) =>
  `settings.session.${sessionId}`;
export const eventSettingsKey = (event: EventId) => `settings.event.${event}`;

interface SettingsStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export async function loadSettings(
  store: SettingsStore,
  sessionId: string,
  tag?: string,
  event?: EventId,
): Promise<Settings> {
  const [global, forEvent, session, sizes] = await Promise.all([
    store.get(globalSettingsKey),
    event === undefined ? null : store.get(eventSettingsKey(event)),
    store.get(sessionSettingsKey(sessionId)),
    store.get(viewSizesKey),
  ]);
  return resolveSettings(
    { ...parseStoredSettings(global), sizes: parseSizes(sizes) },
    {
      ...parseStoredSettings(forEvent),
      ...parseStoredSettings(session),
    },
    tag,
  );
}

// Change one field globally, or for one session (and its event's default).
export async function changeSetting<K extends keyof Settings>(
  store: SettingsStore,
  key: K,
  value: Settings[K],
  sessionId?: string,
  event?: EventId,
): Promise<void> {
  if (!choices[key](value)) throw new RangeError(`Not a valid ${key}`);
  if (key === "sizes") {
    await store.set(viewSizesKey, JSON.stringify(value));
    return;
  }
  const device =
    sessionId === undefined ||
    key === "picture" ||
    key === "theme" ||
    key === "statSlots" ||
    key === "layout" ||
    key === "recordCue" ||
    key === "today";
  const keys = device
    ? [globalSettingsKey]
    : [
        sessionSettingsKey(sessionId),
        ...(event === undefined ? [] : [eventSettingsKey(event)]),
      ];
  for (const storeKey of keys) {
    const current = parseStoredSettings(await store.get(storeKey));
    await store.set(storeKey, JSON.stringify({ ...current, [key]: value }));
  }
}
