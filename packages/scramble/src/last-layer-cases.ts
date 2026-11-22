import type { KPattern } from "cubing/kpuzzle";
import {
  allLastLayers,
  aufVariants,
  collKey,
  fromKey,
  fullKey,
  isCollState,
  isOriented,
  type LastLayer,
  ollKey,
  parityOf,
  pllKey,
  pllName,
  turnAfter,
} from "./last-layer";

/**
 * The OLL and PLL cases with stable IDs (`oll-` or `pll-` and the class's least key,
 * `ll-` and 16 digits for a full last layer), a conventional label where one is read
 * from the pieces, and a sticker diagram.
 *
 * Labels: all 21 PLL names, from what each case does to the pieces (last-layer.ts), and
 * all 57 conventional OLL numbers (OLL_NUMBERS). Every OLL case also has a group by
 * its edges (cross, dot, line, L; corners when only the edges are wrong) for search,
 * with an order within it.
 *
 * The diagram is 21 letters naming the face colour on each top sticker: U row by row
 * from the back left (9), then the top rows of F, R, B and L as each is seen from
 * outside, left to right (3 each).
 */
export type CaseKind = "oll" | "pll" | "ll";
export type OllGroup = "skip" | "cross" | "corners" | "dot" | "line" | "L";
export type LastLayerCase = {
  id: string;
  kind: "oll" | "pll";
  /** `OLL 27`, `T`, `OLL skip`. */
  label: string;
  group: OllGroup | "pll";
  /** The order within its group, from 1. */
  order: number;
  /** A member of the class: its pieces in cubing's places. */
  state: LastLayer;
  stickers: string;
};

// cubing's top places and their stickers as (face, index) on our net: edges UF UR UB UL
// (the U sticker, then the side), corners UFR URB UBL ULF (the U sticker, then
// clockwise; a corner's twist is which of the three holds its U colour).
const SIDES = ["F", "R", "B", "L"] as const;
// Diagram index of each side sticker: F 9–11, R 12–14, B 15–17, L 18–20.
const side = (face: (typeof SIDES)[number], column: number) =>
  9 + SIDES.indexOf(face) * 3 + column;
// U row-major: back row 0–2, middle 3–5, front 6–8.
const EDGE_PLACES: readonly [number, number][] = [
  [7, side("F", 1)],
  [5, side("R", 1)],
  [1, side("B", 1)],
  [3, side("L", 1)],
];
const EDGE_COLOURS = ["F", "R", "B", "L"] as const;
const CORNER_PLACES: readonly [number, number, number][] = [
  // UFR: U, its R sticker (R's left), its F sticker (F's right).
  [8, side("R", 0), side("F", 2)],
  // URB: U, B's left, R's right.
  [2, side("B", 0), side("R", 2)],
  // UBL: U, L's left, B's right.
  [0, side("L", 0), side("B", 2)],
  // ULF: U, F's left, L's right.
  [6, side("F", 0), side("L", 2)],
];
const CORNER_COLOURS: readonly [string, string][] = [
  ["R", "F"],
  ["B", "R"],
  ["L", "B"],
  ["F", "L"],
];

export function stickersOf(state: LastLayer): string {
  const cells = Array<string>(21).fill("?");
  cells[4] = "U";
  for (let place = 0; place < 4; place++) {
    const [top, sideCell] = EDGE_PLACES[place] as [number, number];
    const colour = EDGE_COLOURS[state.ep[place] as number] as string;
    const flipped = state.eo[place] === 1;
    cells[top] = flipped ? colour : "U";
    cells[sideCell] = flipped ? "U" : colour;
  }
  for (let place = 0; place < 4; place++) {
    const cellsOf = CORNER_PLACES[place] as [number, number, number];
    const [a, b] = CORNER_COLOURS[state.cp[place] as number] as [
      string,
      string,
    ];
    const colours = ["U", a, b];
    const twist = state.co[place] as number;
    for (let k = 0; k < 3; k++)
      cells[cellsOf[(twist + k) % 3] as number] = colours[k] as string;
  }
  return cells.join("");
}

/**
 * The conventional OLL number of each class, by its key (eo then co, least over U
 * turns). Each was found by playing a well-known algorithm for that number backwards
 * on a solved cube; last-layer.test.ts repeats this and requires the 57 to be distinct.
 */
const OLL_NUMBERS: Readonly<Record<string, number>> = {
  "11111212": 1,
  "11111122": 2,
  "11110222": 3,
  "11110111": 4,
  "00110222": 5,
  "00110111": 6,
  "00112022": 7,
  "00111110": 8,
  "00111101": 9,
  "00112202": 10,
  "00112220": 11,
  "00111011": 12,
  "01010222": 13,
  "01011011": 14,
  "01012022": 15,
  "01010111": 16,
  "11110102": 17,
  "11110012": 18,
  "11110021": 19,
  "11110000": 20,
  "00001212": 21,
  "00001122": 22,
  "00000012": 23,
  "00000021": 24,
  "00000102": 25,
  "00000111": 26,
  "00000222": 27,
  "00110000": 28,
  "00112100": 29,
  "00111002": 30,
  "00110210": 31,
  "00110021": 32,
  "01010210": 33,
  "01010021": 34,
  "00110201": 35,
  "00111020": 36,
  "00110102": 37,
  "00112010": 38,
  "01010102": 39,
  "01011020": 40,
  "00112001": 41,
  "00111200": 42,
  "00110120": 43,
  "00110012": 44,
  "01010120": 45,
  "01010012": 46,
  "00112211": 47,
  "00111221": 48,
  "00111122": 49,
  "00112112": 50,
  "01011122": 51,
  "01011221": 52,
  "00111212": 53,
  "00112121": 54,
  "01011212": 55,
  "01012121": 56,
  "01010000": 57,
};

function ollNumber(key: string): number {
  if (key === "00000000") return 0;
  const number = OLL_NUMBERS[key];
  if (number === undefined) throw new Error(`No OLL number for ${key}`);
  return number;
}

function ollGroup(state: LastLayer): OllGroup {
  const flipped = state.eo.filter((v) => v === 1).length;
  const twisted = state.co.filter((v) => v !== 0).length;
  if (flipped === 0) return twisted === 0 ? "skip" : "cross";
  if (twisted === 0) return "corners";
  if (flipped === 4) return "dot";
  const [a, b] = [0, 1, 2, 3].filter((e) => state.eo[e] === 1) as [
    number,
    number,
  ];
  return b - a === 2 ? "line" : "L";
}

let catalogue: { oll: LastLayerCase[]; pll: LastLayerCase[] } | undefined;

/** Every OLL case (58 with the skip) and PLL case (22 with the skip). */
export function lastLayerCases(): {
  oll: LastLayerCase[];
  pll: LastLayerCase[];
} {
  if (catalogue) return catalogue;
  const oll = new Map<string, LastLayer>();
  const pll = new Map<string, LastLayer>();
  for (const state of allLastLayers()) {
    const o = ollKey(state);
    if (!oll.has(o))
      oll.set(o, { ...state, ep: [0, 1, 2, 3], cp: [0, 1, 2, 3] });
    if (isOriented(state)) {
      const p = pllKey(state);
      if (!pll.has(p)) pll.set(p, state);
    }
  }
  const orders = new Map<string, number>();
  const ollCases = [...oll.entries()]
    .sort(([a], [b]) => ollNumber(a) - ollNumber(b))
    .map(([key, member]): LastLayerCase => {
      // The member shown turned to the class key, so its diagram is the same each time.
      const state = orientedAs(member, key);
      const group = ollGroup(state);
      const order = (orders.get(group) ?? 0) + 1;
      orders.set(group, order);
      const number = ollNumber(key);
      return {
        id: `oll-${key}`,
        kind: "oll",
        label: number === 0 ? "OLL skip" : `OLL ${number}`,
        group,
        order,
        state,
        stickers: stickersOf(state),
      };
    });
  let pllOrder = 0;
  const pllCases = [...pll.entries()]
    .map(([key, member]) => ({ key, member, name: pllName(member) }))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map(
      ({ key, member, name }): LastLayerCase => ({
        id: `pll-${key}`,
        kind: "pll",
        label: name === "skip" ? "PLL skip" : name,
        group: "pll",
        order: ++pllOrder,
        state: member,
        stickers: stickersOf(member),
      }),
    );
  catalogue = { oll: ollCases, pll: pllCases };
  return catalogue;
}

function orientedAs(member: LastLayer, key: string): LastLayer {
  let turned = member;
  for (let b = 0; b < 4; b++) {
    if (`${turned.eo.join("")}${turned.co.join("")}` === key) return turned;
    turned = turnAfter(turned);
  }
  throw new Error(`No turn of the member gives ${key}`);
}

export function caseById(id: string): LastLayerCase | undefined {
  const { oll, pll } = lastLayerCases();
  return (id.startsWith("oll-") ? oll : pll).find((c) => c.id === id);
}

/** Reads a top layer from a pattern whose first two layers are solved. */
export function lastLayerOf(pattern: KPattern): LastLayer {
  const { EDGES: edges, CORNERS: corners } = pattern.patternData;
  if (!edges || !corners) throw new Error("No edge or corner orbit");
  for (let place = 4; place < 12; place++)
    if (edges.pieces[place] !== place || edges.orientation[place] !== 0)
      throw new RangeError("The first two layers are not solved");
  for (let place = 4; place < 8; place++)
    if (corners.pieces[place] !== place || corners.orientation[place] !== 0)
      throw new RangeError("The first two layers are not solved");
  return {
    ep: [...edges.pieces.slice(0, 4)],
    eo: [...edges.orientation.slice(0, 4)],
    cp: [...corners.pieces.slice(0, 4)],
    co: [...corners.orientation.slice(0, 4)],
  };
}

/** The OLL, PLL (only when oriented) and full LL classes of a pattern. */
export function classifyLL(pattern: KPattern): {
  oll: string;
  pll: string | null;
  coll: string | null;
  ll: string;
} {
  const state = lastLayerOf(pattern);
  return {
    oll: `oll-${ollKey(state)}`,
    pll: isOriented(state) ? `pll-${pllKey(state)}` : null,
    coll: isCollState(state) ? `coll-${collKey(state)}` : null,
    ll: `ll-${fullKey(state)}`,
  };
}

const randomPermutation = (rng: () => number) => {
  const p = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j] as number, p[i] as number];
  }
  return p;
};

/**
 * A random member of a case: an OLL case keeps its orientation (turned with U) and takes
 * any permutation; a PLL case keeps its orientation solved; a full LL case is the
 * class's member before and after random U turns.
 */
export function memberOf(id: string, rng: () => number): LastLayer {
  const turn = (state: LastLayer) => {
    const variants = aufVariants(state);
    return variants[Math.floor(rng() * variants.length)] as LastLayer;
  };
  if (id.startsWith("ll-")) {
    const key = id.slice(3);
    if (!/^\d{16}$/.test(key)) throw new RangeError(`Unknown case ${id}`);
    const state = fromKey(key);
    const legal =
      [state.ep, state.cp].every(
        (p) => new Set(p).size === 4 && p.every((v) => v < 4),
      ) &&
      parityOf(state.ep) === parityOf(state.cp) &&
      state.eo.every((v) => v < 2) &&
      state.co.every((v) => v < 3) &&
      state.eo.reduce((a, b) => a + b, 0) % 2 === 0 &&
      state.co.reduce((a, b) => a + b, 0) % 3 === 0;
    if (!legal || fullKey(state) !== key)
      throw new RangeError(`Unknown case ${id}`);
    return turn(state);
  }
  if (id.startsWith("coll-")) {
    // The corners as the key has them, the edges oriented in any order of the same parity.
    const key = id.slice(5);
    if (!/^[0-3]{8}$/.test(key)) throw new RangeError(`Unknown case ${id}`);
    const cp = [...key.slice(0, 4)].map(Number);
    const co = [...key.slice(4)].map(Number);
    const corners = { ep: [0, 1, 2, 3], eo: [0, 0, 0, 0], cp, co };
    if (
      new Set(cp).size !== 4 ||
      co.reduce((a, b) => a + b, 0) % 3 !== 0 ||
      !isCollState(corners) ||
      collKey(corners) !== key
    )
      throw new RangeError(`Unknown case ${id}`);
    const ep = randomPermutation(rng);
    if (parityOf(ep) !== parityOf(cp))
      [ep[0], ep[1]] = [ep[1] as number, ep[0] as number];
    return turn({ ...corners, ep });
  }
  const found = caseById(id);
  if (!found) throw new RangeError(`Unknown case ${id}`);
  if (found.kind === "pll") return turn(found.state);
  const ep = randomPermutation(rng);
  const cp = randomPermutation(rng);
  if (parityOf(ep) !== parityOf(cp))
    [cp[0], cp[1]] = [cp[1] as number, cp[0] as number];
  return turn({ ep, eo: found.state.eo, cp, co: found.state.co });
}

/** The full LL classes that belong to one OLL case, for choosing among them. */
export function llCasesOf(ollId: string): string[] {
  const ids = new Set<string>();
  for (const state of allLastLayers())
    if (`oll-${ollKey(state)}` === ollId) ids.add(`ll-${fullKey(state)}`);
  return [...ids].sort();
}
