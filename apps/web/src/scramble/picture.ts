import type { EventId } from "@cubehaus/core";
import { cubeState, type Face } from "@cubehaus/cube";
import {
  type Body,
  rounded,
  type Sticker,
  sweepDelay,
  type Tile,
  type ViewBox,
} from "./geometry";

export function pictureSupport(event: EventId): "flat" | "none" {
  return event === "333mbf" ? "none" : "flat";
}

export function moveRows(scramble: string) {
  return scramble.split("\n").map((row) => row.match(/\S+/g) ?? []);
}

export function movesUpTo(scramble: string, n: number) {
  return moveRows(scramble)
    .flat()
    .slice(0, n + 1)
    .join(" ");
}

export function placeZoom(
  vw: number,
  vh: number,
  aspect: number,
  scrambleBottom: number,
) {
  const margin = Math.min(48, 0.06 * vh);
  let height = Math.max(
    0,
    Math.min(vh - 2 * margin, (vw - 2 * margin) / aspect),
  );
  let top = (vh - height) / 2;
  const clear = scrambleBottom + 24;
  if (top < clear) {
    top = clear;
    height = Math.max(0, Math.min(height, vh - margin - clear));
  }
  const width = height * aspect;
  return { left: (vw - width) / 2, top, width, height };
}

export const cubeSizes: Partial<Record<EventId, number>> = {
  "222": 2,
  "333": 3,
  "333bf": 3,
  "333fm": 3,
  "333oh": 3,
  "444": 4,
  "444bf": 4,
  "555": 5,
  "555bf": 5,
  "666": 6,
  "777": 7,
};
const slots = [
  ["U", 1, 0],
  ["L", 0, 1],
  ["F", 1, 1],
  ["R", 2, 1],
  ["B", 3, 1],
  ["D", 1, 2],
] as const;

export type TileDrawing = { viewBox: ViewBox; body: Body; stickers: Sticker[] };

const faceSize = 100;
const gap = 8;
const pad = 3;
const netBox: ViewBox = [
  0,
  0,
  4 * faceSize + 3 * gap + 2 * pad,
  3 * faceSize + 2 * gap + 2 * pad,
];

function squarePath(
  x: number,
  y: number,
  size: number,
  radii: readonly number[],
) {
  const [tl = 0, tr = 0, br = 0, bl = 0] = radii.map(rounded);
  const left = rounded(x);
  const top = rounded(y);
  const right = rounded(x + size);
  const bottom = rounded(y + size);
  return (
    `M${rounded(x + tl)} ${top}` +
    `H${rounded(x + size - tr)}A${tr} ${tr} 0 0 1 ${right} ${rounded(y + tr)}` +
    `V${rounded(y + size - br)}A${br} ${br} 0 0 1 ${rounded(x + size - br)} ${bottom}` +
    `H${rounded(x + bl)}A${bl} ${bl} 0 0 1 ${left} ${rounded(y + size - bl)}` +
    `V${rounded(y + tl)}A${tl} ${tl} 0 0 1 ${rounded(x + tl)} ${top}Z`
  );
}

function buildNet(size: number) {
  const pitch = faceSize / size;
  const seam = Math.max(1.8, pitch * 0.065);
  const tileSize = pitch - seam;
  const inner = Math.max(1, pitch * 0.15);
  const outer = Math.min(13, tileSize * 0.36);
  const last = size - 1;
  return slots.map(([face, col, row]) => {
    const x = pad + col * (faceSize + gap);
    const y = pad + row * (faceSize + gap);
    const tiles = Array.from({ length: size * size }, (_, index): Tile => {
      const col = index % size;
      const row = Math.floor(index / size);
      const left = x + col * pitch;
      const top = y + row * pitch;
      const radii = [
        row === 0 && col === 0 ? outer : inner,
        row === 0 && col === last ? outer : inner,
        row === last && col === last ? outer : inner,
        row === last && col === 0 ? outer : inner,
      ];
      return {
        id: `${face}-${index}`,
        path: squarePath(left + seam / 2, top + seam / 2, tileSize, radii),
        delay: sweepDelay([left + pitch / 2, top + pitch / 2], netBox),
      };
    });
    return {
      face,
      tiles,
      body: squarePath(
        x - seam / 2,
        y - seam / 2,
        faceSize + seam,
        Array<number>(4).fill(outer + seam / 2),
      ),
    };
  });
}

const nets = new Map<number, ReturnType<typeof buildNet>>();

export function cubeDrawing(size: number, alg: string): TileDrawing {
  const state = cubeState(size, alg);
  let net = nets.get(size);
  if (!net) {
    net = buildNet(size);
    nets.set(size, net);
  }
  return {
    viewBox: netBox,
    body: net.map(({ body }) => body).join(""),
    stickers: net.flatMap(({ face, tiles }) =>
      tiles.map((tile, index) => ({
        ...tile,
        colour: state[face][index] as Face,
      })),
    ),
  };
}
