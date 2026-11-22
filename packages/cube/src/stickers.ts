import { puzzles } from "cubing/puzzles";

export const STICKER_COLOURS = Object.freeze([
  "U",
  "D",
  "F",
  "R",
  "B",
  "L",
  "purple",
  "cream",
  "sky",
  "lime",
  "pink",
  "grey",
] as const);
type Colour = (typeof STICKER_COLOURS)[number];
type StickeredPuzzle = "pyraminx" | "skewb" | "megaminx" | "fto";

const SVG_COLOURS: Readonly<Record<string, Colour>> = {
  white: "U",
  "#ffffff": "U",
  yellow: "D",
  "#f4f400": "D",
  limegreen: "F",
  "#44ee00": "F",
  "#008800": "F",
  red: "R",
  "#ff0000": "R",
  "#26f": "B",
  "#2266ff": "B",
  "#0000ff": "B",
  orange: "L",
  "#ff8000": "L",
  "#8800dd": "purple",
  "#e8d0a0": "cream",
  "#3399ff": "sky",
  "#99ff00": "lime",
  "#ff66cc": "pink",
  "#888888": "grey",
  "#aaaaaa": "grey",
};

async function loadStickers(puzzle: StickeredPuzzle) {
  const loader = puzzles[puzzle];
  if (!loader) throw new Error(`Missing KPuzzle loader for ${puzzle}`);
  const [svg, kpuzzle] = await Promise.all([loader.svg(), loader.kpuzzle()]);
  const solved = new Map<string, Colour>();
  const counts = new Map(
    kpuzzle.definition.orbits.map(({ orbitName, numOrientations }) => [
      orbitName,
      numOrientations,
    ]),
  );
  const stickers = [];
  // The pinned library's flat SVGs give each sticker a unique id and inline fill.
  for (const [, id, orbit, location, orientation, fill] of svg.matchAll(
    /id="(([A-Z0-9_]+)-l(\d+)-o(\d+))"[^>]*\bstyle="fill:\s*([^";]+);?"/g,
  )) {
    if (!id || !orbit || !fill) continue;
    const colour = SVG_COLOURS[fill.trim().toLowerCase()];
    const count = counts.get(orbit);
    if (!colour || !count)
      throw new Error(`Unknown ${puzzle} sticker ${id}: ${fill}`);
    solved.set(id, colour);
    stickers.push({
      id,
      orbit,
      location: Number(location),
      orientation: Number(orientation),
      count,
    });
  }
  return { kpuzzle, solved, stickers };
}

const stickerModels = new Map<
  StickeredPuzzle,
  ReturnType<typeof loadStickers>
>();

/** Colour tokens by cubing.js facelet id. Clock state is exposed via clockDials. */
export async function stickerColours(
  puzzle: StickeredPuzzle | "clock",
  alg: string,
): Promise<Map<string, string>> {
  const colours = new Map<string, string>();
  if (puzzle === "clock") return colours;

  let model = stickerModels.get(puzzle);
  if (!model) {
    model = loadStickers(puzzle);
    stickerModels.set(puzzle, model);
  }
  const { kpuzzle, solved, stickers } = await model;
  const { patternData } = kpuzzle.defaultPattern().applyAlg(alg);
  for (const { id, orbit, location, orientation, count } of stickers) {
    const data = patternData[orbit];
    const sourcePiece = data?.pieces[location];
    const twist = data?.orientation[location];
    if (sourcePiece === undefined || twist === undefined) {
      throw new Error(`Missing ${puzzle} pattern data for ${id}`);
    }
    const sourceOrientation = (count - twist + orientation) % count;
    const colour = solved.get(`${orbit}-l${sourcePiece}-o${sourceOrientation}`);
    if (!colour) throw new Error(`Missing ${puzzle} solved colour for ${id}`);
    colours.set(id, colour);
  }
  return colours;
}
