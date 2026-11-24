import type { RestoreResult } from "@cubehaus/storage";
import { inDesktopApp } from "./db/native";
import { inPhoneApp, shareFile } from "./phone-app";

/** What restoring a backup file came to: counts, or why nothing was written. */
export type RestoreFileResult =
  | RestoreResult
  | { problem: "format" | "newer" | "reference" };

/** A file for another timer: its text, and how many solves lost which fields. */
export interface ExportFileResult {
  text: string;
  solves: number;
  fields: string[];
}

/** The file name a backup is saved under: the app, the word, the local date. */
export function backupFileName(
  now = new Date(),
  kind = "backup",
  extension = "json",
): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `cubehaus-${kind}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.${extension}`;
}

/**
 * True where the desktop window handles downloads (apps/desktop/src-tauri/src/download.rs).
 */
export function savesToDownloads(): boolean {
  return inDesktopApp() && /^(Mac|Win|Linux)/.test(navigator.platform);
}

async function downloadToDownloads(link: HTMLAnchorElement): Promise<void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    let complete!: (success: boolean) => void;
    const finished = new Promise<boolean>((resolve) => {
      complete = resolve;
    });
    // Listen before starting, and match this blob even if another file finishes first.
    const unlisten = await listen<{ url: string; success: boolean }>(
      "download-finished",
      ({ payload }) => {
        if (payload.url === link.href) complete(payload.success);
      },
      { target: "main" },
    );
    const timeout = setTimeout(() => complete(false), 30_000);
    try {
      link.click();
      if (!(await finished)) throw new Error("The download failed");
    } finally {
      clearTimeout(timeout);
      unlisten();
    }
  } finally {
    URL.revokeObjectURL(link.href);
  }
}

/** Hands off a file, or waits for the native download to finish in the desktop app. */
export function download(
  name: string,
  contents: string | Blob,
  type = "application/json",
): Promise<void> | undefined {
  // A WKWebView drops <a download>: the phone app hands the file to the share sheet.
  if (inPhoneApp()) {
    void shareFile(name, contents).catch(() => {});
    return;
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    typeof contents === "string" ? new Blob([contents], { type }) : contents,
  );
  link.download = name;
  if (savesToDownloads()) return downloadToDownloads(link);
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}
