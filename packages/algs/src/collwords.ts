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
    opposite: "два противоположных цвета",
    neighbours: "два соседних цвета",
  },
} as const;

export function collWords(
  group: keyof typeof SHAPE.en,
  picture: string,
): { en: string; ru: string } {
  const pairs = cornerPairs(picture);
  const say = (lang: "en" | "ru") => {
    const parts = SIDES.filter((s) => pairs[s]).map(
      (s) => `${PAIRING[lang][pairs[s] as Pairing]} ${WHERE[lang][s]}`,
    );
    const shape = SHAPE[lang][group];
    return parts.length === 0 ? `${shape}.` : `${shape}: ${parts.join(", ")}.`;
  };
  return { en: say("en"), ru: say("ru") };
}
