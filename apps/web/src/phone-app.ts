/**
 * The iPhone app (apps/mobile, Capacitor): the same page in a WKWebView, with a small
 * native plugin (`Cubehaus`, apps/mobile/ios/App/App/CubehausPlugin.swift) for what the
 * webview lacks: haptics (no `navigator.vibrate` on iOS), keeping the screen on, the
 * status bar following the theme, and handing a file to the share sheet (a WKWebView
 * drops `<a download>`). History stays where the web keeps it: SQLite in the webview's
 * OPFS, which iOS leaves out of the phone's backups; so a copy of
 * it is kept as a file in the app's Documents folder, which is backed up.
 */
import type { WakeLockHost } from "./wake-lock";

type Bridge = { isNativePlatform?(): boolean };

/** True inside the phone app: Capacitor's bridge is in the page before any script runs. */
export function inPhoneApp(): boolean {
  const bridge = (globalThis as { Capacitor?: Bridge }).Capacitor;
  return bridge?.isNativePlatform?.() === true;
}

interface CubehausPlugin {
  haptic(options: { pattern: number[] }): Promise<void>;
  keepAwake(options: { on: boolean }): Promise<void>;
  appearance(options: { ground: string }): Promise<void>;
  share(options: { name: string; text: string }): Promise<void>;
  keepCopy(options: { text: string }): Promise<void>;
  copySettled(options: Record<string, never>): Promise<void>;
  copyInfo(options: Record<string, never>): Promise<{ solves: number }>;
}

// The plugin is a proxy that answers every property, `then` too: a promise resolved with
// it would call it as a thenable. So it only ever travels in a box.
let plugin: Promise<{ cubehaus: CubehausPlugin }> | undefined;
async function callNative<K extends keyof CubehausPlugin>(
  method: K,
  options: Parameters<CubehausPlugin[K]>[0],
): Promise<Awaited<ReturnType<CubehausPlugin[K]>>> {
  plugin ??= import("@capacitor/core").then(({ registerPlugin }) => ({
    cubehaus: registerPlugin<CubehausPlugin>("Cubehaus"),
  }));
  const { cubehaus } = await plugin;
  return (cubehaus[method] as (options: unknown) => Promise<never>)(options);
}

/** A vibration pattern (on, off, on… in ms): the phone app plays it as taps. */
export function vibrate(pattern: number[]): void {
  if (inPhoneApp()) {
    void callNative("haptic", { pattern }).catch(() => {});
    return;
  }
  globalThis.navigator?.vibrate?.(pattern);
}

/** Where a screen wake lock comes from: the native idle timer in the app. */
export function wakeLockHost(): WakeLockHost {
  if (!inPhoneApp()) return globalThis.navigator as WakeLockHost;
  return {
    wakeLock: {
      async request() {
        await callNative("keepAwake", { on: true });
        return { release: () => callNative("keepAwake", { on: false }) };
      },
    },
  };
}

/** Whether the screen can be kept on here (the setting is shown only then). */
export function canKeepAwake(): boolean {
  return inPhoneApp() || "wakeLock" in globalThis.navigator;
}

/**
 * Keeps the status bar and the ground behind the page in step with `theme-color`,
 * which the theme sets (index.html's first-paint script, then theme.ts).
 */
export function followThemeColor(doc: Document): void {
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) return;
  let last = "";
  const send = () => {
    const ground = meta.content;
    if (ground === last || !/^#[0-9a-f]{6}$/i.test(ground)) return;
    last = ground;
    void callNative("appearance", { ground }).catch(() => {});
  };
  new MutationObserver(send).observe(meta, {
    attributes: true,
    attributeFilter: ["content"],
  });
  send();
}

/** Hands a file to the share sheet (Save to Files, AirDrop, a cloud drive). */
export async function shareFile(name: string, contents: string | Blob) {
  const text = typeof contents === "string" ? contents : await contents.text();
  await callNative("share", { name, text });
}

/** Writes the phone app's copy of the history (Documents/cubehaus-backup.json). */
export async function writeBackupCopy(text: string): Promise<void> {
  await callNative("keepCopy", { text });
}

/** Tells the app the copy is settled on leaving: iOS may suspend it now. */
export async function copySettled(): Promise<void> {
  await callNative("copySettled", {});
}

/** How many solves the phone's copy holds (0: none, or no copy). */
export async function copySolves(): Promise<number> {
  return (await callNative("copyInfo", {})).solves;
}

type CopyHost = {
  visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
};

/**
 * Keeps the copy of the history current: `delayMs` after the history opens, and each time
 * the app goes to the background, written only when the history changed since the last
 * copy (the export time aside) and only when it holds solves. A failed copy is tried
 * again at the next chance. On leaving, `settled` follows the copy (written or not), so
 * the app can let iOS suspend it. Returns a function that stops.
 */
export function keepBackupCopy(
  exportBackup: () => Promise<string>,
  write: (text: string) => Promise<void>,
  doc: CopyHost,
  delayMs = 10_000,
  settled: () => Promise<void> = async () => {},
): () => void {
  let last: string | undefined;
  // Copies run one after another; one asked for while another runs waits for it, so a
  // copy on leaving always exports what is there at that moment.
  let queue: Promise<void> = Promise.resolve();
  const copyNow = async () => {
    try {
      const text = await exportBackup();
      const content = text.replace(/"exportedAt":\s*\d+/, "");
      // A history with no solves never replaces the copy: after the phone is restored
      // from a backup the webview starts empty, and the copy is what brings it back.
      if (content === last || /"solve":\s*\[\]/.test(content)) return;
      await write(text);
      last = content;
    } catch {
      /* Tried again at the next chance. */
    }
  };
  const copy = () => {
    queue = queue.then(copyNow);
    return queue;
  };
  const onVisibility = () => {
    if (doc.visibilityState === "hidden")
      void copy().then(() => settled().catch(() => {}));
  };
  doc.addEventListener("visibilitychange", onVisibility);
  const first = setTimeout(() => void copy(), delayMs);
  return () => {
    clearTimeout(first);
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}

const OFFERED = "cubehaus.copy-offered";

/** Whether the copy was offered on this install: it is said once. */
export function copyOffered(): boolean {
  try {
    return globalThis.localStorage?.getItem(OFFERED) === "1";
  } catch {
    return false;
  }
}

export function markCopyOffered(): void {
  try {
    globalThis.localStorage?.setItem(OFFERED, "1");
  } catch {
    /* Said again next time: harmless. */
  }
}
