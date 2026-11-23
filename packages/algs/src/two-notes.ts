import { facesOf, type Two, twoStickers } from "./two";

/**
 * How to recognise a 2×2 case, read from the picture as Learn shows it (two.ts), in a few
 * plain facts: where the top's colour faces (OLL, and the start of every CLL note), each
 * layer's kind (PBL), and for CLL the plainest facts about the side colours that single
 * the case out. two-build.test.ts and two-notes.test.ts prove that each note fits its
 * case's picture and no other case's from any side.
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

/** How many corners show the top's colour up, and which: the most visible fact. */
function headNote(s: Two): Words {
  const { up } = topColour(s);
  if (up.length === 0) return { en: "None up", ru: "Вверх ни одного" };
  if (up.length === 1) {
    const at = CORNER[up[0] as number] as Words;
    return { en: `One up, ${at.en}`, ru: `Один вверх, ${at.ru}` };
  }
  if (up.length === 2) {
    const [a, b] = up as [number, number];
    if ((b - a) % 2 === 1) {
      const side = AT[SHARED[b - a === 1 ? a : b] as string] as Words;
      return { en: `Two up, ${side.en}`, ru: `Два вверх, ${side.ru}` };
    }
    const ca = CORNER[a] as Words;
    const cb = CORNER[b] as Words;
    return {
      en: `Two up, ${ca.en} and ${cb.en}`,
      ru: `Два вверх, ${ca.ru} и ${cb.ru}`,
    };
  }
  return { en: "All up", ru: "Все вверх" };
}

/** Where the top's colour faces on the sides, one clause per side that shows it. */
function facingWords(
  facing: Readonly<Record<string, number>>,
  sides: readonly string[],
): Words {
  const list = (lang: "en" | "ru") =>
    sides
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
  return { en: list("en"), ru: list("ru") };
}

/** The shape of the top's colour: how many corners show it up, and where the rest face. */
function shapeNote(s: Two): Words {
  const head = headNote(s);
  if (head.en === "All up") return head;
  const { facing } = topColour(s);
  const parts = SIDES.filter((side) => (facing[side] as number) > 0);
  const where = facingWords(facing, parts);
  return { en: `${head.en}; ${where.en}`, ru: `${head.ru}; ${where.ru}` };
}

const OPPOSITE: Record<string, string> = { F: "B", B: "F", R: "L", L: "R" };

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

/**
 * The note for an OLL or PBL case as shown (the build keeps it only where it singles the
 * case out). CLL's notes are chosen from facts: cllNote below.
 */
export function twoNoteRaw(set: "two-oll" | "two-pbl", s: Two): Words {
  if (set === "two-pbl") {
    const top = KIND[layerKind(s, "top")];
    const low = KIND[layerKind(s, "bottom")];
    return {
      en: `Top: ${top.en}; bottom: ${low.en}.`,
      ru: `Верх: ${top.ru}; низ: ${low.ru}.`,
    };
  }
  const shape = shapeNote(s);
  return { en: `${shape.en}.`, ru: `${shape.ru}.` };
}

/*
 * CLL notes from facts, as the 3×3 notes are made (notes.ts): how many corners show the
 * top's colour up is always said first (it is what the eye takes in first), then the
 * fewest plain facts that hold on the case as Learn shows it and together on no state of
 * any other case: where the top's colour faces on a side, then facts about the side
 * colours. A side-colour fact compares colours with each other (a pair, opposite colours,
 * neighbouring colours) and never names one, so it holds whatever turn of the top came
 * after the algorithm.
 */

type CllFact = {
  id: string;
  /** On the 12-letter picture (twoStickers): U's four, then F, R, B and L's top rows. */
  holds: (picture: string) => boolean;
  en: string;
  ru: string;
  cost: number;
  /** A side the top's colour faces, with how many stickers (the words join in a list). */
  facing?: { side: string; n: number };
};

const SIDE_AT: Record<string, number> = { F: 4, R: 6, B: 8, L: 10 };
const neighbours = (a: string, b: string) =>
  a !== "U" && b !== "U" && a !== b && OPPOSITE[a] !== b;
// A sticker of a side's top row by its end, as seen from outside the side.
const END_WORDS = {
  en: ["left", "right"],
  ru: ["левая", "правая"],
} as const;
const SIDE_WORDS: Record<string, { en: string; ru: string }> = {
  F: { en: "in front", ru: "спереди" },
  R: { en: "on the right", ru: "справа" },
  B: { en: "at the back", ru: "сзади" },
  L: { en: "on the left", ru: "слева" },
};

function cllFacts(): CllFact[] {
  const facts: CllFact[] = [];
  // Where the top's colour faces: seen at once, so the cheapest after the head.
  for (const s of SIDES) {
    const i = SIDE_AT[s] as number;
    for (const n of [1, 2])
      facts.push({
        id: `face-${s}${n}`,
        holds: (p) => Number(p[i] === "U") + Number(p[i + 1] === "U") === n,
        en: "",
        ru: "",
        cost: 0.5,
        facing: { side: s, n },
      });
  }
  facts.push({
    id: "no-pair",
    holds: (p) =>
      SIDES.every((s) => {
        const i = SIDE_AT[s] as number;
        return p[i] !== p[i + 1] || p[i] === "U";
      }),
    en: "no pair at the sides",
    ru: "по бокам без пар",
    cost: 0.8,
  });
  for (const s of SIDES) {
    const i = SIDE_AT[s] as number;
    const w = SIDE_WORDS[s] as Words;
    facts.push(
      {
        id: `pair-${s}`,
        holds: (p) => p[i] === p[i + 1] && p[i] !== "U",
        en: `a pair ${w.en}`,
        ru: `пара ${w.ru}`,
        cost: 1,
      },
      {
        id: `opposite-${s}`,
        holds: (p) => OPPOSITE[p[i] as string] === p[i + 1],
        en: `opposite colours ${w.en}`,
        ru: `противоположные цвета ${w.ru}`,
        cost: 1.2,
      },
      {
        id: `next-${s}`,
        holds: (p) => neighbours(p[i] as string, p[i + 1] as string),
        en: `neighbouring colours ${w.en}`,
        ru: `соседние цвета ${w.ru}`,
        cost: 1.2,
      },
    );
  }
  // Two stickers on two sides, of two pieces: one colour, or opposite colours.
  const stickers = SIDES.flatMap((s) => [0, 1].map((end) => ({ s, end })));
  for (let x = 0; x < stickers.length; x++)
    for (let y = x + 1; y < stickers.length; y++) {
      const a = stickers[x] as { s: string; end: number };
      const b = stickers[y] as { s: string; end: number };
      const i = (SIDE_AT[a.s] as number) + a.end;
      const j = (SIDE_AT[b.s] as number) + b.end;
      // One piece's two side stickers: a corner, never one colour.
      const k = SIDES.indexOf(a.s as (typeof SIDES)[number]);
      const onePiece =
        (a.end === 1 && b.s === SIDES[(k + 1) % 4] && b.end === 0) ||
        (a.end === 0 && b.s === SIDES[(k + 3) % 4] && b.end === 1);
      if (a.s === b.s || onePiece) continue;
      const sa = SIDE_WORDS[a.s] as { en: string; ru: string };
      const sb = SIDE_WORDS[b.s] as { en: string; ru: string };
      // The kind first, then the two stickers: `same colour: left in front, right on
      // the right`.
      const two = {
        en: `${END_WORDS.en[a.end]} ${sa.en}, ${END_WORDS.en[b.end]} ${sb.en}`,
        ru: `${END_WORDS.ru[a.end]} ${sa.ru}, ${END_WORDS.ru[b.end]} ${sb.ru}`,
      };
      facts.push(
        {
          id: `same-${a.s}${a.end}-${b.s}${b.end}`,
          holds: (p) => p[i] === p[j] && p[i] !== "U",
          en: `same colour: ${two.en}`,
          ru: `один цвет: ${two.ru}`,
          cost: 1.5,
        },
        {
          id: `across-${a.s}${a.end}-${b.s}${b.end}`,
          holds: (p) => OPPOSITE[p[i] as string] === p[j],
          en: `opposite colours: ${two.en}`,
          ru: `противоположные цвета: ${two.ru}`,
          cost: 1.6,
        },
      );
    }
  return facts;
}

const CLL_FACTS = cllFacts();

/** Whether a note's facts (and the corners up as on `shown`) hold together on `on`. */
export function cllFactsHold(
  ids: readonly string[],
  shown: Two,
  on: Two,
): boolean {
  if (headNote(on).en !== headNote(shown).en) return false;
  const p = twoStickers(on);
  return ids.every((id) => {
    const fact = CLL_FACTS.find((f) => f.id === id);
    if (!fact) throw new Error(`No CLL fact ${id}`);
    return fact.holds(p);
  });
}

/** A note's words: the head, the sides the top's colour faces as one list, the rest. */
function noteWords(head: Words, chosen: readonly CllFact[]): Words {
  const facing: Record<string, number> = { F: 0, R: 0, B: 0, L: 0 };
  for (const f of chosen) if (f.facing) facing[f.facing.side] = f.facing.n;
  const sides = SIDES.filter((side) => (facing[side] as number) > 0);
  const rest = chosen.filter((f) => !f.facing);
  const line = (lang: "en" | "ru") =>
    [
      head[lang],
      ...(sides.length ? [facingWords(facing, sides)[lang]] : []),
      ...rest.map((f) => f[lang]),
    ].join("; ");
  return { en: `${line("en")}.`, ru: `${line("ru")}.` };
}

/** Each fact counts once, and a fact of its own costs more than one more side in a list. */
const PER_FACT = 1;

/**
 * The note for a CLL case: how many corners show the top's colour up, then the fewest
 * plain facts (at most three) that hold on `shown` and together on none of `others`;
 * null where none will do.
 */
export function cllNote(
  shown: Two,
  others: readonly Two[],
): (Words & { facts: string[] }) | null {
  const head = headNote(shown);
  const mine = twoStickers(shown);
  // Only the others with the same corners up can be mistaken for it.
  const rest = others
    .filter((o) => headNote(o).en === head.en)
    .map((o) => twoStickers(o));
  const pool = CLL_FACTS.filter((f) => f.holds(mine));
  let best: { facts: CllFact[]; cost: number } | null = null;
  const tryPick = (pick: CllFact[]) => {
    if (!rest.every((o) => !pick.every((f) => f.holds(o)))) return;
    const cost = pick.reduce(
      (sum, f) => sum + f.cost + (f.facing ? 0 : PER_FACT),
      0,
    );
    if (!best || cost < best.cost - 1e-9) best = { facts: pick, cost };
  };
  const walk = (start: number, pick: CllFact[]) => {
    tryPick(pick);
    if (pick.filter((f) => !f.facing).length === 3) return;
    for (let i = start; i < pool.length; i++)
      walk(i + 1, [...pick, pool[i] as CllFact]);
  };
  walk(0, []);
  if (!best) return null;
  const chosen = (best as { facts: CllFact[] }).facts.sort(
    (a, b) => CLL_FACTS.indexOf(a) - CLL_FACTS.indexOf(b),
  );
  return { ...noteWords(head, chosen), facts: chosen.map((f) => f.id) };
}
