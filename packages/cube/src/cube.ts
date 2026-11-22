const FACES = ["U", "L", "F", "R", "B", "D"] as const;
export type Face = (typeof FACES)[number];
export type CubeState = Record<Face, Face[]>;

type Axis = 0 | 1 | 2;
type Point = [number, number, number];
type Cycle = [number, number, number, number];
type Layers = Cycle[][];
type FaceTurn = { axis: Axis; direction: 1 | -1 };
type Turn = { axis: Axis; low: number; high: number; quarters: number };

const FACE_TURNS: Record<Face, FaceTurn> = {
  R: { axis: 0, direction: 1 },
  L: { axis: 0, direction: -1 },
  U: { axis: 1, direction: 1 },
  D: { axis: 1, direction: -1 },
  F: { axis: 2, direction: 1 },
  B: { axis: 2, direction: -1 },
};
const ROTATIONS = { x: "R", y: "U", z: "F" } as const;
const SLICES = { M: "L", E: "D", S: "F" } as const;

function parseTurn(token: string, n: number): Turn | undefined {
  const match = /^(\d*)([ULFRBDulfrbdxyzMES])(w?)(\d*)('?)$/.exec(token);
  if (!match) return;
  const [, prefix, letter = "", wide, amount, prime] = match;

  // Depths are one-based from the face that defines the turn direction.
  let first = 1;
  let last = n;
  let face: Face;
  if (letter === "x" || letter === "y" || letter === "z") {
    if (prefix || wide) return;
    face = ROTATIONS[letter];
  } else if (letter === "M" || letter === "E" || letter === "S") {
    if (prefix || wide) return;
    face = SLICES[letter];
    first = 2;
    last = n - 1;
  } else {
    face = letter.toUpperCase() as Face;
    if (wide || letter !== face) {
      last = prefix ? Number(prefix) : 2;
      if (last < 2 || last > n) return;
    } else {
      first = last = prefix ? Number(prefix) : 1;
      if (first < 1 || first > n) return;
    }
  }

  const { axis, direction } = FACE_TURNS[face];
  const steps = amount ? Number(amount) : 1;
  if (!Number.isSafeInteger(steps)) return;
  const quarters = (4 + (((prime ? -steps : steps) * direction) % 4)) % 4;
  if (quarters === 0 || first > last) return;
  return direction === 1
    ? { axis, low: n - last, high: n - first, quarters }
    : { axis, low: first - 1, high: last - 1, quarters };
}

// Cubie coordinates are 1…n along the axes pointing toward R, U and F.
// A facelet sits one unit outside its cubie, so its outward axis is 0 or n+1.
function surface(face: Face, n: number, row: number, col: number): Point {
  const edge = n + 1;
  switch (face) {
    case "U":
      return [col + 1, edge, row + 1];
    case "L":
      return [0, n - row, col + 1];
    case "F":
      return [col + 1, n - row, edge];
    case "R":
      return [edge, n - row, n - col];
    case "B":
      return [n - col, n - row, 0];
    case "D":
      return [col + 1, 0, n - row];
  }
}

function clockwise([x, y, z]: Point, axis: Axis, edge: number): Point {
  switch (axis) {
    case 0:
      return [x, z, edge - y];
    case 1:
      return [edge - z, y, x];
    case 2:
      return [y, edge - x, z];
  }
}

const tables = new Map<number, [Layers, Layers, Layers]>();

function layerCycles(n: number): [Layers, Layers, Layers] {
  const cached = tables.get(n);
  if (cached) return cached;

  const points: Point[] = [];
  const width = n + 2;
  const key = ([x, y, z]: Point) => (x * width + y) * width + z;
  const index = new Int16Array(width ** 3);
  for (const face of FACES) {
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const point = surface(face, n, row, col);
        index[key(point)] = points.length;
        points.push(point);
      }
    }
  }

  function build(axis: Axis): Layers {
    const edge = n + 1;
    const layers = Array.from({ length: n }, (): Cycle[] => []);
    for (const [a, point] of points.entries()) {
      let next = clockwise(point, axis, edge);
      const b = index[key(next)] as number;
      next = clockwise(next, axis, edge);
      const c = index[key(next)] as number;
      next = clockwise(next, axis, edge);
      const d = index[key(next)] as number;
      // A quarter turn consists of disjoint four-cycles and fixed stickers.
      // Keep each cycle exactly once, starting at its smallest index.
      if (a < b && a < c && a < d) {
        const layer = Math.min(n - 1, Math.max(0, point[axis] - 1));
        layers[layer]?.push([a, b, c, d]);
      }
    }
    return layers;
  }

  const cycles: [Layers, Layers, Layers] = [build(0), build(1), build(2)];
  tables.set(n, cycles);
  return cycles;
}

/** Face colours in net order, each face read row by row from the top left. */
export function cubeState(n: number, alg: string): CubeState {
  if (!Number.isInteger(n) || n < 2 || n > 7) {
    throw new RangeError("Cube size must be an integer from 2 to 7");
  }
  const area = n * n;
  const colours = FACES.flatMap((face) => Array<Face>(area).fill(face));
  const cycles = layerCycles(n);

  for (const token of alg.split(/\s+/)) {
    const turn = parseTurn(token, n);
    if (!turn) continue;
    const { low, high, quarters } = turn;
    const layers = cycles[turn.axis];
    for (let layer = low; layer <= high; layer++) {
      for (const cycle of layers[layer] as Cycle[]) {
        const [a, b, c, d] = cycle;
        const first = colours[a] as Face;
        const second = colours[b] as Face;
        const third = colours[c] as Face;
        const fourth = colours[d] as Face;
        if (quarters === 1) {
          colours[a] = fourth;
          colours[b] = first;
          colours[c] = second;
          colours[d] = third;
        } else if (quarters === 2) {
          colours[a] = third;
          colours[b] = fourth;
          colours[c] = first;
          colours[d] = second;
        } else {
          colours[a] = second;
          colours[b] = third;
          colours[c] = fourth;
          colours[d] = first;
        }
      }
    }
  }

  return {
    U: colours.slice(0, area),
    L: colours.slice(area, 2 * area),
    F: colours.slice(2 * area, 3 * area),
    R: colours.slice(3 * area, 4 * area),
    B: colours.slice(4 * area, 5 * area),
    D: colours.slice(5 * area),
  };
}
