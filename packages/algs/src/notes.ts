import {
  bar,
  lights,
  lightsOpposite,
  mixed,
  pair,
  type Side,
  sideOf,
} from "./diagram";

/**
 * One-line recognition notes for PLL and OLL, made from our sticker model.
 *
 * A note is a short list of facts about the case's picture (as Learn shows it, turned as
 * its main algorithm expects), each a predicate on the 21-letter picture with its words
 * in English and Russian. The facts are chosen so that together they hold on this case
 * and on no other case of the set met from any side (every U turn of every other case's
 * picture): a note always tells the case apart, and since its words are made from its
 * facts, it cannot say what the picture does not show. Of the sets of facts that do this,
 * the plainest wins (each fact has a cost; PLL prefers what two neighbouring sides show,
 * as PLL is read from two sides); where none of at most three facts will do, there is no
 * note.
 *
 * - PLL is read from the sides: headlights, bars, blocks round a corner, pairs, three
 *   colours on a side, and the colour between a side's headlights.
 * - OLL is read from the top colour only: the shape the edges make and which corners are
 *   up (always said, they are the first look), then where the top colour shows on the
 *   sides.
 */
export type Fact = {
  id: string;
  holds: (picture: string) => boolean;
  en: string;
  ru: string;
  /** How plain the fact is to look for: lower is plainer. */
  cost: number;
  /** The sides it reads, for PLL's two-side preference. */
  sides: readonly Side[];
};
export type Note = { en: string; ru: string; facts: readonly string[] };

const SIDES: readonly Side[] = ["F", "R", "B", "L"];
const WHERE = {
  en: { F: "in front", R: "on the right", B: "at the back", L: "on the left" },
  ru: { F: "спереди", R: "справа", B: "сзади", L: "слева" },
} as const;
const OF = {
  en: { F: "front", R: "right side", B: "back", L: "left side" },
  ru: { F: "передней", R: "правой", B: "задней", L: "левой" },
} as const;
/** The neighbour at a side's left and right end, as the side is seen from outside. */
const END: Record<Side, { left: Side; right: Side }> = {
  F: { left: "L", right: "R" },
  R: { left: "F", right: "B" },
  B: { left: "R", right: "L" },
  L: { left: "B", right: "F" },
};
const middle = (p: string, s: Side) => sideOf(p, s)[1];
const ends = (p: string, s: Side) => sideOf(p, s)[0];

/** The four top corners, each with its two sides: the side it is at the right end of first. */
const CORNERS = [
  {
    id: "FL",
    sides: ["L", "F"] as const,
    en: "front left",
    ru: "переднего левого",
  },
  {
    id: "FR",
    sides: ["F", "R"] as const,
    en: "front right",
    ru: "переднего правого",
  },
  {
    id: "BR",
    sides: ["R", "B"] as const,
    en: "back right",
    ru: "заднего правого",
  },
  {
    id: "BL",
    sides: ["B", "L"] as const,
    en: "back left",
    ru: "заднего левого",
  },
];

function pllFacts(): Fact[] {
  const every = (
    id: string,
    holds: (p: string, s: Side) => boolean,
    en: string,
    ru: string,
  ): Fact => ({
    id,
    holds: (p) => SIDES.every((s) => holds(p, s)),
    en,
    ru,
    cost: 0.8,
    sides: [],
  });
  const facts: Fact[] = [
    every(
      "all-mixed",
      mixed,
      "no headlights and no bar, three colours on every side",
      "ни фар, ни полос, на каждой стороне три цвета",
    ),
    every(
      "all-lights-opposite",
      lightsOpposite,
      "headlights on every side, each round the opposite colour",
      "фары на каждой стороне, между ними противоположный цвет",
    ),
    every(
      "all-lights-next",
      (p, s) => lights(p, s) && !lightsOpposite(p, s),
      "headlights on every side, each round a neighbouring colour",
      "фары на каждой стороне, между ними соседний цвет",
    ),
    every(
      "all-pairs-right",
      (p, s) => pair(p, s, "right"),
      "a pair on every side, each at its right end",
      "пара на каждой стороне, у правого края",
    ),
    every(
      "all-pairs-left",
      (p, s) => pair(p, s, "left"),
      "a pair on every side, each at its left end",
      "пара на каждой стороне, у левого края",
    ),
    every("no-lights", (p, s) => !lights(p, s), "no headlights", "фар нет"),
  ];
  for (const s of SIDES)
    facts.push(
      {
        id: `lights-${s}`,
        holds: (p) => lights(p, s),
        en: `headlights ${WHERE.en[s]}`,
        ru: `фары ${WHERE.ru[s]}`,
        cost: 1,
        sides: [s],
      },
      {
        id: `bar-${s}`,
        holds: (p) => bar(p, s),
        en: `a bar ${WHERE.en[s]}`,
        ru: `полоса ${WHERE.ru[s]}`,
        cost: 1,
        sides: [s],
      },
    );
  // A block: the corner and both its edges match on both of its sides.
  for (const c of CORNERS) {
    const [a, b] = c.sides;
    facts.push({
      id: `block-${c.id}`,
      holds: (p) => pair(p, a, "right") && pair(p, b, "left"),
      en: `a block at the ${c.en} corner`,
      ru: `блок у ${c.ru} угла`,
      cost: 1,
      sides: [a, b],
    });
  }
  for (const s of SIDES)
    for (const end of ["left", "right"] as const) {
      const by = END[s][end];
      facts.push({
        id: `pair-${s}-${end}`,
        holds: (p) => pair(p, s, end),
        en: `a pair ${WHERE.en[s]} next to the ${OF.en[by]}`,
        ru: `пара ${WHERE.ru[s]} у ${OF.ru[by]} стороны`,
        cost: 1.1,
        sides: [s],
      });
    }
  for (const s of SIDES)
    facts.push(
      {
        id: `mixed-${s}`,
        holds: (p) => mixed(p, s),
        en: `three colours ${WHERE.en[s]}`,
        ru: `${WHERE.ru[s]} три цвета`,
        cost: 1.2,
        sides: [s],
      },
      {
        id: `opposite-${s}`,
        holds: (p) => lightsOpposite(p, s),
        en: `headlights ${WHERE.en[s]} round the opposite colour`,
        ru: `фары ${WHERE.ru[s]}, между ними противоположный цвет`,
        cost: 1.2,
        sides: [s],
      },
    );
  // The colour between headlights, matching a neighbour's headlights: Ua from Ub.
  for (const s of SIDES)
    for (const end of ["left", "right"] as const) {
      const by = END[s][end];
      facts.push({
        id: `middle-${s}-${by}`,
        holds: (p) =>
          lights(p, s) && lights(p, by) && middle(p, s) === ends(p, by),
        en: `headlights ${WHERE.en[s]} round the colour of those ${WHERE.en[by]}`,
        ru: `фары ${WHERE.ru[s]}, между ними цвет фар ${WHERE.ru[by]}`,
        cost: 1.3,
        sides: [s, by],
      });
    }
  return facts;
}

const TOP = { BL: 0, BR: 2, FL: 6, FR: 8 } as const;
type Corner = keyof typeof TOP;
const CORNER_NAME = {
  en: {
    BL: "back left",
    BR: "back right",
    FL: "front left",
    FR: "front right",
  },
  ru: {
    BL: "задний левый",
    BR: "задний правый",
    FL: "передний левый",
    FR: "передний правый",
  },
} as const;
/** A corner's two side stickers: the side and the place on it. */
const CORNER_SIDES: Record<Corner, readonly (readonly [Side, number])[]> = {
  BL: [
    ["B", 2],
    ["L", 0],
  ],
  BR: [
    ["B", 0],
    ["R", 2],
  ],
  FL: [
    ["F", 0],
    ["L", 2],
  ],
  FR: [
    ["F", 2],
    ["R", 0],
  ],
};
const FACING = {
  en: { F: "the front", R: "right", B: "the back", L: "left" },
  ru: { F: "вперёд", R: "вправо", B: "назад", L: "влево" },
} as const;
const isUp = (p: string, i: number) => p[i] === "U";
const sideUp = (p: string, s: Side, i: number) => sideOf(p, s)[i] === "U";

/** The shape the edges make on top. */
function shapeOf(p: string): Fact {
  const edges = { B: isUp(p, 1), L: isUp(p, 3), R: isUp(p, 5), F: isUp(p, 7) };
  const key = [1, 3, 5, 7].map((i) => +isUp(p, i)).join("");
  const n = Object.values(edges).filter(Boolean).length;
  const fb = edges.F ? "in front" : "at the back";
  const lr = edges.L ? "on the left" : "on the right";
  const say =
    n === 0
      ? { en: "a dot", ru: "точка" }
      : n === 4
        ? { en: "a cross", ru: "крест" }
        : edges.L && edges.R
          ? { en: "a line from left to right", ru: "линия слева направо" }
          : edges.F && edges.B
            ? { en: "a line from front to back", ru: "линия спереди назад" }
            : {
                en: `an L ${fb} and ${lr}`,
                ru: `уголок ${edges.F ? "спереди" : "сзади"} и ${edges.L ? "слева" : "справа"}`,
              };
  return {
    id: `shape-${key}`,
    holds: (q) => [1, 3, 5, 7].map((i) => +isUp(q, i)).join("") === key,
    ...say,
    cost: 0,
    sides: [],
  };
}

/** Which corners are up, exactly. */
function cornersOf(p: string): Fact {
  const up = (Object.keys(TOP) as Corner[]).filter((c) => isUp(p, TOP[c]));
  const key = up.join("") || "none";
  const both = (a: Corner, b: Corner) =>
    up.length === 2 && up.includes(a) && up.includes(b);
  const say =
    up.length === 0
      ? { en: "no corner up", ru: "углов сверху нет" }
      : up.length === 4
        ? { en: "all four corners up", ru: "все четыре угла сверху" }
        : up.length === 1
          ? {
              en: `one corner up, the ${CORNER_NAME.en[up[0] as Corner]}`,
              ru: `один угол сверху, ${CORNER_NAME.ru[up[0] as Corner]}`,
            }
          : both("BL", "BR")
            ? { en: "both back corners up", ru: "оба задних угла сверху" }
            : both("FL", "FR")
              ? { en: "both front corners up", ru: "оба передних угла сверху" }
              : both("BL", "FL")
                ? { en: "both left corners up", ru: "оба левых угла сверху" }
                : both("BR", "FR")
                  ? {
                      en: "both right corners up",
                      ru: "оба правых угла сверху",
                    }
                  : {
                      en: `two corners up across, the ${CORNER_NAME.en[up[0] as Corner]} and the ${CORNER_NAME.en[up[1] as Corner]}`,
                      ru: `два угла сверху по диагонали, ${CORNER_NAME.ru[up[0] as Corner]} и ${CORNER_NAME.ru[up[1] as Corner]}`,
                    };
  return {
    id: `corners-${key}`,
    holds: (q) =>
      (Object.keys(TOP) as Corner[]).filter((c) => isUp(q, TOP[c])).join("") ===
      up.join(""),
    ...say,
    cost: 0,
    sides: [],
  };
}

function ollFacts(): Fact[] {
  const facts: Fact[] = [];
  // The same on two opposite sides, said once.
  const bars = (p: string, s: Side) => [0, 1, 2].every((i) => sideUp(p, s, i));
  const lamps = (p: string, s: Side) =>
    sideUp(p, s, 0) && sideUp(p, s, 2) && !sideUp(p, s, 1);
  for (const [a, b, en, ru] of [
    ["L", "R", "on the left and the right", "слева и справа"],
    ["F", "B", "in front and at the back", "спереди и сзади"],
  ] as const)
    facts.push(
      {
        id: `top-bars-${a}${b}`,
        holds: (p) => bars(p, a) && bars(p, b),
        en: `bars of the top colour ${en}`,
        ru: `${ru} полосы верхнего цвета`,
        cost: 1,
        sides: [a, b],
      },
      {
        id: `top-lights-${a}${b}`,
        holds: (p) => lamps(p, a) && lamps(p, b),
        en: `headlights of the top colour ${en}`,
        ru: `${ru} фары верхнего цвета`,
        cost: 1,
        sides: [a, b],
      },
    );
  for (const s of SIDES)
    facts.push(
      {
        id: `top-bar-${s}`,
        holds: (p) => bars(p, s),
        en: `a bar of the top colour ${WHERE.en[s]}`,
        ru: `${WHERE.ru[s]} полоса верхнего цвета`,
        cost: 1,
        sides: [s],
      },
      {
        id: `top-lights-${s}`,
        holds: (p) => lamps(p, s),
        en: `headlights of the top colour ${WHERE.en[s]}`,
        ru: `${WHERE.ru[s]} фары верхнего цвета`,
        cost: 1,
        sides: [s],
      },
    );
  for (const c of Object.keys(TOP) as Corner[])
    for (const [s, i] of CORNER_SIDES[c])
      facts.push({
        id: `faces-${c}-${s}`,
        holds: (p) => sideUp(p, s, i),
        en: `the ${CORNER_NAME.en[c]} corner faces ${FACING.en[s]}`,
        ru: `${CORNER_NAME.ru[c]} угол смотрит ${FACING.ru[s]}`,
        cost: 1.2,
        sides: [s],
      });
  return facts;
}

const FACTS = { pll: pllFacts(), oll: ollFacts() };
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const read = (set: "pll" | "oll", p: string) =>
  set === "oll" ? [...p].map((c) => (c === "U" ? "U" : "x")).join("") : p;

/** A fact by its id; the shape and corner facts are made from the picture they describe. */
export function factOf(set: "pll" | "oll", picture: string, id: string): Fact {
  const p = read(set, picture);
  if (id.startsWith("shape-")) return shapeOf(p);
  if (id.startsWith("corners-")) return cornersOf(p);
  const fact = FACTS[set].find((f) => f.id === id);
  if (!fact) throw new Error(`No fact ${id}`);
  return fact;
}

/** The words of a list of facts: one line, the facts apart by semicolons. */
export function sayFacts(
  set: "pll" | "oll",
  picture: string,
  ids: readonly string[],
): { en: string; ru: string } {
  const facts = ids.map((id) => factOf(set, picture, id));
  const line = (lang: "en" | "ru") =>
    `${capital(facts.map((f) => f[lang]).join("; "))}.`;
  return { en: line("en"), ru: line("ru") };
}

/** Whether the facts hold together on a picture (OLL reads the top colour only). */
export function factsHold(
  set: "pll" | "oll",
  picture: string,
  ids: readonly string[],
  on: string,
): boolean {
  const q = read(set, on);
  return ids.every((id) => factOf(set, picture, id).holds(q));
}

/** Two sides beside each other (not across). */
const beside = (a: Side, b: Side) => END[a].left === b || END[a].right === b;

/**
 * The note for a case: the plainest facts (at most three, besides OLL's shape and
 * corners) that hold on `picture` and together on none of `others` (every other case's
 * pictures, from every side); null where there are none.
 */
export function noteFor(
  set: "pll" | "oll",
  picture: string,
  others: readonly string[],
): Note | null {
  const mine = read(set, picture);
  const rest = others.map((o) => read(set, o));
  const lead = set === "oll" ? [shapeOf(mine), cornersOf(mine)] : [];
  const pool = FACTS[set].filter((f) => f.holds(mine));
  const order = new Map(FACTS[set].map((f, i) => [f.id, i]));
  let best: { facts: Fact[]; cost: number } | null = null;
  for (let size = 0; size <= 3; size++) {
    for (const pick of combinations(pool, size)) {
      const chosen = [...lead, ...pick];
      if (chosen.length === 0) continue;
      if (!rest.every((o) => !chosen.every((f) => f.holds(o)))) continue;
      const sides = [...new Set(pick.flatMap((f) => f.sides))];
      const spread =
        set === "pll" &&
        (sides.length > 2 ||
          (sides.length === 2 && !beside(sides[0] as Side, sides[1] as Side)))
          ? 0.5
          : 0;
      const cost = pick.reduce((sum, f) => sum + f.cost, 0) + spread;
      if (!best || cost < best.cost - 1e-9) best = { facts: chosen, cost };
    }
  }
  if (!best) return null;
  const ids = best.facts
    .sort((a, b) => (order.get(a.id) ?? -1) - (order.get(b.id) ?? -1))
    .map((f) => f.id);
  return { ...sayFacts(set, mine, ids), facts: ids };
}

function* combinations<T>(items: readonly T[], k: number): Generator<T[]> {
  if (k === 0) {
    yield [];
    return;
  }
  for (let i = 0; i <= items.length - k; i++)
    for (const rest of combinations(items.slice(i + 1), k - 1))
      yield [items[i] as T, ...rest];
}
