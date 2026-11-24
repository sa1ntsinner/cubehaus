import {
  type F2lSlot,
  f2lState,
  f2lTurned,
  slotMirrored,
  slotStickers,
} from "@cubehaus/scramble/f2l-state";
import { stickersOf } from "@cubehaus/scramble/last-layer";
import { fromKey, turnAfter } from "@cubehaus/scramble/last-layer-state";
import { applyTwo, twoStickers } from "./two";
import { stateFromKey } from "./two-cases";
import type { TrainerCaseData } from "./types";

/** The F2L slot a case or set id stands for, or null for a last-layer one. */
export function slotOf(id: string): F2lSlot | null {
  if (id.startsWith("f2l-back-left")) return "bl";
  if (id.startsWith("f2l-back")) return "br";
  if (id.startsWith("f2l-left")) return "fl";
  if (id.startsWith("f2l")) return "fr";
  return null;
}

/** The U places (0–8) of each top-row sticker of the 21-letter picture, F R B L. */
const ROW_PLACES = [6, 7, 8, 8, 5, 2, 2, 1, 0, 0, 3, 6];

/**
 * A last-slot case's top as the person reads it: the case is the twist of the three top
 * corners outside the pair, so those corners show where the top colour faces (`U` where it
 * is, `x` on their other stickers), the pair its colours and the centre the top colour.
 * The top edges are always oriented here and say nothing, so they are `x` too: with them
 * the top colour's cross filled every tile and 26 tiles looked alike at 60 px. 21 letters,
 * as the OLL pictures. The pair is where the slot picture shows a top place in a colour
 * that is not the top's.
 */
export function lastSlotTop(c: TrainerCaseData): string {
  const top = c.pictures?.top ?? "";
  const slot = c.pictures?.slot ?? "";
  const pair = (place: number) => !/[Ux]/.test(slot[place] ?? "U");
  return [...top]
    .map((letter, i) => {
      const place = i < 9 ? i : (ROW_PLACES[i - 9] as number);
      if (pair(place)) return letter;
      if (place === 4) return letter;
      // An edge: a U place 1, 3, 5 or 7, or the middle of a side's top row.
      const edge = i < 9 ? i % 2 === 1 : (i - 9) % 3 === 1;
      return !edge && letter === "U" ? letter : "x";
    })
    .join("");
}

/** The edge stickers of a 21-letter top picture: four on U, one in each side's row. */
const LL_EDGES = [1, 3, 5, 7, 10, 13, 16, 19];

/**
 * The case's picture after `turns` U turns (an AUF before the algorithm): 21 letters for a
 * last-layer case (last-layer-cases.ts), 27 for an F2L case (f2l-state.ts), drawn from
 * above its slot's corner. A left slot's case is drawn mirrored, where a U turn is the
 * right case's U'.
 */
export function pictureOf(c: TrainerCaseData, turns = 0): string {
  if (c.id.startsWith("two-")) {
    const n = ((turns % 4) + 4) % 4;
    // PBL and the bottom swaps show both layers' sides; the others the top layer's.
    return twoStickers(
      applyTwo(stateFromKey(c.state), ["", "U", "U2", "U'"][n] as string),
      /^two-(pbl|adj|diag)-/.test(c.id),
    );
  }
  if (c.pictures) return turnPicture(c.pictures.top, turns);
  const slot = slotOf(c.id);
  if (slot)
    return slotStickers(
      f2lTurned(f2lState(c.state), slotMirrored(slot) ? -turns : turns),
      slot,
    );
  let state = fromKey(c.state);
  const n = ((turns % 4) + 4) % 4;
  for (let k = 0; k < n; k++) state = turnAfter(state);
  const picture = stickersOf(state);
  // CMLL is the corners alone: the top edges may be anywhere, so they say nothing.
  return c.id.startsWith("cmll-")
    ? [...picture].map((l, i) => (LL_EDGES.includes(i) ? "x" : l)).join("")
    : picture;
}
/**
 * A 21-letter top picture after `turns` U turns of the cube: the U face's stickers turn a
 * quarter clockwise each time, and each side's top row moves to the side on its left as
 * seen from above (F's to L, R's to F).
 */
export function turnPicture(picture: string, turns: number): string {
  let p = picture;
  for (let k = ((turns % 4) + 4) % 4; k > 0; k--) {
    const u = [...p.slice(0, 9)];
    const turned = [6, 3, 0, 7, 4, 1, 8, 5, 2].map((i) => u[i]).join("");
    const row = (side: number) => p.slice(9 + side * 3, 12 + side * 3);
    // Sides F R B L: after U, F shows R's row, R shows B's, B shows L's, L shows F's.
    p = turned + row(1) + row(2) + row(3) + row(0);
  }
  return p;
}
