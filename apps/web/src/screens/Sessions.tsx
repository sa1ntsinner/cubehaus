import { memo, useRef } from "react";
import type { AppState, AppView } from "../app-state";
import type { GestureId } from "../gesture-hints";
import { DEFAULT_SWIPE, useSwipe } from "../input/use-swipe";
import { listed } from "../session-order";
import type { Text } from "../text";

/**
 * The open session's name on the status line. A tap or click (or S) opens the switch;
 * on a touch screen a sideways swipe on the name goes to the neighbouring session, the
 * left swipe to the next one, as a page turns. The name follows the finger, and the
 * neighbour's name stands in the room it leaves.
 */
export const Sessions = memo(function Sessions({
  app,
  view,
  words: text,
  onOpen,
  ready,
  onLearned,
}: {
  app: AppState;
  view: AppView;
  words: Text;
  onOpen(opener: HTMLElement): void;
  /** Whether a gesture may act now (between solves, nothing open). */
  ready?(): boolean;
  onLearned?(id: GestureId): void;
}) {
  const enabled =
    view.dbState?.kind === "persistent" || view.dbState?.kind === "memory";
  const current = view.current;
  const name = useRef<HTMLButtonElement>(null);
  const neighbourOf = (step: number) => {
    const shown = listed(view.sessions, current?.id);
    const index = shown.findIndex(({ id }) => id === current?.id);
    return index < 0 ? undefined : shown[index + step];
  };
  useSwipe(name, {
    config: {
      ...DEFAULT_SWIPE,
      directions: [
        ...(neighbourOf(1) ? (["left"] as const) : []),
        ...(neighbourOf(-1) ? (["right"] as const) : []),
      ],
    },
    enabled: () => enabled && (ready?.() ?? true),
    word: (direction) => neighbourOf(direction === "left" ? 1 : -1)?.name ?? "",
    onCommit: (direction) => {
      const next = neighbourOf(direction === "left" ? 1 : -1);
      if (!next) return;
      void app.selectSession(next.id);
      onLearned?.("session");
    },
  });
  return (
    <nav data-part="sessions" data-no-timer aria-label={text.sessions}>
      <button
        ref={name}
        type="button"
        data-action="session-switch"
        data-id={current?.id}
        data-event={current?.event}
        data-long={(current && [...current.name].length > 8) || undefined}
        aria-haspopup="dialog"
        aria-label={
          current ? `${text.sessions}: ${current.name}` : text.sessions
        }
        disabled={!enabled || !current}
        onClick={(click) => onOpen(click.currentTarget)}
      >
        {current?.name}
      </button>
    </nav>
  );
});
