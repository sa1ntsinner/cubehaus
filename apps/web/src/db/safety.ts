/**
 * Keeping a browser's history from vanishing unseen (DESIGN.md section 17).
 *
 * What the browsers do: Safari (iOS and macOS) deletes all of a site's script-written
 * storage, this database and localStorage alike, after 7 days of use without a visit,
 * unless the site is on the Home Screen (or the Dock); Chrome and Firefox may evict a
 * "best-effort" origin under storage pressure, which `navigator.storage.persist()`
 * prevents once granted; a private window keeps nothing. The phone and desktop apps keep
 * their own copies (Documents, the backup folder) and need none of this.
 *
 * So, on the web only: persistence is asked for once there are solves to keep (Firefox
 * asks the person, and a first visit is the wrong moment); while the history is at risk
 * and large, one quiet line now and then offers a copy; on an iPhone or iPad outside the
 * Home Screen, one hint, once, says how to keep it. A wipe is said when it can be known:
 * Chrome's eviction empties the database but not localStorage, so a count left there
 * against an empty database means the solves went. Safari's deletion takes both at once:
 * that one looks like a first visit and cannot be told apart from it.
 */

export const DAY_MS = 86_400_000;
/** Solves before the copy is offered: enough history that losing it would hurt. */
export const COPY_SOLVES = 100;
/** Solves before the Home Screen hint: the person has started using the timer. */
export const HOME_SOLVES = 25;
/** Days between offers of a copy, and how long a saved copy counts as recent. */
export const COPY_DAYS = 14;

export type SafetyLine = "copy" | "home" | null;

export interface SafetyFacts {
  /** The browser granted persistent storage (`navigator.storage.persisted()`). */
  persisted: boolean;
  /** iPhone or iPad: every browser there is WebKit with Safari's 7-day rule. */
  ios: boolean;
  /** Safari on a Mac, which deletes the same way. */
  safari: boolean;
  /** Opened from the Home Screen or the Dock, where the 7-day rule does not apply. */
  standalone: boolean;
  /** Live solves in the history. */
  solves: number;
  now: number;
  /** When a backup file was last saved here, if ever. */
  savedAt: number | null;
  /** When the copy was last offered, if ever. */
  offeredAt: number | null;
  /** The Home Screen hint was given on this device. */
  homeSaid: boolean;
}

/** At most one line, and only when it is worth the person's attention. */
export function safetyLine(facts: SafetyFacts): SafetyLine {
  const { ios, safari, standalone, solves, now } = facts;
  if (ios && !standalone && !facts.homeSaid && solves >= HOME_SOLVES)
    return "home";
  // Safari's 7-day rule holds even where persistence was granted.
  const atRisk = !facts.persisted || ((ios || safari) && !standalone);
  const since = (at: number | null) =>
    at === null || now - at >= COPY_DAYS * DAY_MS;
  if (
    atRisk &&
    solves >= COPY_SOLVES &&
    since(facts.savedAt) &&
    since(facts.offeredAt)
  )
    return "copy";
  return null;
}

/** The database came back empty where this device last counted solves. */
export function wasWiped(lastCount: number | null, solves: number): boolean {
  return lastCount !== null && lastCount > 0 && solves === 0;
}

/** Which browser this is, as far as the rules above care. */
export function readPlatform(nav: Navigator = navigator): {
  ios: boolean;
  safari: boolean;
  standalone: boolean;
} {
  const agent = nav.userAgent;
  const ios =
    /iPad|iPhone|iPod/.test(agent) ||
    (/Macintosh/.test(agent) && nav.maxTouchPoints > 1);
  const safari =
    /AppleWebKit/.test(agent) &&
    /Safari/.test(agent) &&
    !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\/|Android/.test(agent);
  let standalone = (nav as { standalone?: boolean }).standalone === true;
  try {
    standalone ||= matchMedia("(display-mode: standalone)").matches;
  } catch {
    /* No media queries: not installed. */
  }
  return { ios, safari, standalone };
}

const KEYS = {
  count: "cubehaus.safety.count",
  saved: "cubehaus.safety.saved",
  offered: "cubehaus.safety.offered",
  home: "cubehaus.safety.home",
} as const;

type Marks = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function marks(): Marks | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readNumber(key: string): number | null {
  try {
    const value = Number(marks()?.getItem(key) ?? Number.NaN);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) marks()?.removeItem(key);
    else marks()?.setItem(key, value);
  } catch {
    /* Said again, or not said: harmless. */
  }
}

export const safetyMarks = {
  count: () => readNumber(KEYS.count),
  setCount: (n: number) => write(KEYS.count, n > 0 ? String(n) : null),
  savedAt: () => readNumber(KEYS.saved),
  /** A backup file was saved: the copy is not offered for a while. */
  noteSaved: (at = Date.now()) => write(KEYS.saved, String(at)),
  offeredAt: () => readNumber(KEYS.offered),
  noteOffered: (at = Date.now()) => write(KEYS.offered, String(at)),
  homeSaid: () => readNumber(KEYS.home) !== null,
  noteHome: () => write(KEYS.home, "1"),
};

/** Asks once per page for persistent storage; true when the browser keeps it. */
let asked: Promise<boolean> | undefined;
export function askPersistence(): Promise<boolean> {
  asked ??= (async () => {
    try {
      const storage = navigator.storage;
      if (!storage?.persisted) return false;
      if (await storage.persisted()) return true;
      return (await storage.persist?.()) === true;
    } catch {
      return false;
    }
  })();
  return asked;
}
