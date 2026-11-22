/**
 * Numbers that rank the algorithms of one case. Lower is better for each.
 *
 * - `moves`: turns in the slice turn metric (a slice or wide turn is one, a rotation none).
 * - `rotations`: x, y and z.
 * - `wide`: wide turns (`r`, `Rw`) and slices (`M`, `E`, `S`).
 * - `fbd`: turns of F, B or D (wide and slice included), which leave the comfortable R/U
 *   grip of two hands.
 * - `left`: turns of L (wide included), which a right-handed solver makes less easily
 *   than R.
 * - `regrips`: a rough count of grip changes: how often the turning face family changes
 *   from one non-U turn to the next (R side `R r M`, L side `L l`, `F f S`, `B b`,
 *   `D d E`). U turns are made by fingers in any grip and do not count.
 *
 * `score = moves + 2·rotations + regrips + 0.5·wide + 0.5·fbd + 0.5·left`. It is a rough guide, not
 * a speed model: it prefers short R/U algorithms and charges for what makes one awkward.
 */
export type Metrics = {
  moves: number;
  rotations: number;
  wide: number;
  fbd: number;
  left: number;
  regrips: number;
  score: number;
};

const TOKEN = /^([URFDLBurfdlbMESxyz])(w?)(\d*)('?)$/;

export type Turn = {
  /** The letter as written, `R`, `r`, `M`, `x`. */
  letter: string;
  wide: boolean;
  /** 1, 2 or 3 quarter turns clockwise. */
  quarters: number;
};

export function parseAlg(alg: string): Turn[] {
  return alg
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const match = TOKEN.exec(token);
      if (!match) throw new Error(`Not a turn: ${token}`);
      const [, letter = "", w, amount, prime] = match;
      const n = amount ? Number(amount) : 1;
      if (n < 1 || n > 3) throw new Error(`Not a turn: ${token}`);
      const quarters = (((prime ? -n : n) % 4) + 4) % 4;
      return {
        letter: w ? letter.toLowerCase() : letter,
        wide: w === "w" || /[urfdlb]/.test(letter),
        quarters,
      };
    });
}

const FAMILY: Record<string, string> = {
  R: "R",
  r: "R",
  M: "R",
  L: "L",
  l: "L",
  F: "F",
  f: "F",
  S: "F",
  B: "B",
  b: "B",
  D: "D",
  d: "D",
  E: "D",
};

export function metricsOf(alg: string): Metrics {
  const turns = parseAlg(alg);
  let moves = 0;
  let rotations = 0;
  let wide = 0;
  let fbd = 0;
  let left = 0;
  let regrips = 0;
  let family: string | null = null;
  for (const turn of turns) {
    if ("xyz".includes(turn.letter)) {
      rotations++;
      continue;
    }
    moves++;
    if (turn.wide || "MES".includes(turn.letter)) wide++;
    if ("FBDfbdSE".includes(turn.letter)) fbd++;
    if (turn.letter === "L" || turn.letter === "l") left++;
    const next = FAMILY[turn.letter];
    if (next) {
      if (family !== null && next !== family) regrips++;
      family = next;
    }
  }
  const score =
    moves + 2 * rotations + regrips + 0.5 * wide + 0.5 * fbd + 0.5 * left;
  return { moves, rotations, wide, fbd, left, regrips, score };
}

/** The algorithm written the way it is shown: one space, `2` for half turns. */
export function tidy(alg: string): string {
  return alg
    .trim()
    .split(/\s+/)
    .map((token) => token.replace("2'", "2"))
    .join(" ");
}
