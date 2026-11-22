import type { Session, Solve } from "@cubehaus/core";
import type { Store } from "@cubehaus/storage";
import { sessionOrder, tree } from "../session-order";
import { text } from "../text";
import { DroppedWriteError } from "./client";
import type { PendingJournal } from "./pending";

export const currentSessionKey = "session.current";
export const previousSessionKey = "session.previous";

/** The session the app makes on its own; an import removes it while it is untouched. */
export function createDefaultSession(store: Store): Promise<Session> {
  return store.sessions.create(
    { name: text.defaultSession, event: "333" },
    { starter: true },
  );
}

export async function loadSessions(store: Store) {
  const [list, folders] = await Promise.all([
    store.sessions.list(),
    store.folders.list(),
  ]);
  // List order: the top level by key, each folder's sessions in place of the folder.
  const sessions = sessionOrder(tree(list, folders));
  const [id, previous] = await Promise.all([
    store.settings.get(currentSessionKey),
    store.settings.get(previousSessionKey),
  ]);
  // The session open last, else the first the list shows; with none to show, a new one.
  let current =
    sessions.find((session) => session.id === id) ??
    sessions.find(({ archived }) => !archived);
  if (!current) {
    current = await createDefaultSession(store);
    sessions.push(current);
  }
  return {
    sessions,
    folders,
    current,
    previous:
      previous !== current.id &&
      sessions.some((session) => session.id === previous)
        ? previous
        : null,
  };
}

export async function flushPending(
  journal: PendingJournal,
  resolve: (solve: Solve) => Promise<Solve>,
  save: (solve: Solve) => Promise<void>,
): Promise<Solve | null> {
  for (const pending of journal.all()) {
    const solve = await resolve(pending);
    journal.add(solve);
    try {
      await save(solve);
    } catch (error) {
      if (error instanceof DroppedWriteError) return solve;
      throw error;
    }
    journal.confirm(solve.id);
  }
  return null;
}
