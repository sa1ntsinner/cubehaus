import type { Arrow } from "@cubehaus/algs";
import type { Face } from "@cubehaus/cube";
import { holdingFaces } from "@cubehaus/cube/holding";
import type { TrainingBase, TrainingLL } from "@cubehaus/scramble";
import {
  type LastLayerCase,
  lastLayerCases,
} from "@cubehaus/scramble/last-layer";
import { useMemo, useState } from "react";
import type { Text } from "../text";
import type { TrainingProfile } from "./training-client";

/**
 * Drill scrambles for 3×3: the sheet that picks one, and the line under the scramble
 * that says a drill is on. A drill is not a WCA scramble; the line says so in words.
 */

/** The timer's drills: F2L cases are drilled in the trainer only. */
export type DrillKind =
  | "official"
  | TrainingBase["kind"]
  | Exclude<TrainingLL["kind"], "f2l">;

/** The cross colours as cubers name them, by face in the scramble's orientation. */
export const FACES: readonly Face[] = ["U", "D", "F", "B", "R", "L"];
export const RANGES = { "easy-cross": 8, "easy-xcross": 6 } as const;

/** What a search matches: the name, and for OLL the shape of the top edges. */
function caseSearchText(c: LastLayerCase, words: Text): string {
  if (c.kind !== "oll") return c.label;
  const flipped = [0, 1, 2, 3].filter((e) => c.state.eo[e] === 1);
  const shape =
    flipped.length === 0
      ? "cross"
      : flipped.length === 4
        ? "dot"
        : (flipped[1] as number) - (flipped[0] as number) === 2
          ? "line"
          : "L";
  return `${c.label} ${words.drill.group[shape]}`;
}

/** The top of the cube with its side stickers, as a cuber draws a last-layer case. */
export function CaseDiagram({
  stickers,
  orientationOnly,
  edgesOnTop = false,
  faces,
  arrows,
}: {
  /** PLL: which top piece goes where (`pllArrows`), drawn on the top face. */
  arrows?: readonly Arrow[] | undefined;
  stickers: string;
  /** The colour of each face as the person holds the cube (`holdingFaces`). */
  faces?: Record<string, string> | undefined;
  orientationOnly: boolean;
  /** COLL: the edges' side stickers say nothing (only that they are oriented): grey. */
  edgesOnTop?: boolean;
}) {
  // stickers: U 0–8 row by row from the back left, then the top rows of F, R, B, L as
  // each is seen from outside. Seen from above, B runs right to left, R and L top down.
  const at = (index: number) =>
    edgesOnTop && [10, 13, 16, 19].includes(index)
      ? "grey"
      : (stickers[index] ?? "U");
  const paint = (face: string) => `var(--pz-${faces?.[face] ?? face})`;
  const fill = (colour: string) =>
    colour === "grey"
      ? "var(--pz-grey)"
      : orientationOnly
        ? colour === "U"
          ? paint("U")
          : "var(--pz-grey)"
        : paint(colour);
  const cells: { x: number; y: number; w: number; h: number; c: string }[] = [];
  for (let i = 0; i < 9; i++)
    cells.push({
      x: 1 + (i % 3),
      y: 1 + Math.floor(i / 3),
      w: 1,
      h: 1,
      c: at(i),
    });
  const strip = 0.38;
  for (let k = 0; k < 3; k++) {
    cells.push({ x: 1 + k, y: 4, w: 1, h: strip, c: at(9 + k) }); // F
    cells.push({ x: 4, y: 3 - k, w: strip, h: 1, c: at(12 + k) }); // R
    cells.push({ x: 3 - k, y: 1 - strip, w: 1, h: strip, c: at(15 + k) }); // B
    cells.push({ x: 1 - strip, y: 1 + k, w: strip, h: 1, c: at(18 + k) }); // L
  }
  const gap = 0.07;
  return (
    <svg
      data-part="case-diagram"
      viewBox={`${1 - strip - gap} ${1 - strip - gap} ${3 + 2 * (strip + gap)} ${3 + 2 * (strip + gap)}`}
      aria-hidden="true"
    >
      {cells.map((cell) => (
        <rect
          key={`${cell.x},${cell.y}`}
          x={cell.x + gap / 2}
          y={cell.y + gap / 2}
          width={cell.w - gap}
          height={cell.h - gap}
          rx={0.12}
          fill={fill(cell.c)}
        />
      ))}
      {arrows && arrows.length > 0 && (
        <g data-part="case-arrows" fill="var(--pz-body)">
          {arrows.map((arrow) => (
            <ArrowLine key={`${arrow.from}-${arrow.to}`} arrow={arrow} />
          ))}
        </g>
      )}
    </svg>
  );
}

/**
 * A 2×2 case as a cuber draws one: the top's four stickers with the side stickers round
 * them. `stickers` is 12 letters (two.ts): U row by row from the back left, then the top
 * row of F, R, B and L as each is seen from outside; with 20, the bottom row of each side
 * after them, drawn as a second ring (PBL: both layers' places). Seen from above, B runs
 * right to left, R and L top down. For OLL only the top's colour is drawn.
 */
export function TwoDiagram({
  stickers,
  faces,
  orientationOnly = false,
}: {
  stickers: string;
  faces?: Record<string, string> | undefined;
  orientationOnly?: boolean;
}) {
  const paint = (face: string) => `var(--pz-${faces?.[face] ?? face})`;
  const fill = (letter: string) =>
    orientationOnly
      ? letter === "U"
        ? paint("U")
        : "var(--pz-grey)"
      : paint(letter);
  const at = (index: number) => stickers[index] ?? "U";
  const cells: { x: number; y: number; w: number; h: number; c: string }[] = [];
  for (let i = 0; i < 4; i++)
    cells.push({
      x: 1 + (i % 2),
      y: 1 + Math.floor(i / 2),
      w: 1,
      h: 1,
      c: at(i),
    });
  const strip = 0.42;
  const gap = 0.08;
  const rings = stickers.length >= 20 ? 2 : 1;
  for (let ring = 0; ring < rings; ring++) {
    const out = ring * (strip + gap);
    const base = 4 + ring * 8;
    for (let k = 0; k < 2; k++) {
      cells.push({ x: 1 + k, y: 3 + out, w: 1, h: strip, c: at(base + k) }); // F
      cells.push({ x: 3 + out, y: 2 - k, w: strip, h: 1, c: at(base + 2 + k) }); // R
      cells.push({
        x: 2 - k,
        y: 1 - strip - out,
        w: 1,
        h: strip,
        c: at(base + 4 + k),
      }); // B
      cells.push({
        x: 1 - strip - out,
        y: 1 + k,
        w: strip,
        h: 1,
        c: at(base + 6 + k),
      }); // L
    }
  }
  const edge = rings * (strip + gap);
  return (
    <svg
      data-part="case-diagram"
      data-shape="two"
      viewBox={`${1 - edge} ${1 - edge} ${2 + 2 * edge} ${2 + 2 * edge}`}
      aria-hidden="true"
    >
      {cells.map((cell) => (
        <rect
          key={`${cell.x},${cell.y}`}
          x={cell.x + gap / 2}
          y={cell.y + gap / 2}
          width={cell.w - gap}
          height={cell.h - gap}
          rx={0.12}
          fill={fill(cell.c)}
        />
      ))}
    </svg>
  );
}

/**
 * An F2L case: the cube's top, front and right faces seen from above the front right
 * corner, each sticker a parallelogram. `stickers` is 27 letters (f2l-state.ts): U row by
 * row from the back left, then F and R row by row from the top left as each is seen from
 * outside; `x` is a last-layer sticker that says nothing, drawn grey.
 */
export function SlotDiagram({
  stickers,
  faces,
  mirrored = false,
}: {
  stickers: string;
  faces?: Record<string, string> | undefined;
  /** The front left slot: drawn in the mirror, seen from above the front left corner. */
  mirrored?: boolean;
}) {
  // x to the right, y up, z towards the front; the cube spans 0–3 on each.
  const cos = Math.cos(Math.PI / 6);
  const project = (x: number, y: number, z: number) =>
    [(x - z) * cos, (x + z) / 2 - y] as const;
  type Corner = readonly [number, number, number];
  const cells: { at: number; corners: Corner[] }[] = [];
  for (let i = 0; i < 9; i++) {
    const r = Math.floor(i / 3);
    const c = i % 3;
    cells.push({
      at: i,
      corners: [
        [c, 3, r],
        [c + 1, 3, r],
        [c + 1, 3, r + 1],
        [c, 3, r + 1],
      ],
    });
    cells.push({
      at: 9 + i,
      corners: [
        [c, 3 - r, 3],
        [c + 1, 3 - r, 3],
        [c + 1, 2 - r, 3],
        [c, 2 - r, 3],
      ],
    });
    cells.push({
      at: 18 + i,
      corners: [
        [3, 3 - r, 3 - c],
        [3, 3 - r, 2 - c],
        [3, 2 - r, 2 - c],
        [3, 2 - r, 3 - c],
      ],
    });
  }
  const inset = 0.86;
  const points = (corners: Corner[]) => {
    const flat = corners.map(([x, y, z]) => project(x, y, z));
    const cx = flat.reduce((s, [px]) => s + px, 0) / 4;
    const cy = flat.reduce((s, [, py]) => s + py, 0) / 4;
    return flat
      .map(
        ([px, py]) =>
          `${(cx + (px - cx) * inset).toFixed(3)},${(cy + (py - cy) * inset).toFixed(3)}`,
      )
      .join(" ");
  };
  const fill = (letter: string) =>
    letter === "x" || !letter
      ? "var(--pz-grey)"
      : `var(--pz-${faces?.[letter] ?? letter})`;
  // Corners of the drawing: the top's back and the faces' bottom points.
  const [left] = project(0, 3, 3);
  const [right] = project(3, 3, 0);
  const [, top] = project(0, 3, 0);
  const [, bottom] = project(3, 0, 3);
  const pad = 0.1;
  return (
    <svg
      data-part="case-diagram"
      data-shape="slot"
      data-mirrored={mirrored ? "" : undefined}
      viewBox={`${left - pad} ${top - pad} ${right - left + 2 * pad} ${bottom - top + 2 * pad}`}
      aria-hidden="true"
    >
      <g
        transform={
          mirrored ? `translate(${left + right} 0) scale(-1 1)` : undefined
        }
      >
        <polygon
          points={(
            [
              [0, 3, 0],
              [3, 3, 0],
              [3, 0, 0],
              [3, 0, 3],
              [0, 0, 3],
              [0, 3, 3],
            ] as const
          )
            .map(([x, y, z]) => project(x, y, z).join(","))
            .join(" ")}
          fill="var(--pz-body)"
          stroke="var(--pz-body)"
          strokeWidth={0.16}
          strokeLinejoin="round"
        />
        {cells.map((cell) => {
          const colour = fill(stickers[cell.at] as string);
          return (
            <polygon
              key={cell.at}
              points={points(cell.corners)}
              fill={colour}
              stroke={colour}
              strokeWidth={0.1}
              strokeLinejoin="round"
            />
          );
        })}
      </g>
    </svg>
  );
}

/** The centre of a top place, 0–8 row by row from the back left. */
const centre = (place: number) => ({
  x: 1.5 + (place % 3),
  y: 1.5 + Math.floor(place / 3),
});

/**
 * One arrow between two top places: a hairline with a small solid head, kept clear of the
 * stickers' centres at both ends. An arrow between two neighbouring corners runs close to
 * their side of the face, so it never crosses an edge piece's own arrow.
 */
function ArrowLine({ arrow }: { arrow: Arrow }) {
  let a = centre(arrow.from);
  let b = centre(arrow.to);
  if (arrow.piece === "corner" && (a.x === b.x || a.y === b.y)) {
    const out = 0.3;
    if (a.x === b.x) {
      const dx = a.x < 2.5 ? -out : out;
      a = { ...a, x: a.x + dx };
      b = { ...b, x: b.x + dx };
    } else {
      const dy = a.y < 2.5 ? -out : out;
      a = { ...a, y: a.y + dy };
      b = { ...b, y: b.y + dy };
    }
  }
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  const inset = 0.2;
  const head = 0.24;
  const wing = 0.11;
  const tip = { x: b.x - ux * inset, y: b.y - uy * inset };
  const tail = { x: a.x + ux * inset, y: a.y + uy * inset };
  const headAt = (p: { x: number; y: number }, sx: number, sy: number) => {
    const bx = p.x - sx * head;
    const by = p.y - sy * head;
    return `${p.x},${p.y} ${bx - sy * wing},${by + sx * wing} ${bx + sy * wing},${by - sx * wing}`;
  };
  const start = arrow.both
    ? { x: tail.x + ux * head * 0.9, y: tail.y + uy * head * 0.9 }
    : tail;
  const end = { x: tip.x - ux * head * 0.9, y: tip.y - uy * head * 0.9 };
  return (
    <g>
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        stroke="var(--pz-body)"
        strokeWidth={0.065}
        strokeLinecap="round"
      />
      <polygon points={headAt(tip, ux, uy)} />
      {arrow.both && <polygon points={headAt(tail, -ux, -uy)} />}
    </g>
  );
}

const defaults = (kind: DrillKind, face: Face): TrainingProfile => {
  switch (kind) {
    case "official":
      return { request: null };
    case "easy-cross":
      return { request: { kind, face, length: 4 } };
    case "easy-xcross":
      return { request: { kind, face, length: 3 } };
    case "cross-solved":
      return { request: { kind, face } };
    case "oll":
    case "pll":
    case "coll":
    case "ll":
      return { request: { kind, caseIds: [] } };
    default:
      return { request: { kind } };
  }
};

export function Training({
  profile,
  holding,
  words,
  onChange,
  onClose,
}: {
  profile: TrainingProfile;
  holding: string;
  words: Text;
  onChange(profile: TrainingProfile): void;
  onClose(): void;
}) {
  const t = words.drill;
  // The sheet shows each choice at once; the setting is saved behind it.
  const [draft, setDraft] = useState(profile);
  const change = (next: TrainingProfile) => {
    setDraft(next);
    onChange(next);
  };
  const request = draft.request;
  const kind: DrillKind =
    !request || request.kind === "f2l" ? "official" : request.kind;
  // A new cross drill is on the colour held at the bottom.
  const faces = holdingFaces(holding);
  const face: Face =
    request && "face" in request ? request.face : (faces.D as Face);
  const [query, setQuery] = useState("");
  const catalogue = useMemo(() => lastLayerCases(), []);
  const kinds: DrillKind[] = [
    "official",
    "easy-cross",
    "easy-xcross",
    "cross-solved",
    "edges-only",
    "corners-only",
    "two-gen",
    "oll",
    "pll",
  ];
  const cases =
    kind === "oll" ? catalogue.oll : kind === "pll" ? catalogue.pll : [];
  const chosen = new Set(
    request && "caseIds" in request ? request.caseIds : [],
  );
  const shown = cases
    .filter((c) => !c.label.endsWith("skip"))
    .filter((c) =>
      caseSearchText(c, words)
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    );
  const setCases = (ids: Iterable<string>) =>
    change({
      request: { kind: kind as "oll" | "pll", caseIds: [...ids] },
    });

  return (
    <dialog
      data-part="training"
      data-no-timer
      open
      aria-label={t.title}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <button type="button" data-action="dialog-close" onClick={onClose}>
        {words.timer}
      </button>
      <fieldset data-part="training-kinds">
        <legend>{t.title}</legend>
        {kinds.map((option) => (
          <div key={option} data-kind={option}>
            <label>
              <input
                type="radio"
                name="drill"
                value={option}
                checked={kind === option}
                autoFocus={kind === option}
                onChange={() => change(defaults(option, face))}
              />{" "}
              {t.kind[option]}
            </label>
            {kind === option &&
              request &&
              "length" in request &&
              (option === "easy-cross" || option === "easy-xcross") && (
                <label data-part="training-length">
                  {t.turns}{" "}
                  <select
                    data-action="training-length"
                    value={request.length}
                    onChange={(event) =>
                      change({
                        request: {
                          ...request,
                          length: Number(event.target.value),
                        },
                      })
                    }
                  >
                    {Array.from(
                      { length: RANGES[option] + 1 },
                      (_, n) => n,
                    ).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            {kind === option && request && "face" in request && (
              <label data-part="training-face">
                {t.cross}{" "}
                <select
                  data-action="training-face"
                  value={request.face}
                  onChange={(event) =>
                    change({
                      request: { ...request, face: event.target.value as Face },
                    })
                  }
                >
                  {FACES.map((side) => (
                    <option key={side} value={side}>
                      {t.colour[side]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        ))}
      </fieldset>
      {(kind === "oll" || kind === "pll") && (
        <section data-part="training-cases">
          <p data-part="training-case-tools">
            <input
              type="search"
              data-part="training-query"
              aria-label={t.find}
              placeholder={t.find}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />{" "}
            <button
              type="button"
              data-action="training-all"
              onClick={() =>
                setCases(new Set([...chosen, ...shown.map((c) => c.id)]))
              }
            >
              {t.all}
            </button>{" "}
            <button
              type="button"
              data-action="training-none"
              onClick={() =>
                setCases(
                  [...chosen].filter((id) => !shown.some((c) => c.id === id)),
                )
              }
            >
              {t.none}
            </button>
          </p>
          {chosen.size === 0 && (
            <p data-part="training-empty" role="status">
              {t.pickOne}
            </p>
          )}
          <ul data-part="training-case-list">
            {shown.map((c) => (
              <li key={c.id} data-case-id={c.id}>
                <button
                  type="button"
                  aria-pressed={chosen.has(c.id)}
                  onClick={() => {
                    const next = new Set(chosen);
                    if (next.has(c.id)) next.delete(c.id);
                    else next.add(c.id);
                    setCases(next);
                  }}
                >
                  <CaseDiagram
                    stickers={c.stickers}
                    faces={faces}
                    orientationOnly={kind === "oll"}
                  />
                  <span>{c.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </dialog>
  );
}
