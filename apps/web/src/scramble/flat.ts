import type { EventId } from "@cubehaus/core";
import { STICKER_COLOURS, stickerColours } from "@cubehaus/cube";
import { puzzles } from "cubing/puzzles";
import { type Outline, type Point, polygonMesh } from "./geometry";
import type { TileDrawing } from "./picture";

type FlatPuzzle = "pyraminx" | "skewb" | "megaminx" | "fto";

const flatPuzzles: Partial<Record<EventId, FlatPuzzle>> = {
  pyram: "pyraminx",
  skewb: "skewb",
  minx: "megaminx",
  fto: "fto",
};

const faceletId = /^[A-Z0-9_]+-l\d+-o\d+$/;
const numbers = (attribute: string) =>
  Array.from(
    attribute.matchAll(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:e[-+]?\d+)?/gi),
    ([value]) => Number(value),
  );

function pairs(values: number[]): Point[] {
  const points: Point[] = [];
  for (let i = 0; i + 1 < values.length; i += 2) {
    points.push([values[i] as number, values[i + 1] as number]);
  }
  return points;
}

function ownTransform(element: Element) {
  const matrix = (
    element as SVGGraphicsElement
  ).transform?.baseVal.consolidate()?.matrix;
  return matrix ? DOMMatrix.fromMatrix(matrix) : new DOMMatrix();
}

function transformToRoot(element: Element, root: Element) {
  let matrix = new DOMMatrix();
  for (
    let current: Element | null = element;
    current && current !== root;
    current = current.parentElement
  ) {
    matrix = ownTransform(current).multiply(matrix);
  }
  return matrix;
}

function faceletPoints(element: Element, root: Element): Point[] {
  const matrix = transformToRoot(element, root);
  if (element.localName === "polygon") {
    return transform(
      pairs(numbers(element.getAttribute("points") ?? "")),
      matrix,
    );
  }
  // The pinned Pyraminx SVG uses two relative triangle templates under <defs>.
  if (element.localName !== "use") return [];
  const href =
    element.getAttribute("href") ?? element.getAttribute("xlink:href");
  const template = href?.startsWith("#")
    ? element.ownerDocument.getElementById(href.slice(1))
    : null;
  const path = template?.querySelector("path");
  const data = path?.getAttribute("d")?.trim() ?? "";
  if (!path || !/^m[\d+.,eE\s-]+[zZ]$/.test(data)) return [];
  let x = 0;
  let y = 0;
  const points = pairs(numbers(data)).map(([dx, dy]): Point => {
    x += dx;
    y += dy;
    return [x, y];
  });
  return transform(
    points,
    matrix
      .translate(
        Number(element.getAttribute("x")),
        Number(element.getAttribute("y")),
      )
      .multiply(transformToRoot(path, root)),
  );
}

function transform(points: readonly Point[], matrix: DOMMatrix): Point[] {
  return points.map(([x, y]) => {
    const point = matrix.transformPoint({ x, y, z: 0, w: 1 });
    return [point.x, point.y];
  });
}

const distance = ([a, b]: Point, [x, y]: Point) => Math.hypot(a - x, b - y);

async function loadMesh(puzzle: FlatPuzzle) {
  const loader = puzzles[puzzle];
  if (!loader) throw new Error(`Missing flat geometry for ${puzzle}`);
  const source = await loader.svg();
  // Parse inert geometry, without adding any library markup to the page.
  const root = new DOMParser().parseFromString(
    source.slice(source.indexOf("<svg")),
    "image/svg+xml",
  ).documentElement;
  const outlines: Outline[] = [];
  for (const element of root.querySelectorAll("[id]")) {
    const id = element.getAttribute("id");
    if (!id || !faceletId.test(id)) continue;
    const points = faceletPoints(element, root).filter(
      (point, i, list) =>
        distance(point, list[(i + list.length - 1) % list.length] as Point) >
        1e-6,
    );
    if (points.length >= 3) outlines.push({ id, points });
  }
  if (outlines.length === 0)
    throw new Error(`No facelets in ${puzzle} geometry`);
  return polygonMesh(outlines);
}

const meshes = new Map<FlatPuzzle, ReturnType<typeof loadMesh>>();

export async function flatDrawing(
  event: EventId,
  alg: string,
): Promise<TileDrawing | null> {
  const puzzle = flatPuzzles[event];
  if (!puzzle) return null;
  let mesh = meshes.get(puzzle);
  if (!mesh) {
    mesh = loadMesh(puzzle);
    meshes.set(puzzle, mesh);
    void mesh.catch(() => meshes.delete(puzzle));
  }
  const [{ viewBox, body, tiles }, colours] = await Promise.all([
    mesh,
    stickerColours(puzzle, alg),
  ]);
  return {
    viewBox,
    body,
    stickers: tiles.map((tile) => {
      const token = colours.get(tile.id);
      const colour = STICKER_COLOURS.find((colour) => colour === token);
      if (!colour) throw new Error(`Missing ${puzzle} colour for ${tile.id}`);
      return { ...tile, colour };
    }),
  };
}
