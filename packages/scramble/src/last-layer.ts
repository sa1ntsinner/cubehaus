/**
 * The last layer of a 3×3 with the first two layers solved: four U edges and four U
 * corners, in cubing's places (edges UF UR UB UL, corners UFR URB UBL ULF). `ep[i]` is
 * the piece on place i, `eo[i]` its flip, `cp` and `co` likewise for corners. Legal
 * states keep the flips even, the twists whole and both permutations of one parity:
 * 24 · 24 / 2 · 8 · 27 = 62208 states.
 *
 * Cases are classes of states that one algorithm solves after turning U before and
 * after it (AUF): OLL looks at orientation alone, turned with U (58 classes with the
 * skip); PLL at permutation alone, with a U turn on either side (22 with the skip); the
 * full LL at both, likewise.
 */
export type LastLayer = {
  ep: readonly number[];
  eo: readonly number[];
  cp: readonly number[];
  co: readonly number[];
};

/**
 * U as cubing turns the last layer (read from its 3×3 definition, which gives both
 * orbits the same cycle and no twist or flip): place i takes the piece from U_FROM[i].
 */
const U_EDGE_FROM: readonly number[] = [1, 2, 3, 0];
const U_CORNER_FROM: readonly number[] = [1, 2, 3, 0];

/** `state` then U, as a pattern after another turn. */
export function turnAfter(state: LastLayer): LastLayer {
  return {
    ep: U_EDGE_FROM.map((from) => state.ep[from] as number),
    eo: U_EDGE_FROM.map((from) => state.eo[from] as number),
    cp: U_CORNER_FROM.map((from) => state.cp[from] as number),
    co: U_CORNER_FROM.map((from) => state.co[from] as number),
  };
}

/** U then `state`: the pieces are renamed by U's permutation, the places keep theirs. */
export function turnBefore(state: LastLayer): LastLayer {
  return {
    ep: state.ep.map((piece) => U_EDGE_FROM[piece] as number),
    eo: state.eo,
    cp: state.cp.map((piece) => U_CORNER_FROM[piece] as number),
    co: state.co,
  };
}

const PERMUTATIONS: readonly (readonly number[])[] = (() => {
  const all: number[][] = [];
  const build = (prefix: number[]) => {
    if (prefix.length === 4) all.push(prefix);
    else
      for (let p = 0; p < 4; p++)
        if (!prefix.includes(p)) build([...prefix, p]);
  };
  build([]);
  return all;
})();

export function parityOf(p: readonly number[]): number {
  let odd = 0;
  for (let i = 0; i < p.length; i++)
    for (let j = i + 1; j < p.length; j++)
      if ((p[i] as number) > (p[j] as number)) odd ^= 1;
  return odd;
}

const digits = (values: readonly number[]) => values.join("");
/** A state as a string of 16 digits: ep, eo, cp, co. */
export const llKey = (s: LastLayer) =>
  `${digits(s.ep)}${digits(s.eo)}${digits(s.cp)}${digits(s.co)}`;
export function fromKey(key: string): LastLayer {
  const at = (from: number) => [...key.slice(from, from + 4)].map(Number);
  return { ep: at(0), eo: at(4), cp: at(8), co: at(12) };
}

/** Every legal last-layer state. */
export function allLastLayers(): LastLayer[] {
  const states: LastLayer[] = [];
  const flips = [...Array(16).keys()]
    .map((bits) => [3, 2, 1, 0].map((shift) => (bits >> shift) & 1))
    .filter((eo) => eo.reduce((a, b) => a + b, 0) % 2 === 0);
  const twists = [...Array(81).keys()]
    .map((n) => [27, 9, 3, 1].map((unit) => Math.floor(n / unit) % 3))
    .filter((co) => co.reduce((a, b) => a + b, 0) % 3 === 0);
  for (const ep of PERMUTATIONS)
    for (const cp of PERMUTATIONS) {
      if (parityOf(ep) !== parityOf(cp)) continue;
      for (const eo of flips)
        for (const co of twists) states.push({ ep, eo, cp, co });
    }
  return states;
}

/** The 16 states one U turn before and after can make of `state`. */
export function aufVariants(state: LastLayer): LastLayer[] {
  const variants: LastLayer[] = [];
  let before = state;
  for (let a = 0; a < 4; a++) {
    let both = before;
    for (let b = 0; b < 4; b++) {
      variants.push(both);
      both = turnAfter(both);
    }
    before = turnBefore(before);
  }
  return variants;
}

const SOLVED: LastLayer = {
  ep: [0, 1, 2, 3],
  eo: [0, 0, 0, 0],
  cp: [0, 1, 2, 3],
  co: [0, 0, 0, 0],
};

/** The orientation pattern turned to its least form: OLL's class key. */
export function ollKey(state: LastLayer): string {
  let best = "";
  let turned = state;
  for (let b = 0; b < 4; b++) {
    const key = `${digits(turned.eo)}${digits(turned.co)}`;
    if (best === "" || key < best) best = key;
    turned = turnAfter(turned);
  }
  return best;
}

/** The permutation in its least form over the 16 AUF pairs: PLL's class key. */
export function pllKey(state: LastLayer): string {
  let best = "";
  for (const v of aufVariants({ ...state, eo: SOLVED.eo, co: SOLVED.co })) {
    const key = `${digits(v.ep)}${digits(v.cp)}`;
    if (best === "" || key < best) best = key;
  }
  return best;
}

/** The whole state in its least form over the 16 AUF pairs: a full LL class key. */
export function fullKey(state: LastLayer): string {
  let best = "";
  for (const v of aufVariants(state)) {
    const key = llKey(v);
    if (best === "" || key < best) best = key;
  }
  return best;
}

export const solvedLastLayer = (): LastLayer => SOLVED;
export const isOriented = (s: LastLayer) =>
  s.eo.every((v) => v === 0) && s.co.every((v) => v === 0);

/** The places a permutation moves. */
const moved = (p: readonly number[]) =>
  [...p.keys()].filter((place) => p[place] !== place);

/**
 * Which way a three-cycle turns, seen from above: in cubing's order the places run
 * F, R, B, L, so one step up the index is a quarter anticlockwise. 1: anticlockwise.
 */
function turnOf(p: readonly number[]): 1 | -1 {
  const [fixed] = [0, 1, 2, 3].filter((place) => p[place] === place);
  const ring = [1, 2, 3].map((step) => ((fixed as number) + step) % 4);
  const place = moved(p)[0] as number;
  const from = ring.indexOf(p[place] as number);
  return (ring.indexOf(place) - from + 3) % 3 === 1 ? 1 : -1;
}

type PllShape = { cp: readonly number[]; ep: readonly number[] };

/** The AUF variants that leave the most pieces in place, as permutations. */
export function plainest(state: LastLayer): PllShape[] {
  const variants = aufVariants({ ...state, eo: SOLVED.eo, co: SOLVED.co });
  const still = (v: LastLayer) => 8 - moved(v.cp).length - moved(v.ep).length;
  const most = Math.max(...variants.map(still));
  return variants.filter((v) => still(v) === most);
}

/**
 * A PLL case's conventional name, read from what it does to the pieces in its plainest
 * form (most pieces in place). Corner c sits between edges c and c + 1.
 */
export function pllName(state: LastLayer): string {
  const [shape] = plainest(state).sort(
    (x, y) => moved(x.cp).length - moved(y.cp).length,
  ) as [PllShape];
  const { cp, ep } = shape;
  const mc = moved(cp);
  const me = moved(ep);
  const has = (list: readonly number[], ...places: number[]) =>
    places.every((place) => list.includes(place % 4));
  if (mc.length === 0 && me.length === 0) return "skip";
  if (mc.length === 0) {
    if (me.length === 3) return turnOf(ep) === -1 ? "Ua" : "Ub";
    return ep[0] === 2 ? "H" : "Z";
  }
  if (me.length === 0) {
    if (mc.length === 3) return turnOf(cp) === 1 ? "Aa" : "Ab";
    return "E";
  }
  if (mc.length === 2 && me.length === 2) {
    const [a, b] = mc as [number, number];
    if ((b - a) % 2 === 1) {
      // Two neighbouring corners swap; s is the edge between them, o the one across.
      const s = b - a === 1 ? b : 0;
      const o = s + 2;
      if (has(me, s, o)) return "T";
      if (has(me, s + 1, s + 3)) return "F";
      if (me.includes(s)) return has(me, s + 1) ? "Ja" : "Jb";
      return has(me, s + 1) ? "Ra" : "Rb";
    }
    // Two corners across the diagonal swap.
    if ((me[1] as number) - (me[0] as number) === 2)
      return me[0] === a % 2 ? "Na" : "Nb";
    // Two neighbouring edges meet at corner k: k swapped gives Y, otherwise V.
    const [x, y] = me as [number, number];
    const k = y - x === 1 ? x : 3;
    return mc.includes(k) ? "Y" : "V";
  }
  // A corner three-cycle with an edge three-cycle: the four G cases. Turned so the
  // corners go anticlockwise (the edges then go clockwise), they differ in where the
  // edge left in place stands from the corner left in place: on its first edge (Ga),
  // its second (Gd), across (Gb) or on the edge before it (Gc).
  for (const v of aufVariants({ ...state, eo: SOLVED.eo, co: SOLVED.co })) {
    if (moved(v.cp).length !== 3 || moved(v.ep).length !== 3) continue;
    if (turnOf(v.cp) !== 1) continue;
    const corner = [0, 1, 2, 3].find((c) => v.cp[c] === c) as number;
    const edge = [0, 1, 2, 3].find((e) => v.ep[e] === e) as number;
    return ["Ga", "Gd", "Gb", "Gc"][(edge - corner + 4) % 4] as string;
  }
  throw new Error("Not a PLL case");
}

/**
 * COLL's class key: the corners' places and twists in their least form over the 16 AUF
 * pairs, the edges left out (a COLL algorithm leaves an edge cycle). Only for states with
 * the edges oriented and the corners not all twisted right (isCollState).
 */
export function collKey(state: LastLayer): string {
  let best = "";
  for (const v of aufVariants(state)) {
    const key = `${digits(v.cp)}${digits(v.co)}`;
    if (best === "" || key < best) best = key;
  }
  return best;
}

export const isCollState = (state: LastLayer) =>
  state.eo.every((v) => v === 0) && state.co.some((v) => v !== 0);
