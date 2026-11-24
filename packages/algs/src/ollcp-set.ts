import { stickersOf } from "@cubehaus/scramble/last-layer";
import { fromKey, turnAfter } from "@cubehaus/scramble/last-layer-state";
import { OLLCP_FILES, OLLCP_INDEX } from "./data/ollcp/index";
import type { OllcpCaseData, OllcpEntry } from "./types";

/**
 * OLLCP at run time: 331 cases, the last layer oriented and its corners placed in one
 * algorithm, grouped by the OLL case each belongs to. The set is not among the trainer's
 * sets (`SetId`, `loadTrainerSet`) until its grouped list is designed; nothing in the app
 * imports this module, so it adds nothing to the app's bundles.
 *
 * The data is cut into files of three OLL cases each. `OLLCP_INDEX` lists every case
 * without its algorithms (enough for a list and its pictures); the algorithms and drill
 * scrambles of a group are loaded when asked for.
 */
export type { OllcpCaseData, OllcpEntry };
export { OLLCP_INDEX };

export type OllcpGroup = {
  /** The OLL case, 1 to 57; 0 for the skip (nothing to orient, two corners swapped). */
  oll: number;
  /** `OLL 27`, `OLL skip`: the OLL set's own label. */
  label: string;
  cases: readonly OllcpEntry[];
};

let groups: OllcpGroup[] | undefined;

/** The 58 groups in the set's order: OLL 1 to 57, then the skip. */
export function ollcpGroups(): readonly OllcpGroup[] {
  if (groups) return groups;
  const found = new Map<number, OllcpEntry[]>();
  for (const c of OLLCP_INDEX)
    found.set(c.oll, [...(found.get(c.oll) ?? []), c]);
  groups = [...found].map(([oll, cases]) => ({
    oll,
    label: (cases[0] as OllcpEntry).group,
    cases,
  }));
  return groups;
}

/** One group's cases with their algorithms and scrambles; its file is loaded once. */
export async function loadOllcpGroup(
  oll: number,
): Promise<readonly OllcpCaseData[]> {
  const file = OLLCP_FILES.find((f) => f.olls.includes(oll));
  if (!file) throw new RangeError(`No OLLCP group ${oll}`);
  return (await file.load()).filter((c) => c.oll === oll);
}

/** Every case, in the set's order: all the files. */
export async function loadOllcp(): Promise<readonly OllcpCaseData[]> {
  return (await Promise.all(OLLCP_FILES.map((f) => f.load()))).flat();
}

/** The edge stickers of a 21-letter top picture: four on U, one in each side's row. */
const EDGES = [1, 3, 5, 7, 10, 13, 16, 19];

/**
 * A case's picture after `turns` U turns, 21 letters as the OLL pictures. The edges may
 * stand anywhere, so an edge sticker says only whether it shows the top colour (`U`) or
 * not (`x`); the corners' stickers are in colour.
 */
export function ollcpPicture(c: Pick<OllcpEntry, "state">, turns = 0): string {
  let state = fromKey(c.state);
  for (let k = ((turns % 4) + 4) % 4; k > 0; k--) state = turnAfter(state);
  return [...stickersOf(state)]
    .map((l, i) => (EDGES.includes(i) && l !== "U" ? "x" : l))
    .join("");
}
