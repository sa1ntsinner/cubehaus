import type { RestoreResult } from "@cubehaus/storage";

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

/** Hands a file to the browser's download. */
export function download(
  name: string,
  contents: string | Blob,
  type = "application/json",
) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    typeof contents === "string" ? new Blob([contents], { type }) : contents,
  );
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}
