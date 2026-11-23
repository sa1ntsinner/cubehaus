import { placePair } from "@cubehaus/scramble/f2l";
import { f2lState, mirrorAlg } from "@cubehaus/scramble/f2l-state";
import type { KPuzzle } from "cubing/kpuzzle";
import { joinedAt } from "./facelets";
import { parseAlg } from "./metrics";

/**
 * What an F2L algorithm does, in plain words, read from the cube model as the algorithm is
 * played: where the corner and the edge are after each turn, and from which turn on they
 * stay joined (facelets.ts). A note is made only where the algorithm has a clear shape: the
 * pair is joined on top and the last three turns insert it (`X U X'`, X a quarter turn of R
 * or F), before that at most one U turn; what comes first is said only by facts the trace
 * shows (a piece taken out of the slot, a piece hidden below the top while a U turn brings
 * the other over). Otherwise there is no note. Build and test time only (it needs cubing).
 */

export type PairAt = {
  corner: number;
  twist: number;
  edge: number;
  flip: number;
  joined: boolean;
};

const PAIR_CORNER = 4;
const PAIR_EDGE = 8;

/** The pair after each turn of `alg` (front right frame), the start first. */
export function traceF2l(puzzle: KPuzzle, key: string, alg: string): PairAt[] {
  let pattern = placePair(puzzle.defaultPattern(), f2lState(key));
  const read = (): PairAt => {
    const data = pattern.patternData as unknown as {
      CORNERS: { pieces: number[]; orientation: number[] };
      EDGES: { pieces: number[]; orientation: number[] };
    };
    const corner = data.CORNERS.pieces.indexOf(PAIR_CORNER);
    const edge = data.EDGES.pieces.indexOf(PAIR_EDGE);
    const twist = data.CORNERS.orientation[corner] as number;
    const flip = data.EDGES.orientation[edge] as number;
    return {
      corner,
      twist,
      edge,
      flip,
      joined: joinedAt(
        { place: corner, twist, piece: PAIR_CORNER },
        { place: edge, flip, piece: PAIR_EDGE },
      ),
    };
  };
  const out = [read()];
  for (const turn of alg.trim().split(/\s+/)) {
    pattern = pattern.applyAlg(turn);
    out.push(read());
  }
  return out;
}

export type IdeaFacts = {
  /** The first state from which the pair stays joined to the end. */
  formed: number;
  /**
   * How the last three turns insert: `joined`, a pair joined on top before them; `split`,
   * the two apart before them and joined by the insert's U turn.
   */
  insert: "joined" | "split";
  /** Joined below the top, then brought up as one before the insert. */
  lift: boolean;
  /** Pieces in the slot at the start that the algorithm takes out. */
  takeOut: "corner" | "edge" | "both" | null;
  /** A piece hidden below the top while a U turn brings the other over it. */
  hide: { piece: "corner" | "edge"; turn: number } | null;
};

export type Idea = { en: string; ru: string; facts: IdeaFacts };

const top = (place: number) => place < 4;

/** `X U X'` with X a quarter turn of R or F: the three turns of an insert. */
export function isInsert(turns: readonly string[]): boolean {
  if (turns.length !== 3) return false;
  const t = parseAlg(turns.join(" "));
  const [x, y, z] = t as [
    (typeof t)[number],
    (typeof t)[number],
    (typeof t)[number],
  ];
  return (
    (x.letter === "R" || x.letter === "F") &&
    x.quarters !== 2 &&
    y.letter === "U" &&
    z.letter === x.letter &&
    (x.quarters + z.quarters) % 4 === 0
  );
}

/** The facts of the algorithm's shape, or null where it has no clear one. */
export function ideaFacts(
  trace: readonly PairAt[],
  alg: string,
): IdeaFacts | null {
  const turns = alg.trim().split(/\s+/);
  const n = turns.length;
  if (n < 3 || !isInsert(turns.slice(n - 3))) return null;
  let formed = n;
  while (formed > 0 && (trace[formed - 1] as PairAt).joined) formed--;
  const before = trace[n - 3] as PairAt;
  if (!top(before.corner) || !top(before.edge)) return null;
  let insert: IdeaFacts["insert"];
  let lift = false;
  if (formed <= n - 3) {
    // Joined before the insert and kept joined; lifted to the top if it formed lower.
    const at = trace[formed] as PairAt;
    lift = !top(at.corner) || !top(at.edge);
    insert = "joined";
  } else {
    // Apart before the insert; its first two turns join them.
    insert = "split";
  }
  const setupEnd = insert === "joined" ? formed : n - 3;
  // A piece in the slot at the start counts as taken out when it leaves the slot before
  // the insert begins.
  const start = trace[0] as PairAt;
  const early = trace.slice(1, setupEnd + 1);
  const inCorner =
    start.corner === PAIR_CORNER && early.some((s) => s.corner !== PAIR_CORNER);
  const inEdge =
    start.edge === PAIR_EDGE && early.some((s) => s.edge !== PAIR_EDGE);
  const takeOut =
    inCorner && inEdge ? "both" : inCorner ? "corner" : inEdge ? "edge" : null;
  // A hidden piece: on top before, below the top during a U turn that moves the other
  // (on top), back on top by the time the setup ends.
  let hide: IdeaFacts["hide"] = null;
  for (let j = 0; j < setupEnd && !hide; j++) {
    if (!(turns[j] as string).startsWith("U")) continue;
    const [a, b] = [trace[j] as PairAt, trace[j + 1] as PairAt];
    for (const piece of ["corner", "edge"] as const) {
      const place = (s: PairAt) => (piece === "corner" ? s.corner : s.edge);
      const other = (s: PairAt) => (piece === "corner" ? s.edge : s.corner);
      const wasUp = trace.slice(0, j).some((s) => top(place(s)));
      if (
        wasUp &&
        !top(place(a)) &&
        !top(place(b)) &&
        top(other(a)) &&
        top(other(b))
      ) {
        hide = { piece, turn: j };
        break;
      }
    }
  }
  // Something done before the insert must be said by a fact, or there is no note.
  if (setupEnd > 0 && !takeOut && !hide && insert === "split") return null;
  return { formed, insert, lift, takeOut, hide };
}

const OUT: Record<"corner" | "edge" | "both", { en: string; ru: string }> = {
  corner: { en: "take the corner out", ru: "достаньте угол" },
  edge: { en: "take the edge out", ru: "достаньте ребро" },
  both: { en: "take both out", ru: "достаньте оба" },
};
const HIDE = {
  corner: {
    en: "hide the corner, bring the edge over",
    ru: "спрячьте угол, подведите ребро",
  },
  edge: {
    en: "hide the edge, bring the corner over",
    ru: "спрячьте ребро, подведите угол",
  },
};

/** The words for an algorithm's shape. */
export function ideaWords(facts: IdeaFacts): { en: string; ru: string } {
  if (facts.formed === 0)
    return facts.lift
      ? {
          en: "Already joined: bring the pair up, then insert.",
          ru: "Пара уже собрана: поднимите её, затем вставьте.",
        }
      : { en: "Already joined: insert.", ru: "Пара уже собрана: вставьте." };
  const parts: { en: string; ru: string }[] = [];
  if (facts.takeOut) parts.push(OUT[facts.takeOut]);
  if (facts.hide) parts.push(HIDE[facts.hide.piece]);
  if (facts.insert === "joined")
    parts.push({ en: "join them", ru: "соедините" });
  if (facts.lift) parts.push({ en: "bring the pair up", ru: "поднимите пару" });
  const tail =
    facts.insert === "joined"
      ? { en: "then insert.", ru: "затем вставьте." }
      : {
          en: "then insert; the insert joins them.",
          ru: "затем вставьте: пара соберётся при вставке.",
        };
  if (parts.length === 0)
    return {
      en: "Insert as it is; the insert joins them.",
      ru: "Вставьте как есть: пара соберётся при вставке.",
    };
  const line = (lang: "en" | "ru") => {
    const text = [...parts.map((p) => p[lang]), tail[lang]].join(", ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  };
  return { en: line("en"), ru: line("ru") };
}

const UNBACK: Record<string, string> = { B: "R", R: "F", F: "L", L: "B" };

/** A slot's algorithm as the front right algorithm it stands for. */
export function frontRightAlg(
  alg: string,
  slot: "fr" | "fl" | "br" | "bl",
): string {
  const right = slot === "fl" || slot === "bl" ? mirrorAlg(alg) : alg;
  if (slot === "fr" || slot === "fl") return right;
  return right
    .split(" ")
    .map((t) => (UNBACK[t[0] as string] ?? t[0]) + t.slice(1))
    .join(" ");
}

/** The note for a case's main algorithm (front right frame), or null. */
export function f2lIdea(
  puzzle: KPuzzle,
  key: string,
  alg: string,
): Idea | null {
  const facts = ideaFacts(traceF2l(puzzle, key, alg), alg);
  return facts ? { ...ideaWords(facts), facts } : null;
}
