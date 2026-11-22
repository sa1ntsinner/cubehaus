/**
 * Checks on a case's picture, so an explanation can say only what the picture shows.
 *
 * A picture is 21 letters naming each top sticker's colour (`stickersOf` in the scramble
 * package): U row by row from the back left (0–8), then the top rows of F, R, B and L, each
 * read left to right as seen from outside that face (3 each). The letter is the face whose
 * centre has that colour, so `U` is the top colour.
 */
export type Side = "F" | "R" | "B" | "L";
const SIDE_START: Record<Side, number> = { F: 9, R: 12, B: 15, L: 18 };

/** A side's three stickers, left to right as seen from outside. */
export const sideOf = (d: string, side: Side) =>
  [...d.slice(SIDE_START[side], SIDE_START[side] + 3)] as [
    string,
    string,
    string,
  ];

/** The side shows one colour across: a bar. */
export function bar(d: string, side: Side): boolean {
  const [a, b, c] = sideOf(d, side);
  return a === b && b === c;
}

/** The two corners of a side match and the edge between them does not: headlights. */
export function lights(d: string, side: Side): boolean {
  const [a, b, c] = sideOf(d, side);
  return a === c && a !== b;
}

/** Two neighbouring stickers on a side match and the third does not: a pair (block). */
export function pair(d: string, side: Side, end: "left" | "right"): boolean {
  const [a, b, c] = sideOf(d, side);
  return end === "left" ? a === b && b !== c : b === c && a !== b;
}

/** Three different colours across a side. */
export function mixed(d: string, side: Side): boolean {
  const [a, b, c] = sideOf(d, side);
  return a !== b && b !== c && a !== c;
}

/** The side's corner and edge stickers are opposite colours (two corners match, edge opposite). */
const OPPOSITE: Record<string, string> = { F: "B", B: "F", R: "L", L: "R" };
export function lightsOpposite(d: string, side: Side): boolean {
  const [a, b] = sideOf(d, side);
  return lights(d, side) && OPPOSITE[a] === b;
}

const NAMED: Record<string, number> = {
  UBL: 0,
  UB: 1,
  UBR: 2,
  UL: 3,
  UR: 5,
  UFL: 6,
  UF: 7,
  UFR: 8,
};

/** Each named sticker shows the top colour: `UFL` on top, `F0` the front's left. */
export function up(d: string, ...names: string[]): boolean {
  return names.every((name) => d[indexOf(name)] === "U");
}

/** Exactly these stickers among the top's eight and the sides' twelve show the top colour. */
export function upExactly(d: string, ...names: string[]): boolean {
  const want = new Set(names.map(indexOf));
  for (let i = 0; i < 21; i++) {
    if (i === 4) continue;
    if ((d[i] === "U") !== want.has(i)) return false;
  }
  return true;
}

function indexOf(name: string): number {
  const named = NAMED[name];
  if (named !== undefined) return named;
  const side = name[0] as Side;
  const at = Number(name.slice(1));
  if (!(side in SIDE_START) || !(at >= 0 && at <= 2))
    throw new Error(`No sticker ${name}`);
  return SIDE_START[side] + at;
}

const TOP = ["UBL", "UB", "UBR", "UL", "UR", "UFL", "UF", "UFR"];

/** Exactly these of the top's eight stickers show the top colour. */
export function top(d: string, ...names: string[]): boolean {
  return TOP.every(
    (name) => (d[indexOf(name)] === "U") === names.includes(name),
  );
}
