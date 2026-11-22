import { lastLayerCases } from "@cubehaus/scramble/last-layer";
import {
  allLastLayers,
  collKey,
  isCollState,
  type LastLayer,
  ollKey,
  parityOf,
} from "@cubehaus/scramble/last-layer-state";

/**
 * COLL: the last layer with its edges oriented (a cross on top), solved in one algorithm
 * down to the corners: afterwards every corner is in place and the edges are oriented, so
 * only an edge cycle (U, H, Z or none) is left. A case is therefore the corners' places and
 * twists, taken up to a U turn before and after the algorithm; the edges' places do not
 * count.
 *
 * Cases with the corners already twisted right are not COLL: the corners are then only
 * swapped (two neighbours or two across), which PLL handles. What is left are the seven
 * corner shapes of the cross OLL cases (21 to 27), each with its corner permutations.
 */
export { collKey, isCollState };

/** The corners of a COLL key as a state, the edges oriented and of matching parity. */
export function collState(key: string): LastLayer {
  const cp = [...key.slice(0, 4)].map(Number);
  const co = [...key.slice(4, 8)].map(Number);
  const ep = parityOf(cp) === 0 ? [0, 1, 2, 3] : [1, 0, 2, 3];
  return { ep, eo: [0, 0, 0, 0], cp, co };
}

/** The cross OLL case (by its class key) a COLL state's corners make. */
export const collShape = (state: LastLayer) =>
  ollKey({ ...state, eo: [0, 0, 0, 0] });

/** The corner shapes of the cross OLL cases, by OLL number, as cubers name them. */
const SHAPES: Readonly<Record<string, string>> = {
  "OLL 21": "H",
  "OLL 22": "Pi",
  "OLL 23": "U",
  "OLL 24": "T",
  "OLL 25": "L",
  "OLL 26": "AS",
  "OLL 27": "S",
};
const SHAPE_ORDER = ["H", "Pi", "U", "T", "L", "S", "AS"];

export type CollCase = { key: string; label: string; group: string };

let cases: CollCase[] | undefined;

/**
 * The 40 COLL cases: by shape (H, Pi, U, T, L, Sune, Antisune), then by key. The number
 * after the shape is our own order, not a convention.
 */
export function collCases(): CollCase[] {
  if (cases) return cases;
  const { oll } = lastLayerCases();
  const found = new Map<string, string>();
  for (const s of allLastLayers()) {
    if (!isCollState(s)) continue;
    const key = collKey(s);
    if (found.has(key)) continue;
    const label = oll.find((c) => c.id === `oll-${collShape(s)}`)?.label;
    const group = label ? SHAPES[label] : undefined;
    if (!group) throw new Error(`No COLL shape for ${key}`);
    found.set(key, group);
  }
  const sorted = [...found.entries()].sort(
    ([a, ga], [b, gb]) =>
      SHAPE_ORDER.indexOf(ga) - SHAPE_ORDER.indexOf(gb) || (a < b ? -1 : 1),
  );
  const counts = new Map<string, number>();
  cases = sorted.map(([key, group]) => {
    const n = (counts.get(group) ?? 0) + 1;
    counts.set(group, n);
    return { key, label: `${group} ${n}`, group };
  });
  return cases;
}
