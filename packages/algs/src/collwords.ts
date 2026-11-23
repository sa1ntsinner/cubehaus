import { type Side, sideOf } from "./diagram";

/**
 * How a COLL case is recognised, read from its picture: the corner shape, then each side
 * whose two corners both show a side colour, as headlights (one colour), two opposite
 * colours or two neighbouring colours. The edges' side stickers say nothing in COLL and
 * are not read. Words are made from the picture, so they cannot disagree with it.
 */
const SIDES: readonly Side[] = ["F", "R", "B", "L"];
const OPPOSITE: Record<string, string> = { F: "B", B: "F", R: "L", L: "R" };
export type Pairing = "lights" | "opposite" | "neighbours";

export function cornerPairs(picture: string): Partial<Record<Side, Pairing>> {
  const out: Partial<Record<Side, Pairing>> = {};
  for (const side of SIDES) {
    const [a, , c] = sideOf(picture, side);
    if (a === "U" || c === "U") continue;
    out[side] =
      a === c ? "lights" : OPPOSITE[a] === c ? "opposite" : "neighbours";
  }
  return out;
}

const SHAPE = {
  en: {
    H: "H shape",
    Pi: "Pi shape",
    U: "U shape",
    T: "T shape",
    L: "L shape",
    S: "Sune shape",
    AS: "Antisune shape",
  },
  ru: {
    H: "Форма H",
    Pi: "Форма Пи",
    U: "Форма U",
    T: "Форма T",
    L: "Форма L",
    S: "Форма Суне",
    AS: "Форма Антисуне",
  },
} as const;
const WHERE = {
  en: { F: "in front", R: "on the right", B: "at the back", L: "on the left" },
  ru: { F: "спереди", R: "справа", B: "сзади", L: "слева" },
} as const;
const PAIRING = {
  en: {
    lights: "headlights",
    opposite: "two opposite colours",
    neighbours: "two neighbouring colours",
  },
  ru: {
    lights: "фары",
    opposite: "противоположные цвета",
    neighbours: "соседние цвета",
  },
} as const;
const ORDER: readonly Pairing[] = ["lights", "opposite", "neighbours"];
/** Places joined as Russian lists them: «спереди и сзади», «спереди, справа и слева». */
const andRu = (items: readonly string[]) =>
  items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} и ${items.at(-1)}`;

/**
 * The corners' side stickers, by their place in the picture: which corner and which side.
 * Two of them showing one colour is something a person can check on the cube.
 */
const STICKERS: readonly [number, Corner, Side][] = [
  [9, "FL", "F"],
  [11, "FR", "F"],
  [12, "FR", "R"],
  [14, "BR", "R"],
  [15, "BR", "B"],
  [17, "BL", "B"],
  [18, "BL", "L"],
  [20, "FL", "L"],
];
export type Corner = "FL" | "FR" | "BR" | "BL";
const CORNER = {
  en: {
    FL: "front left",
    FR: "front right",
    BR: "back right",
    BL: "back left",
  },
  ru: {
    FL: "переднего левого",
    FR: "переднего правого",
    BR: "заднего правого",
    BL: "заднего левого",
  },
} as const;
const FACE = {
  en: { F: "front", R: "right", B: "back", L: "left" },
  ru: { F: "спереди", R: "справа", B: "сзади", L: "слева" },
} as const;

/**
 * Two corner stickers on different sides that show one colour on this picture and not on
 * any of `others` (cases of the same shape the rest of the words cannot tell apart), as
 * places in the picture; null when there is none.
 */
export function sameColour(
  picture: string,
  others: readonly string[],
): [number, number] | null {
  for (const [i, , sideA] of STICKERS)
    for (const [j, , sideB] of STICKERS) {
      if (j <= i || sideA === sideB) continue;
      const colour = picture[i];
      if (colour === "U" || colour !== picture[j]) continue;
      if (others.every((o) => o[i] !== o[j])) return [i, j];
    }
  return null;
}

export function collWords(
  group: keyof typeof SHAPE.en,
  picture: string,
  /** Cases of the same shape whose other words read the same. */
  twins: readonly string[] = [],
): { en: string; ru: string } | null {
  const pairs = cornerPairs(picture);
  const apart = twins.length > 0 ? sameColour(picture, twins) : null;
  if (twins.length > 0 && !apart) return null;
  const sticker = (at: number) =>
    STICKERS.find(([i]) => i === at) as [number, Corner, Side];
  const say = (lang: "en" | "ru") => {
    const sides = SIDES.filter((s) => pairs[s]);
    // Russian says each kind once, with its sides: «соседние цвета справа и слева».
    const parts =
      lang === "en"
        ? sides.map((s) => `${PAIRING.en[pairs[s] as Pairing]} ${WHERE.en[s]}`)
        : ORDER.flatMap((kind) => {
            const at = sides.filter((s) => pairs[s] === kind);
            return at.length
              ? [`${PAIRING.ru[kind]} ${andRu(at.map((s) => WHERE.ru[s]))}`]
              : [];
          });
    const shape = SHAPE[lang][group];
    const base = parts.length === 0 ? shape : `${shape}: ${parts.join(", ")}`;
    if (!apart) return `${base}.`;
    const [, cornerA, faceA] = sticker(apart[0]);
    const [, cornerB, faceB] = sticker(apart[1]);
    return lang === "en"
      ? `${base}; the ${CORNER.en[cornerA]} corner's ${FACE.en[faceA]} sticker matches the ${CORNER.en[cornerB]} corner's ${FACE.en[faceB]} one.`
      : `${base}; ${stickerPairRu([cornerA, faceA], [cornerB, faceB], "same")}.`;
  };
  return { en: say("en"), ru: say("ru") };
}

/**
 * Two corner stickers on two sides in Russian, each named by its corner and the side it
 * is on, and what they share: one colour, or opposite colours. COLL and the 2×2 notes
 * say it alike: «наклейки переднего левого угла спереди и заднего правого справа одного
 * цвета».
 */
export function stickerPairRu(
  [cornerA, sideA]: readonly [Corner, Side],
  [cornerB, sideB]: readonly [Corner, Side],
  kind: "same" | "opposite",
): string {
  const both = `наклейки ${CORNER.ru[cornerA]} угла ${FACE.ru[sideA]} и ${CORNER.ru[cornerB]} ${FACE.ru[sideB]}`;
  return `${both} ${kind === "same" ? "одного цвета" : "противоположных цветов"}`;
}
