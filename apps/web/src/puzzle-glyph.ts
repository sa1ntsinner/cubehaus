import type { EventId } from "@cubehaus/core";
import type { FaceLetter } from "@cubehaus/cube/holding";

/**
 * The puzzle's own small picture on a session tile (DESIGN.md section 10, the grid): a
 * solved puzzle in the scramble picture's material, a dark core showing in thin seams
 * between bright tiles, drawn in a 100 × 100 box. Cubes stand as a corner seen from above
 * (top, front, right), so 2×2 to 7×7 differ by their grid; Pyraminx, FTO and Clock face
 * the viewer; Megaminx and Square-1 are their top with the top layer's side stickers
 * round it. One-Handed, Blindfolded and Fewest Moves are their cube with the event's
 * letters at the foot; Multi-Blind is three cubes.
 */

type Point = readonly [number, number];
/** A sticker colour by its `--pz-*` name. */
export type GlyphColour = "U" | "F" | "R" | "B" | "L" | "D" | "purple" | "grey";
export interface GlyphShape {
  d: string;
  /** A sticker's colour; none for the core. */
  colour?: GlyphColour;
  /** Light on a cube's side: 1 front, 2 right (a little darker each). */
  shade?: 1 | 2;
}
export interface Glyph {
  shapes: GlyphShape[];
  /** The event's letters at the foot (`OH`, `BLD`, `FMC`). */
  mark?: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const add = ([a, b]: Point, [c, d]: Point): Point => [a + c, b + d];
const sub = ([a, b]: Point, [c, d]: Point): Point => [a - c, b - d];
const mul = ([a, b]: Point, k: number): Point => [a * k, b * k];
const len = ([a, b]: Point) => Math.hypot(a, b);
const lerp = (p: Point, q: Point, t: number): Point =>
  add(p, mul(sub(q, p), t));

/** Where the lines p1–p2 and p3–p4 cross. */
function cross(p1: Point, p2: Point, p3: Point, p4: Point): Point {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const [x3, y3] = p3;
  const [x4, y4] = p4;
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

/** A convex polygon with each side moved `d` inward (its share of the seam). */
export function inset(points: readonly Point[], d: number): Point[] {
  const n = points.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i] as Point;
    const [x2, y2] = points[(i + 1) % n] as Point;
    area += x1 * y2 - x2 * y1;
  }
  const sign = area > 0 ? 1 : -1;
  const lines = points.map((p, i) => {
    const q = points[(i + 1) % n] as Point;
    const [dx, dy] = sub(q, p);
    const l = Math.hypot(dx, dy) || 1;
    // Inward normal for the winding.
    const normal: Point = mul([-dy / l, dx / l], sign);
    return [add(p, mul(normal, d)), add(q, mul(normal, d))] as const;
  });
  return lines.map((line, i) => {
    const prev = lines[(i + n - 1) % n] as typeof line;
    return cross(prev[0], prev[1], line[0], line[1]);
  });
}

/** A closed path through the points with corners rounded by up to `r`. */
export function roundedPath(points: readonly Point[], r: number): string {
  const n = points.length;
  let d = "";
  points.forEach((p, i) => {
    const prev = points[(i + n - 1) % n] as Point;
    const next = points[(i + 1) % n] as Point;
    const toPrev = sub(prev, p);
    const toNext = sub(next, p);
    const k = Math.min(r, len(toPrev) / 2.2, len(toNext) / 2.2);
    const a = add(p, mul(toPrev, k / (len(toPrev) || 1)));
    const b = add(p, mul(toNext, k / (len(toNext) || 1)));
    d += `${i ? "L" : "M"}${r2(a[0])} ${r2(a[1])}Q${r2(p[0])} ${r2(p[1])} ${r2(b[0])} ${r2(b[1])}`;
  });
  return `${d}Z`;
}

/** A sticker: the piece's outline less its half of the seam, corners rounded. */
function sticker(
  outline: readonly Point[],
  colour: GlyphColour,
  seam: number,
  shade?: 1 | 2,
): GlyphShape {
  const shape: GlyphShape = {
    d: roundedPath(inset(outline, seam / 2), seam * 0.9),
    colour,
  };
  if (shade) shape.shade = shade;
  return shape;
}

const core = (outline: readonly Point[], r: number): GlyphShape => ({
  d: roundedPath(outline, r),
});

/** A parallelogram face from `o` along `a` and `b`, cut into pieces by `cells`. */
function face(
  o: Point,
  a: Point,
  b: Point,
  cells: readonly (readonly Point[])[],
  colour: GlyphColour,
  seam: number,
  shade?: 1 | 2,
): GlyphShape[] {
  const at = ([u, v]: Point) => add(o, add(mul(a, u), mul(b, v)));
  return cells.map((cell) => sticker(cell.map(at), colour, seam, shade));
}

function grid(n: number): Point[][] {
  const cells: Point[][] = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++)
      cells.push([
        [i / n, j / n],
        [(i + 1) / n, j / n],
        [(i + 1) / n, (j + 1) / n],
        [i / n, (j + 1) / n],
      ]);
  return cells;
}

const skewbCells: Point[][] = [
  [
    [0.5, 0],
    [1, 0.5],
    [0.5, 1],
    [0, 0.5],
  ],
  [
    [0, 0],
    [0.5, 0],
    [0, 0.5],
  ],
  [
    [1, 0],
    [1, 0.5],
    [0.5, 0],
  ],
  [
    [1, 1],
    [0.5, 1],
    [1, 0.5],
  ],
  [
    [0, 1],
    [0, 0.5],
    [0.5, 1],
  ],
];

/**
 * A cube's corner from above: the top, front and right faces as one hexagon around
 * (cx, cy) with corner radius `radius`, its faces cut by `cells` (a grid, or Skewb's).
 */
function isoCube(
  cx: number,
  cy: number,
  radius: number,
  cells: readonly (readonly Point[])[],
  pitch: number,
): GlyphShape[] {
  const c30 = Math.cos(Math.PI / 6);
  const top: Point = [cx, cy - radius];
  const upRight: Point = [cx + radius * c30, cy - radius / 2];
  const downRight: Point = [cx + radius * c30, cy + radius / 2];
  const bottom: Point = [cx, cy + radius];
  const downLeft: Point = [cx - radius * c30, cy + radius / 2];
  const upLeft: Point = [cx - radius * c30, cy - radius / 2];
  const centre: Point = [cx, cy];
  // A tenth of a sticker, at most 2.4: on 6×6 and 7×7 the seams stay hairlines (about
  // 0.8 px at the desktop size), so the grid reads as fine rather than as dark core.
  const seam = Math.max(0.8, Math.min(2.4, pitch * 0.1));
  return [
    core([top, upRight, downRight, bottom, downLeft, upLeft], radius * 0.12),
    // The top: from its far corner toward the right and the left.
    ...face(top, sub(upRight, top), sub(upLeft, top), cells, "U", seam),
    // The front (left) face: from the top's left corner along the edge and down.
    ...face(
      upLeft,
      sub(centre, upLeft),
      sub(downLeft, upLeft),
      cells,
      "F",
      seam,
      1,
    ),
    // The right face.
    ...face(
      centre,
      sub(upRight, centre),
      sub(bottom, centre),
      cells,
      "R",
      seam,
      2,
    ),
  ];
}

function cube(n: number, cx = 50, cy = 50, radius = 46): GlyphShape[] {
  return isoCube(cx, cy, radius, grid(n), radius / n);
}

/** Triangles of a triangle a, b, c cut into n rows (n² pieces). */
function triangles(a: Point, b: Point, c: Point, n: number): Point[][] {
  const at = (i: number, j: number) =>
    add(a, add(mul(sub(b, a), i / n), mul(sub(c, a), j / n)));
  const cells: Point[][] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n - i; j++) {
      cells.push([at(i, j), at(i + 1, j), at(i, j + 1)]);
      if (j < n - i - 1)
        cells.push([at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
    }
  return cells;
}

function pyraminx(): GlyphShape[] {
  const h = (92 * Math.sqrt(3)) / 2;
  const top: Point = [50, 50 - (2 * h) / 3 + 6];
  const left: Point = [4, top[1] + h];
  const right: Point = [96, top[1] + h];
  const seam = 2;
  return [
    core([top, right, left], 7),
    ...triangles(top, left, right, 3).map((cell) => sticker(cell, "F", seam)),
  ];
}

function fto(): GlyphShape[] {
  const c: Point = [50, 50];
  const t: Point = [50, 4];
  const r: Point = [96, 50];
  const b: Point = [50, 96];
  const l: Point = [4, 50];
  const seam = 1.8;
  const faces: [Point, Point, GlyphColour][] = [
    [l, t, "U"],
    [t, r, "R"],
    [r, b, "purple"],
    [b, l, "F"],
  ];
  return [
    core([t, r, b, l], 7),
    ...faces.flatMap(([p, q, colour]) =>
      triangles(c, p, q, 3).map((cell) => sticker(cell, colour, seam)),
    ),
  ];
}

/** Points of a regular polygon of `n` corners, the first at `start` degrees. */
function polygon(
  n: number,
  radius: number,
  start: number,
  cx = 50,
  cy = 50,
): Point[] {
  return Array.from({ length: n }, (_, k) => {
    const angle = ((start + (360 / n) * k) * Math.PI) / 180;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  });
}

/** The side stickers along one edge p–q, out by `depth`, cut at the fractions given. */
function strip(
  p: Point,
  q: Point,
  depth: number,
  cuts: readonly number[],
  colour: GlyphColour,
  seam: number,
): GlyphShape[] {
  const [dx, dy] = sub(q, p);
  const l = Math.hypot(dx, dy);
  // Outward for a clockwise polygon on screen (y down).
  const out: Point = [(dy / l) * depth, (-dx / l) * depth];
  const marks = [0, ...cuts, 1];
  return marks.slice(1).map((to, i) => {
    const from = marks[i] as number;
    const a = lerp(p, q, from);
    const b = lerp(p, q, to);
    return sticker([a, b, add(b, out), add(a, out)], colour, seam);
  });
}

function megaminx(): GlyphShape[] {
  // The top face pointing up, the side stickers of its five neighbours round it.
  const corners = polygon(5, 33, -90, 50, 52);
  const seam = 1.8;
  const depth = 0.42;
  const edge = (k: number) =>
    [corners[k] as Point, corners[(k + 1) % 5] as Point] as const;
  // The cut along each edge, parallel to it at `depth` of the face's height inward.
  const centre: Point = [50, 52];
  const cut = (k: number) => {
    const [p, q] = edge(k);
    const mid = lerp(p, q, 0.5);
    const inward = sub(centre, mid);
    return [add(p, mul(inward, depth)), add(q, mul(inward, depth))] as const;
  };
  const cuts = [0, 1, 2, 3, 4].map(cut);
  const meet = (j: number, k: number) => {
    const a = cuts[j] as readonly [Point, Point];
    const b = cuts[k] as readonly [Point, Point];
    return cross(a[0], a[1], b[0], b[1]);
  };
  // Where each cut crosses an edge.
  const onEdge = (k: number, by: number) => {
    const [p, q] = edge(k);
    const c = cuts[by] as readonly [Point, Point];
    return cross(p, q, c[0], c[1]);
  };
  const inner = [0, 1, 2, 3, 4].map((k) => meet((k + 4) % 5, k));
  const shapes: GlyphShape[] = [];
  const sideColours: GlyphColour[] = ["R", "B", "D", "F", "purple"];
  for (let k = 0; k < 5; k++) {
    const [p, q] = edge(k);
    const a = onEdge(k, (k + 4) % 5);
    const b = onEdge(k, (k + 1) % 5);
    const ta = len(sub(a, p)) / len(sub(q, p));
    const tb = len(sub(b, p)) / len(sub(q, p));
    shapes.push(
      ...strip(p, q, 8.5, [ta, tb], sideColours[k] as GlyphColour, seam),
    );
  }
  shapes.unshift(
    core(
      [0, 1, 2, 3, 4].flatMap((k) => {
        const [p, q] = edge(k);
        const [dx, dy] = sub(q, p);
        const l = Math.hypot(dx, dy);
        const out: Point = [(dy / l) * 8.5, (-dx / l) * 8.5];
        return [add(p, out), add(q, out)];
      }),
      3,
    ),
    core(corners, 4),
  );
  // The top face: its centre, five edges and five corners.
  shapes.push(sticker(inner, "U", seam));
  for (let k = 0; k < 5; k++) {
    const prev = (k + 4) % 5;
    const next = (k + 1) % 5;
    shapes.push(
      sticker(
        [
          corners[k] as Point,
          onEdge(k, prev),
          inner[k] as Point,
          onEdge(prev, k),
        ],
        "U",
        seam,
      ),
      sticker(
        [
          onEdge(k, prev),
          onEdge(k, next),
          inner[next] as Point,
          inner[k] as Point,
        ],
        "U",
        seam,
      ),
    );
  }
  return shapes;
}

function square1(): GlyphShape[] {
  const s = 30;
  const c = 50;
  const seam = 1.8;
  const t = Math.tan(Math.PI / 12) * s;
  const shapes: GlyphShape[] = [];
  // Sides clockwise from the top edge: back, right, front, left.
  const sides: [Point, Point, GlyphColour][] = [
    [[c - s, c - s], [c + s, c - s], "B"],
    [[c + s, c - s], [c + s, c + s], "R"],
    [[c + s, c + s], [c - s, c + s], "F"],
    [[c - s, c + s], [c - s, c - s], "L"],
  ];
  const cuts = [(s - t) / (2 * s), (s + t) / (2 * s)];
  const depth = 11;
  // The core under the side stickers and the top.
  shapes.push(
    core(
      [
        [c - s, c - s - depth],
        [c + s, c - s - depth],
        [c + s + depth, c - s],
        [c + s + depth, c + s],
        [c + s, c + s + depth],
        [c - s, c + s + depth],
        [c - s - depth, c + s],
        [c - s - depth, c - s],
      ],
      4,
    ),
  );
  for (const [p, q, colour] of sides)
    shapes.push(...strip(p, q, depth, cuts, colour, seam));
  // The top: an edge (a thin triangle) at each side's middle, a kite at each corner.
  const centre: Point = [c, c];
  const along = (k: number, f: number) => {
    const [p, q] = sides[k] as [Point, Point, GlyphColour];
    return lerp(p, q, f);
  };
  for (let k = 0; k < 4; k++) {
    shapes.push(
      sticker(
        [centre, along(k, cuts[0] as number), along(k, cuts[1] as number)],
        "U",
        seam,
      ),
    );
    const next = (k + 1) % 4;
    shapes.push(
      sticker(
        [
          centre,
          along(k, cuts[1] as number),
          (sides[k] as [Point, Point, GlyphColour])[1],
          along(next, cuts[0] as number),
        ],
        "U",
        seam,
      ),
    );
  }
  return shapes;
}

/** Clock's front: nine dials at twelve on a dark body, the pins between them. */
function clock(): GlyphShape[] {
  const shapes: GlyphShape[] = [
    core(
      [
        [8, 8],
        [92, 8],
        [92, 92],
        [8, 92],
      ],
      22,
    ),
  ];
  const circle = (x: number, y: number, r: number) =>
    `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  for (const y of [26, 50, 74])
    for (const x of [26, 50, 74]) {
      shapes.push({ d: circle(x, y, 10), colour: "U" });
      // The hand at twelve: a narrow wedge from the centre up.
      shapes.push({
        d: `M${x - 1.6} ${y}L${x} ${y - 8}L${x + 1.6} ${y}Z${circle(x, y, 1.9)}`,
      });
    }
  for (const y of [38, 62])
    for (const x of [38, 62])
      shapes.push({ d: circle(x, y, 2.6), colour: "grey" });
  return shapes;
}

const cubeSize: Partial<Record<EventId, number>> = {
  "333": 3,
  "222": 2,
  "444": 4,
  "555": 5,
  "666": 6,
  "777": 7,
  "333oh": 3,
  "333bf": 3,
  "333fm": 3,
  "444bf": 4,
  "555bf": 5,
};

const marks: Partial<Record<EventId, string>> = {
  "333oh": "OH",
  "333bf": "BLD",
  "444bf": "BLD",
  "555bf": "BLD",
  "333fm": "FMC",
};

function draw(event: EventId): Glyph {
  const size = cubeSize[event];
  if (size !== undefined) {
    const mark = marks[event];
    // A mark takes the cube's lower right corner; the cube steps up and left a little.
    const shapes = mark ? cube(size, 44, 44, 41) : cube(size);
    return mark ? { shapes, mark } : { shapes };
  }
  switch (event) {
    case "333mbf":
      // Three cubes: two behind, one in front.
      return {
        shapes: [
          ...cube(3, 28, 32, 25),
          ...cube(3, 72, 32, 25),
          ...cube(3, 50, 66, 30),
        ],
      };
    case "pyram":
      return { shapes: pyraminx() };
    case "skewb":
      return { shapes: isoCube(50, 50, 46, skewbCells, 23) };
    case "minx":
      return { shapes: megaminx() };
    case "sq1":
      return { shapes: square1() };
    case "clock":
      return { shapes: clock() };
    case "fto":
      return { shapes: fto() };
    default:
      return { shapes: cube(3) };
  }
}

/** Puzzles held as a cube: their pictures take the colours the person holds. */
const heldAsCube = new Set<EventId>([
  ...(Object.keys(cubeSize) as EventId[]),
  "333mbf",
  "skewb",
  "sq1",
]);

/**
 * A sticker's colour as the person holds the puzzle while solving (Settings, colour on
 * top and in front; `holdingFaces`), the way the trainer draws its cases: a cube drawn
 * with white on top shows yellow there for someone who solves yellow on top. Puzzles not
 * held as a cube (Megaminx, Pyraminx, FTO, Clock) keep their own colours.
 */
export function heldColour(
  event: EventId,
  colour: GlyphColour,
  faces: Readonly<Record<FaceLetter, FaceLetter>>,
): GlyphColour {
  if (!heldAsCube.has(event) || !(colour in faces)) return colour;
  return faces[colour as FaceLetter];
}

const drawn = new Map<EventId, Glyph>();

/** The tile picture of a puzzle, drawn once and kept. */
export function puzzleGlyph(event: EventId): Glyph {
  let glyph = drawn.get(event);
  if (!glyph) {
    glyph = draw(event);
    drawn.set(event, glyph);
  }
  return glyph;
}
