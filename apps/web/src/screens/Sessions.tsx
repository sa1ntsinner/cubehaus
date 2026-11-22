import { memo, useRef } from "react";
import type { AppState, AppView } from "../app-state";
import { listed } from "../session-order";
import type { Text } from "../text";

/**
 * The open session's name on the status line. A tap or click (or S) opens the switch;
 * on a touch screen a sideways swipe on the name goes to the neighbouring session, the
 * left swipe to the next one, as a page turns.
 */
export const Sessions = memo(function Sessions({
  app,
  view,
  words: text,
  onOpen,
}: {
  app: AppState;
  view: AppView;
  words: Text;
  onOpen(opener: HTMLElement): void;
}) {
  const enabled =
    view.dbState?.kind === "persistent" || view.dbState?.kind === "memory";
  const current = view.current;
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);
  const neighbour = (step: number) => {
    const shown = listed(view.sessions, current?.id);
    const index = shown.findIndex(({ id }) => id === current?.id);
    const next = shown[index + step];
    if (next) void app.selectSession(next.id);
  };
  return (
    <nav data-part="sessions" data-no-timer aria-label={text.sessions}>
      <button
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
        onPointerDown={(down) => {
          swiped.current = false;
          if (down.pointerType === "mouse") return;
          swipe.current = {
            x: down.clientX,
            y: down.clientY,
            id: down.pointerId,
          };
        }}
        onPointerUp={(up) => {
          const start = swipe.current;
          swipe.current = null;
          if (!start || start.id !== up.pointerId) return;
          const dx = up.clientX - start.x;
          const dy = up.clientY - start.y;
          if (Math.abs(dx) < 40 || Math.abs(dx) < 2 * Math.abs(dy)) return;
          swiped.current = true;
          neighbour(dx < 0 ? 1 : -1);
        }}
        onPointerCancel={() => {
          swipe.current = null;
        }}
        onClick={(click) => {
          if (swiped.current) {
            swiped.current = false;
            return;
          }
          onOpen(click.currentTarget);
        }}
      >
        {current?.name}
      </button>
    </nav>
  );
});
