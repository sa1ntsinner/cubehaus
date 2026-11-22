import type { STICKER_COLOURS } from "@cubehaus/cube";

export type Point = readonly [number, number];
export type ViewBox = readonly [number, number, number, number];
export type Colour = (typeof STICKER_COLOURS)[number];
export type Outline = { id: string; points: readonly Point[] };

export type Tile = { id: string; path: string; delay: number };
export type Sticker = Tile & { colour: Colour };
export type Body = string | { outlines: readonly Outline[]; seam: number };

export const rounded = (value: number) => Math.round(value * 100) / 100;
const coordinates = ([x, y]: Point) => `${rounded(x)} ${rounded(y)}`;
export const polygonPoints = (points: readonly Point[]) =>
  points.map(coordinates).join(" ");

export function sweepDelay([x, y]: Point, [left, top, width, height]: ViewBox) {
  return Math.round(
    160 * ((0.55 * (x - left)) / width + (0.45 * (y - top)) / height),
  );
}

export function bounds(points: readonly Point[], padding: number): ViewBox {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return [
    left - padding,
    top - padding,
    Math.max(...xs) - left + 2 * padding,
    Math.max(...ys) - top + 2 * padding,
  ];
}

type Edge = { normal: Point; length: number };
const cross = ([ax, ay]: Point, [bx, by]: Point) => ax * by - ay * bx;

function edgesOf(points: readonly Point[], clockwise: boolean): Edge[] {
  return points.map(([x, y], i) => {
    const [nextX, nextY] = points[(i + 1) % points.length] as Point;
    const dx = nextX - x;
    const dy = nextY - y;
    const length = Math.hypot(dx, dy);
    const sign = clockwise ? 1 : -1;
    return {
      normal: [(dy / length) * sign, (-dx / length) * sign],
      length,
    };
  });
}

const offset = ([x, y]: Point, [dx, dy]: Point, distance: number): Point => [
  x + dx * distance,
  y + dy * distance,
];

/** Intersect the two offset edges at each corner, then arc back out by the radius. */
function polygonTile(
  points: readonly Point[],
  edges: readonly Edge[],
  seam: number,
  radius: number,
  clockwise: boolean,
) {
  const inset = seam / 2 + radius;
  const corners = points.map((point, i) => {
    const previous = (edges[(i + edges.length - 1) % edges.length] as Edge)
      .normal;
    const current = (edges[i] as Edge).normal;
    const bisector: Point = [
      previous[0] + current[0],
      previous[1] + current[1],
    ];
    const projection = 1 + previous[0] * current[0] + previous[1] * current[1];
    const inner = offset(point, bisector, -inset / projection);
    return {
      enter: offset(inner, previous, radius),
      exit: offset(inner, current, radius),
    };
  });
  const r = rounded(radius);
  const path = corners.map(({ enter, exit }, i) => {
    const line = `${i === 0 ? "M" : "L"}${coordinates(enter)}`;
    return r > 0
      ? `${line}A${r} ${r} 0 0 ${Number(clockwise)} ${coordinates(exit)}`
      : line;
  });
  return `${path.join("")}Z`;
}

export function polygonMesh(outlines: readonly Outline[], fixedBox?: ViewBox) {
  const points = outlines.flatMap((outline) => outline.points);
  const extent = bounds(points, 0);
  const viewBox =
    fixedBox ?? bounds(points, Math.max(extent[2], extent[3]) * 0.012);
  const measured = outlines.map(({ id, points }) => {
    const signedArea = points.reduce(
      (sum, point, i) =>
        sum + cross(point, points[(i + 1) % points.length] as Point) / 2,
      0,
    );
    const clockwise = signedArea > 0;
    const edges = edgesOf(points, clockwise);
    const area = Math.abs(signedArea);
    const perimeter = edges.reduce((sum, edge) => sum + edge.length, 0);
    return {
      id,
      points,
      area,
      edges,
      inradius: (2 * area) / perimeter,
      clockwise,
    };
  });
  const sizes = measured
    .map(({ area }) => Math.sqrt(area))
    .sort((a, b) => a - b);
  const typical = sizes[Math.floor(sizes.length / 2)] ?? 1;
  const seam = Math.max(typical * 0.075, (1.3 * viewBox[3]) / 216);
  const tiles = measured.map(({ id, points, edges, inradius, clockwise }) => {
    const centre = points.reduce<Point>(
      ([x, y], [px, py]) => [x + px / points.length, y + py / points.length],
      [0, 0],
    );
    const radius = Math.max(
      0,
      Math.min(typical * 0.14, inradius * 0.7 - seam / 2),
    );
    return {
      id,
      path: polygonTile(points, edges, seam, radius, clockwise),
      delay: sweepDelay(centre, viewBox),
    };
  });
  return { viewBox, body: { outlines, seam }, tiles };
}
