import type { EventId } from "@cubehaus/core";

/**
 * What Progress was last looking at on this device (its scope and puzzle), kept so the
 * view opens there again. A remembered session or folder that is gone is forgotten, and
 * the view opens on the session in use, as it did before.
 */
export type ProgressMemory = {
  mode: "session" | "folder" | "selection";
  selection: string;
  folderId: string;
  event: EventId | undefined;
  included: readonly string[] | undefined;
};

export const progressMemoryKey = "cubehaus.progress.scope";

export const rememberProgress = (memory: ProgressMemory) =>
  JSON.stringify(memory);

export function recallProgress(
  text: string | null,
  sessions: readonly { id: string }[],
  folders: readonly { id: string }[],
): ProgressMemory | null {
  if (!text) return null;
  let value: Partial<ProgressMemory>;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const { mode, selection, folderId, event, included } = value;
  if (mode !== "session" && mode !== "folder" && mode !== "selection")
    return null;
  if (typeof selection !== "string" || typeof folderId !== "string")
    return null;
  const has = (id: string) => sessions.some((s) => s.id === id);
  if (mode === "session" && !has(selection)) return null;
  if (mode === "folder" && !folders.some((f) => f.id === folderId)) return null;
  const kept = Array.isArray(included)
    ? included.filter((id): id is string => typeof id === "string" && has(id))
    : undefined;
  if (mode === "selection" && kept !== undefined && kept.length === 0)
    return null;
  return {
    mode,
    selection,
    folderId,
    event: typeof event === "string" ? (event as EventId) : undefined,
    included: kept,
  };
}
