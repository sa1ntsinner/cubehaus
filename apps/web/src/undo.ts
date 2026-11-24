export interface UndoEntry {
  label: string;
  deletedAt?: number;
  undo(): Promise<void>;
}

export function createUndoStack(limit = 50) {
  const entries: UndoEntry[] = [];
  let queue = Promise.resolve();
  return {
    push(entry: UndoEntry): void {
      if (limit <= 0) return;
      entries.push(entry);
      if (entries.length > limit) entries.shift();
    },
    get deletedAt() {
      return entries.at(-1)?.deletedAt;
    },
    undo(deletedAt?: number): Promise<string | null> {
      const next = queue.then(async () => {
        const entry = entries.at(-1);
        if (
          !entry ||
          (deletedAt !== undefined && entry.deletedAt !== deletedAt)
        )
          return null;
        await entry.undo();
        const index = entries.lastIndexOf(entry);
        if (index !== -1) entries.splice(index, 1);
        return entry.label;
      });
      queue = next.then(
        () => {},
        () => {},
      );
      return next;
    },
    get size() {
      return entries.length;
    },
  };
}
