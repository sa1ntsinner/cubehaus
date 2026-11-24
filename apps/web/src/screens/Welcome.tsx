import { useEffect, useRef } from "react";
import { keepFocusInside } from "../input/tab-loop";
import { isTouchPhone } from "../input/touch-screen";
import { gestureList, type Text } from "../text";
import "../design/welcome.css";

/**
 * The controls as small moving pictures (DESIGN.md section 18d): on a touch screen's
 * first visit over the timer, and from Settings › More as `Guide`. Each picture is a
 * phone or the time with a finger dot that does the gesture; one or two words name what
 * it does, the gesture's full wording is read to a screen reader.
 */
export function Welcome({
  words,
  closeLabel,
  onClose,
}: {
  words: Text;
  closeLabel: string;
  onClose(): void;
}) {
  const sheet = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    sheet.current?.focus({ preventScroll: true });
  }, []);
  const phone = isTouchPhone();
  const how = gestureList(words, true).map(([gesture]) => gesture);
  // The list's rows: hold, touch, ←, →, ↓, ↑ (the phone's), scramble, …, the session name.
  const said = [
    how[0],
    how[1],
    how[2],
    how[3],
    how[4],
    how[5],
    how[6],
    how[10],
  ];
  const name = words.gestures.welcome.words;
  return (
    <dialog
      ref={sheet}
      data-part="welcome"
      data-no-timer
      open
      aria-label={words.gestures.welcome.title}
      tabIndex={-1}
      onBlur={keepFocusInside}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      <ul>
        {/* Up on the time is a phone's alone (DESIGN.md section 18a). */}
        {MINIATURES.map((kind, i) =>
          kind === "up" && !phone ? null : (
            <li key={kind} data-mini={kind} style={{ "--i": i } as object}>
              <Glyph kind={kind} />
              <span aria-hidden="true">{name[i]}</span>
              <span data-part="welcome-how">
                {said[i]}: {name[i]}
              </span>
            </li>
          ),
        )}
      </ul>
      <button type="button" data-action="welcome-close" onClick={onClose}>
        {closeLabel}
      </button>
    </dialog>
  );
}

const MINIATURES = [
  "start",
  "stop",
  "left",
  "right",
  "down",
  "up",
  "scramble",
  "sessions",
] as const;
type Kind = (typeof MINIATURES)[number];

const SWIPE: Partial<Record<Kind, [number, number]>> = {
  left: [-16, 0],
  right: [16, 0],
  down: [0, 16],
  up: [0, -16],
};

/** One 64-unit picture; its strokes keep 1.5 px at any size (welcome.css). */
function Glyph({ kind }: { kind: Kind }) {
  const swipe = SWIPE[kind];
  return (
    <svg aria-hidden="true" viewBox="0 0 64 64" fill="none">
      {(kind === "start" || kind === "stop") && (
        <>
          <rect data-g="line" x="19" y="5" width="26" height="46" rx="5" />
          {kind === "start" ? (
            <circle data-g="ring" cx="32" cy="30" r="8" pathLength="1" />
          ) : (
            <circle data-g="ripple" cx="32" cy="30" r="4" />
          )}
          <circle data-g="dot" cx="32" cy="30" r="4.5" />
        </>
      )}
      {swipe && (
        <g
          data-g="move"
          style={{ "--dx": `${swipe[0]}px`, "--dy": `${swipe[1]}px` } as object}
        >
          <text data-g="time" x="32" y="36.5">
            9.41
          </text>
          <circle data-g="dot" cx="32" cy="42" r="4.5" />
        </g>
      )}
      {kind === "scramble" && (
        <>
          <text data-g="moves" data-row="old" x="32" y="34.5">
            R U′ F2
          </text>
          <text data-g="moves" data-row="new" x="32" y="34.5">
            L2 D B′
          </text>
          <circle data-g="dot" data-row="old" cx="46" cy="40" r="4.5" />
        </>
      )}
      {kind === "sessions" && (
        <>
          <text data-g="name" x="32" y="19">
            3×3
          </text>
          <g data-g="grid">
            {[0, 1, 2].flatMap((col) =>
              [0, 1].map((row) => (
                <rect
                  key={`${col},${row}`}
                  data-g="line"
                  x={15 + col * 12.5}
                  y={30 + row * 12.5}
                  width="9"
                  height="9"
                  rx="2"
                />
              )),
            )}
          </g>
          <circle data-g="dot" cx="32" cy="15" r="4.5" />
        </>
      )}
    </svg>
  );
}
