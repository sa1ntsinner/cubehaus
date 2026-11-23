/**
 * A swipe, from the contacts of one element: pure, so its thresholds can be tested
 * without a screen. The element follows the finger from the moment the swipe claims the
 * touch; past the commit distance it rubber-bands; let go past it, or flicked, the swipe
 * commits; let go short of it, it springs back. A touch that stays put for the hold time
 * is a hold (the timer's, a menu's) and never becomes a swipe; a second finger ends it.
 */

export type Direction = "left" | "right" | "up" | "down";
type Axis = "x" | "y";

export interface SwipeConfig {
  /** The directions that act. An axis with none is left to the page (scrolling). */
  directions: readonly Direction[];
  /** Movement before the swipe claims the touch. */
  startPx: number;
  /** Let go past this distance, the swipe commits. */
  commitPx: number;
  /** A flick at least this fast commits short of the distance. */
  flingPxPerMs: number;
  /** A touch that has not moved past startPx by then is a hold, never a swipe. */
  holdMs: number;
}

export interface SwipePoint {
  id: number;
  x: number;
  y: number;
  /** The event's own timestamp. */
  at: number;
}

export type SwipeInput = SwipePoint & {
  type: "down" | "move" | "up" | "cancel";
};

export type SwipeState =
  | { phase: "idle" }
  | { phase: "pending"; ids: readonly number[]; start: SwipePoint }
  | {
      phase: "tracking";
      ids: readonly number[];
      start: SwipePoint;
      axis: Axis;
      samples: readonly SwipePoint[];
    }
  | { phase: "blocked"; ids: readonly number[] };

export interface SwipeOffset {
  x: number;
  y: number;
}

export type SwipeOutput =
  | { type: "none" }
  /** The swipe takes the touch: a timer hold under it ends, nothing scrolls. */
  | { type: "claim"; direction: Direction; offset: SwipeOffset }
  | {
      type: "move";
      /** The allowed direction the finger is in, or null where it is resisted. */
      direction: Direction | null;
      offset: SwipeOffset;
      /** Let go now, it would commit by distance. */
      armed: boolean;
    }
  | { type: "commit"; direction: Direction }
  /** Spring back: let go short, cancelled, or a second finger. */
  | { type: "release" };

const NONE: SwipeOutput = { type: "none" };
/** The finger's speed is read over its last 60 ms (four frames). */
const VELOCITY_MS = 60;
/** Past the commit distance the element moves this much per pixel of finger. */
const BAND = 0.35;
/** In a direction that does not act, it moves this much. */
const RESIST = 0.15;

export function startSwipe(): SwipeState {
  return { phase: "idle" };
}

/** The distance shown for a finger distance: one to one, then rubber-banded. */
export function rubberBand(distance: number, commitPx: number): number {
  return distance <= commitPx
    ? distance
    : commitPx + (distance - commitPx) * BAND;
}

const directionOf = (axis: Axis, raw: number): Direction =>
  axis === "x" ? (raw < 0 ? "left" : "right") : raw < 0 ? "up" : "down";

const along = (axis: Axis, point: SwipePoint, start: SwipePoint) =>
  axis === "x" ? point.x - start.x : point.y - start.y;

const offsetOf = (axis: Axis, value: number): SwipeOffset =>
  axis === "x" ? { x: value, y: 0 } : { x: 0, y: value };

function follow(
  axis: Axis,
  raw: number,
  config: SwipeConfig,
): { direction: Direction | null; offset: SwipeOffset; armed: boolean } {
  const direction = directionOf(axis, raw);
  const allowed = raw !== 0 && config.directions.includes(direction);
  const sign = Math.sign(raw);
  const distance = Math.abs(raw);
  const shown = allowed
    ? rubberBand(distance, config.commitPx)
    : distance * RESIST;
  return {
    direction: allowed ? direction : null,
    offset: offsetOf(axis, sign * shown),
    armed: allowed && distance >= config.commitPx,
  };
}

const without = (ids: readonly number[], id: number) =>
  ids.filter((each) => each !== id);

/** What is left once a contact is gone: idle with none down, else blocked. */
const after = (ids: readonly number[]): SwipeState =>
  ids.length === 0 ? { phase: "idle" } : { phase: "blocked", ids };

export function reduceSwipe(
  state: SwipeState,
  input: SwipeInput,
  config: SwipeConfig,
): { state: SwipeState; output: SwipeOutput } {
  const ids = state.phase === "idle" ? [] : state.ids;
  const point: SwipePoint = {
    id: input.id,
    x: input.x,
    y: input.y,
    at: input.at,
  };

  if (input.type === "down") {
    if (ids.includes(input.id)) return { state, output: NONE };
    const more = [...ids, input.id];
    if (state.phase === "idle")
      return {
        state: { phase: "pending", ids: more, start: point },
        output: NONE,
      };
    // A second finger: two hands to start the timer, a pinch, a palm. No swipe.
    return {
      state: { phase: "blocked", ids: more },
      output: state.phase === "tracking" ? { type: "release" } : NONE,
    };
  }

  if (input.type === "up" || input.type === "cancel") {
    if (!ids.includes(input.id)) return { state, output: NONE };
    const rest = without(ids, input.id);
    if (state.phase !== "tracking" || state.start.id !== input.id)
      return { state: after(rest), output: NONE };
    if (input.type === "cancel")
      return { state: after(rest), output: { type: "release" } };
    const { axis, start } = state;
    const raw = along(axis, point, start);
    const direction = directionOf(axis, raw);
    const allowed = raw !== 0 && config.directions.includes(direction);
    const samples = [...state.samples, point];
    const recent = samples.filter((each) => point.at - each.at <= VELOCITY_MS);
    const first = recent[0] ?? point;
    const elapsed = point.at - first.at;
    // Speed along the swipe's direction: negative when the finger is going back.
    const speed =
      elapsed > 0
        ? (Math.sign(raw) *
            (along(axis, point, start) - along(axis, first, start))) /
          elapsed
        : 0;
    const distance = Math.abs(raw);
    const flick =
      speed >= config.flingPxPerMs && distance >= 2 * config.startPx;
    const goingBack = speed <= -config.flingPxPerMs;
    const commit =
      allowed && !goingBack && (distance >= config.commitPx || flick);
    return {
      state: after(rest),
      output: commit ? { type: "commit", direction } : { type: "release" },
    };
  }

  // A move.
  if (state.phase === "idle" || state.phase === "blocked")
    return { state, output: NONE };
  if (state.start.id !== input.id) return { state, output: NONE };
  const { start } = state;

  if (state.phase === "pending") {
    const dx = input.x - start.x;
    const dy = input.y - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < config.startPx)
      return { state, output: NONE };
    // It stayed put long enough to be a hold: it stays one.
    if (input.at - start.at > config.holdMs)
      return { state: { phase: "blocked", ids }, output: NONE };
    const axis: Axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
    const onAxis = config.directions.filter((direction) =>
      axis === "x"
        ? direction === "left" || direction === "right"
        : direction === "up" || direction === "down",
    );
    if (onAxis.length === 0)
      return { state: { phase: "blocked", ids }, output: NONE };
    const raw = axis === "x" ? dx : dy;
    const shown = follow(axis, raw, config);
    return {
      state: { phase: "tracking", ids, start, axis, samples: [point] },
      output: {
        type: "claim",
        direction: shown.direction ?? directionOf(axis, raw),
        offset: shown.offset,
      },
    };
  }

  const samples = [...state.samples, point].filter(
    (each) => input.at - each.at <= VELOCITY_MS * 2,
  );
  const raw = along(state.axis, point, start);
  return {
    state: { ...state, samples },
    output: { type: "move", ...follow(state.axis, raw, config) },
  };
}
