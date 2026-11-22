import { type Sq1Layer, STICKER_COLOURS, square1Layers } from "@cubehaus/cube";
import {
  bounds,
  type Colour,
  type Outline,
  type Point,
  polygonMesh,
} from "./geometry";
import type { TileDrawing } from "./picture";

type PieceSticker = Outline & { colour: Colour };
const unit = 81.091508; // Radius unit measured from direction E's Square-1.
const band = 0.26;
const reach = unit * (Math.SQRT2 + band);
const middleWidth = 312;
const middleHeight = 24;
const layerGap = 0.5 * unit;
const layerOffset = reach * 2 + layerGap;
const middleTop = reach + unit * 0.35;
const limit = reach + unit * 0.08;
const halfSlot = Math.PI / 12;

function sideBand(a: Point, b: Point, centreX: number): Point[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  const sign = Math.sign(-dy * (a[0] - centreX) + dx * a[1]);
  const x = -dy * sign * ((band * unit) / length);
  const y = dx * sign * ((band * unit) / length);
  return [a, b, [b[0] + x, b[1] + y], [a[0] + x, a[1] + y]];
}

function sticker(
  id: string,
  points: Point[],
  token: string | undefined,
): PieceSticker {
  const colour = STICKER_COLOURS.find((colour) => colour === token);
  if (!colour) throw new Error(`Missing Square-1 colour at ${id}`);
  return { id, points, colour };
}

function layerStickers(layer: Sq1Layer, bottom: boolean): PieceSticker[] {
  const cx = bottom ? layerOffset : 0;
  // In the solved net, slot 0 points down-left and slot 12 points up.
  const origin = bottom ? -Math.PI / 2 : (2 * Math.PI) / 3;
  const at = (angle: number, length: number): Point => [
    cx + Math.cos(angle) * length * unit,
    Math.sin(angle) * length * unit,
  ];
  const edgeRadius = 1 / Math.cos(halfSlot);
  return layer.flatMap(({ kind, slots, top, sides }) => {
    const first = slots[0] as number;
    const angle = origin + (first % 12) * 2 * halfSlot;
    const start = at(angle - halfSlot, edgeRadius);
    const corner = kind === "corner";
    const end = at(angle + (corner ? 3 : 1) * halfSlot, edgeRadius);
    const perimeter = corner
      ? [start, at(angle + halfSlot, Math.SQRT2), end]
      : [start, end];
    return [
      sticker(`top-${first}`, [[cx, 0], ...perimeter], top),
      ...slots.map((slot, i) =>
        sticker(
          `side-${slot}`,
          sideBand(perimeter[i] as Point, perimeter[i + 1] as Point, cx),
          sides[i],
        ),
      ),
    ];
  });
}

function middleStickers(flipped: boolean): PieceSticker[] {
  const left = (layerOffset - middleWidth) / 2;
  const firstHalf = ["L", "L", "B", "B", "B", "R"];
  const secondHalf = ["R", "R", "F", "F", "F", "L"];
  const colours = [
    ...firstHalf,
    ...(flipped ? secondHalf.reverse() : secondHalf),
  ];
  return colours.map((colour, i) => {
    // The flat middle strip has a one-sticker gap between its six-sticker halves.
    const x = left + (i + Number(i >= firstHalf.length)) * middleHeight;
    const right = x + middleHeight;
    const bottom = middleTop + middleHeight;
    return sticker(
      `middle-${i}`,
      [
        [x, middleTop],
        [right, middleTop],
        [right, bottom],
        [x, bottom],
      ],
      colour,
    );
  });
}

const viewBox = bounds(
  [
    [-limit, -limit],
    [layerOffset + limit, middleTop + middleHeight],
  ],
  (layerOffset + 2 * limit) * 0.012,
);

export async function squareDrawing(alg: string): Promise<TileDrawing> {
  const { top, bottom, middleFlipped } = await square1Layers(alg);
  const pieces = [
    ...middleStickers(middleFlipped),
    ...layerStickers(top, false),
    ...layerStickers(bottom, true),
  ];
  const { body, tiles } = polygonMesh(pieces, viewBox);
  const colours = new Map(pieces.map(({ id, colour }) => [id, colour]));
  return {
    viewBox,
    body,
    stickers: tiles.map((tile) => ({
      ...tile,
      colour: colours.get(tile.id) as Colour,
    })),
  };
}
