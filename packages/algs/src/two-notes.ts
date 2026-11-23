import { facesOf, type Two } from "./two";
import type { TwoSet } from "./two-cases";

/**
 * How to recognise a 2×2 case, read from the picture as Learn shows it (two.ts), in a few
 * plain facts: where the top's colour faces (OLL, and CLL's shape), which sides show a
 * pair of one colour (CLL), and each layer's kind (PBL). two-build.test.ts proves that each
 * note fits its case's picture and no other case's from any side; a CLL case whose facts
 * do not single it out gets no note.
 */

type Words = { en: string; ru: string };

// Top places in turn round the top (each and the next share a side): URF UFL ULB UBR.
const CORNER: readonly Words[] = [
  { en: "front right", ru: "спереди справа" },
  { en: "front left", ru: "спереди слева" },
  { en: "back left", ru: "сзади слева" },
  { en: "back right", ru: "сзади справа" },
];
// The side top places k and k + 1 share.
const SHARED = ["F", "L", "B", "R"] as const;
const SIDES = ["F", "R", "B", "L"] as const;
const AT: Record<string, Words> = {
  F: { en: "front", ru: "спереди" },
  R: { en: "right", ru: "справа" },
  B: { en: "back", ru: "сзади" },
  L: { en: "left", ru: "слева" },
};
const TOWARDS: Record<string, Words> = {
  F: { en: "front", ru: "вперёд" },
  R: { en: "right", ru: "вправо" },
  B: { en: "back", ru: "назад" },
  L: { en: "left", ru: "влево" },
};
const COUNT: readonly Words[] = [
  { en: "none", ru: "ни одного" },
  { en: "one", ru: "один" },
  { en: "two", ru: "два" },
  { en: "three", ru: "три" },
];

/** Where the top's colour is on the top layer's sides, and which corners show it up. */
function topColour(s: Two) {
  const f = facesOf(s);
  const up = [0, 1, 2, 3].filter((p) => s.co[p] === 0);
  // U stickers on the top layer's side rows (the first two stickers of each side).
  const facing: Record<string, number> = { F: 0, R: 0, B: 0, L: 0 };
  for (const side of SIDES)
    facing[side] = (f[side] as string[])
      .slice(0, 2)
      .filter((c) => c === "U").length;
  return { up, facing };
}

/** The shape of the top's colour: how many corners show it up, and where the rest face. */
function shapeNote(s: Two): Words {
  const { up, facing } = topColour(s);
  let head: Words;
  if (up.length === 0) head = { en: "None up", ru: "Вверх ни одного" };
  else if (up.length === 1) {
    const at = CORNER[up[0] as number] as Words;
    head = { en: `One up, ${at.en}`, ru: `Один вверх, ${at.ru}` };
  } else if (up.length === 2) {
    const [a, b] = up as [number, number];
    if ((b - a) % 2 === 1) {
      const side = AT[SHARED[b - a === 1 ? a : b] as string] as Words;
      head = { en: `Two up, ${side.en}`, ru: `Два вверх, ${side.ru}` };
    } else {
      const ca = CORNER[a] as Words;
      const cb = CORNER[b] as Words;
      head = {
        en: `Two up, ${ca.en} and ${cb.en}`,
        ru: `Два вверх, ${ca.ru} и ${cb.ru}`,
      };
    }
  } else return { en: "All up", ru: "Все вверх" };
  const parts = SIDES.filter((side) => (facing[side] as number) > 0);
  const list = (lang: "en" | "ru") =>
    parts
      .map((side, i) => {
        const n = (COUNT[facing[side] as number] as Words)[lang];
        const to = (TOWARDS[side] as Words)[lang];
        if (lang === "en")
          return i === 0
            ? `${n} ${facing[side] === 1 ? "faces" : "face"} ${to}`
            : `${n} ${to}`;
        return i === 0
          ? `${n} ${facing[side] === 1 ? "смотрит" : "смотрят"} ${to}`
          : `${n} ${to}`;
      })
      .join(", ");
  return { en: `${head.en}; ${list("en")}`, ru: `${head.ru}; ${list("ru")}` };
}

const OPPOSITE: Record<string, string> = { F: "B", B: "F", R: "L", L: "R" };

/**
 * Sides of the top layer whose two stickers are one colour (a pair), and those whose two
 * are opposite colours (as red and orange); the top's colour on a side counts as neither.
 */
function sidePairs(s: Two): { same: string[]; opposite: string[] } {
  const f = facesOf(s);
  const two = (side: string) => (f[side] as string[]).slice(0, 2);
  return {
    same: SIDES.filter((side) => {
      const [a, b] = two(side);
      return a === b && a !== "U";
    }),
    opposite: SIDES.filter((side) => {
      const [a, b] = two(side);
      return OPPOSITE[a as string] === b;
    }),
  };
}

/** A layer's kind: the pieces in order (4 sides with a bar), one bar, or none. */
export function layerKind(s: Two, layer: "top" | "bottom"): 0 | 1 | 4 {
  const places = layer === "top" ? [0, 1, 2, 3] : [4, 5, 6, 7];
  const base = layer === "top" ? 0 : 4;
  let bars = 0;
  for (let i = 0; i < 4; i++) {
    const a = (s.cp[places[i] as number] as number) - base;
    const b = (s.cp[places[(i + 1) % 4] as number] as number) - base;
    if ((((b - a) % 4) + 4) % 4 === 1) bars++;
  }
  return bars as 0 | 1 | 4;
}

const KIND: Record<0 | 1 | 4, Words> = {
  4: { en: "whole", ru: "собран" },
  1: { en: "one bar", ru: "одна полоса" },
  0: { en: "no bar", ru: "без полос" },
};

/** The note for a case as shown (the build keeps it only where it singles the case out). */
export function twoNoteRaw(set: TwoSet, s: Two): Words {
  if (set === "two-pbl") {
    const top = KIND[layerKind(s, "top")];
    const low = KIND[layerKind(s, "bottom")];
    return {
      en: `Top: ${top.en}; bottom: ${low.en}.`,
      ru: `Верх: ${top.ru}; низ: ${low.ru}.`,
    };
  }
  const shape = shapeNote(s);
  if (set === "two-oll") return { en: `${shape.en}.`, ru: `${shape.ru}.` };
  const { same, opposite } = sidePairs(s);
  const at = (sides: string[], lang: "en" | "ru") =>
    sides.map((x) => (AT[x] as Words)[lang]).join(", ");
  const facts: Words[] = [];
  if (same.length > 0)
    facts.push({
      en: `a pair ${at(same, "en")}`,
      ru: `пара ${at(same, "ru")}`,
    });
  if (opposite.length > 0)
    facts.push({
      en: `opposite colours ${at(opposite, "en")}`,
      ru: `противоположные цвета ${at(opposite, "ru")}`,
    });
  if (facts.length === 0)
    facts.push({ en: "no pair at the sides", ru: "по бокам без пар" });
  const join = (lang: "en" | "ru") => facts.map((x) => x[lang]).join("; ");
  return {
    en: `${shape.en}; ${join("en")}.`,
    ru: `${shape.ru}; ${join("ru")}.`,
  };
}
