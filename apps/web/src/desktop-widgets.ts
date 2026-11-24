/**
 * The Mac desktop app's widgets (apps/desktop/widgets): the same snapshot the phone's
 * widgets show (widget-snapshot.ts), handed to the app, which writes it where the widget
 * extension reads it and redraws them (apps/desktop/src-tauri/src/widgets.rs). Windows
 * and Linux have no widgets.
 */
import { inDesktopApp } from "./db/native";

/** True in the desktop app on a Mac. */
export function inMacDesktopApp(): boolean {
  return inDesktopApp() && /\bMac OS X\b/.test(globalThis.navigator.userAgent);
}

export async function writeDesktopWidgetSnapshot(json: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("widget_snapshot", { json });
}
