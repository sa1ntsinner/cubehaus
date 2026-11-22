import { puzzles } from "cubing/puzzles";

type Pin = "UL" | "UR" | "DL" | "DR";

/** Dial hours in reading order on each face, plus any explicitly named front pins. */
export async function clockDials(alg: string): Promise<{
  front: number[];
  back: number[];
  pins: null | Record<Pin, boolean>;
}> {
  let pins: Record<Pin, boolean> | null = null;
  const suffix = /(?:^|\s)((?:[UD][LR]\s+)*[UD][LR])\s*$/.exec(alg);
  if (suffix?.[1]) {
    pins = { UL: false, UR: false, DL: false, DR: false };
    for (const pin of suffix[1].split(/\s+/)) pins[pin as Pin] = true;
    alg = alg.slice(0, suffix.index);
  }

  const kpuzzle = await puzzles.clock?.kpuzzle();
  const hours = kpuzzle?.defaultPattern().applyAlg(alg).patternData
    .DIALS?.orientation;
  if (!hours) throw new Error("Missing Clock DIALS orbit");
  return { front: hours.slice(0, 9), back: hours.slice(9), pins };
}
