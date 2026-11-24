import type { Arrow } from "@cubehaus/algs";
import "../design/case-diagram.css";

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
  // `x` is a sticker that says nothing (a last-slot case's last layer), drawn grey.
  const at = (index: number) =>
    (edgesOnTop && [10, 13, 16, 19].includes(index)) || stickers[index] === "x"
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
          data-letter={cell.c}
          fill={fill(cell.c)}
        />
      ))}
    </svg>
  );
}

/**
 * A PBL case as a small tile: the four sides, each as a 2 × 2 face of its own (the top
 * layer's row over the bottom layer's), in the order met walking round the cube, front
 * and right over back and left. PBL is told by the bars on the sides of each layer, which
 * this shows at a size the rings round the top cannot; the top, one colour in every PBL
 * case, says nothing and is left out. `stickers` is the 20 letters of TwoDiagram.
 */
export function TwoSides({
  stickers,
  faces,
}: {
  stickers: string;
  faces?: Record<string, string> | undefined;
}) {
  const paint = (face: string) => `var(--pz-${faces?.[face] ?? face})`;
  const gap = 0.1;
  const apart = 0.7;
  const cells: { x: number; y: number; c: string; key: string }[] = [];
  for (let k = 0; k < 4; k++) {
    const ox = (k % 2) * (2 + apart);
    const oy = Math.floor(k / 2) * (2 + apart);
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 2; col++)
        cells.push({
          x: ox + col,
          y: oy + row,
          c: stickers[4 + row * 8 + k * 2 + col] ?? "U",
          key: `${k}${row}${col}`,
        });
  }
  const size = 4 + apart;
  const pad = 0.24;
  return (
    <svg
      data-part="case-diagram"
      data-shape="two-sides"
      viewBox={`${-pad} ${-pad} ${size + 2 * pad} ${size + 2 * pad}`}
      aria-hidden="true"
    >
      {cells.map((cell) => (
        <rect
          key={cell.key}
          // Not data-sticker: the scramble picture paints those in the standard scheme,
          // which would override the colours as the person holds the cube.
          data-letter={cell.c}
          x={cell.x + gap / 2}
          y={cell.y + gap / 2}
          width={1 - gap}
          height={1 - gap}
          rx={0.14}
          fill={paint(cell.c)}
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
