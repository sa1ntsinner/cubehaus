import { puzzles } from "cubing/puzzles";

export type Sq1Wedge = { edge: boolean; top: string; side: string };
export type Sq1Layer = Array<{
  kind: "edge" | "corner";
  slots: number[];
  top: string;
  sides: string[];
}>;

type SolvedWedge = Sq1Wedge & { partner: number | null };

// The sides of each solved piece, in cubing.js WEDGES index order.
// The top of its SVG is yellow and the bottom is white.
const solved: SolvedWedge[] = [];
for (const [top, pieces] of [
  ["D", ["RB", "B", "BL", "L", "LF", "F", "FR", "R"]],
  ["U", ["R", "RF", "F", "FL", "L", "LB", "B", "BR"]],
] as const) {
  for (const piece of pieces) {
    const first = solved.length;
    const edge = piece.length === 1;
    for (const [i, side] of [...piece].entries()) {
      solved.push({ edge, top, side, partner: edge ? null : first + 1 - i });
    }
  }
}

// Start at the solved first corner on both layers. A corner crossing the
// reading origin follows the last piece, with its sides in cyclic slot order.
function layerPieces(wedges: number[], first: number, start: number): Sq1Layer {
  const slotAt = (i: number) => first + ((i + 12) % 12);
  const result: Sq1Layer = [];
  for (let i = start; i < start + 12; i++) {
    const slot = slotAt(i);
    const wedge = solved[wedges[slot] as number] as SolvedWedge;
    if (wedge.partner === null) {
      result.push({
        kind: "edge",
        slots: [slot],
        top: wedge.top,
        sides: [wedge.side],
      });
      continue;
    }
    const next = slotAt(i + 1);
    if (wedges[next] === wedge.partner) {
      const partner = solved[wedge.partner] as SolvedWedge;
      result.push({
        kind: "corner",
        slots: [slot, next],
        top: wedge.top,
        sides: [wedge.side, partner.side],
      });
    } else if (wedges[slotAt(i - 1)] !== wedge.partner) {
      throw new RangeError("Square-1 algorithm leaves a split corner");
    }
  }
  return result;
}

/** Square-1 pieces with absolute KPuzzle slot indices and sides aligned to slots. */
export async function square1Layers(alg: string): Promise<{
  top: Sq1Layer;
  bottom: Sq1Layer;
  middleFlipped: boolean;
}> {
  const kpuzzle = await puzzles.square1?.kpuzzle();
  const data = kpuzzle?.defaultPattern().applyAlg(alg).patternData;
  if (!data?.WEDGES || !data.EQUATOR) {
    throw new Error("Missing Square-1 KPuzzle orbits");
  }
  return {
    top: layerPieces(data.WEDGES.pieces, 0, 0),
    bottom: layerPieces(data.WEDGES.pieces, 12, 1),
    middleFlipped: data.EQUATOR.orientation[1] === 3,
  };
}
