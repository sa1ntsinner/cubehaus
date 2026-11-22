// Bring the library's scrambles to the form the official program writes:
// 2x2x2 turns only U, R and F; 6x6x6 turns three layers only from R, F and U.
// A turn of the opposite side equals this side's turn plus a turn of the
// whole puzzle, so the rest of the sequence is relabelled to the new frame.
// The final whole-puzzle rotation is dropped: the scrambled state is the
// same up to how the puzzle is held.

type Face = "U" | "D" | "F" | "B" | "L" | "R";

const opposite: Record<Face, Face> = {
  U: "D",
  D: "U",
  F: "B",
  B: "F",
  L: "R",
  R: "L",
};

// For each whole-puzzle quarter turn x (with R), y (with U), z (with F): the
// face it brings into each position. Turning the face now at position p is
// turning the face that started at quarter[p].
const quarter: Record<"R" | "U" | "F", Record<Face, Face>> = {
  R: { U: "F", B: "U", D: "B", F: "D", R: "R", L: "L" },
  U: { F: "R", L: "F", B: "L", R: "B", U: "U", D: "D" },
  F: { R: "U", D: "R", L: "D", U: "L", F: "F", B: "B" },
};

interface Turn {
  prefix: string; // "", "3" (layer count before the face)
  face: Face;
  wide: boolean; // "w" after the face
  amount: number; // 1, 2 or 3 quarter turns clockwise
}

const pattern = /^(\d*)([UDFBLR])(w?)(\d*)('?)$/;

function parse(token: string): Turn | null {
  const match = pattern.exec(token);
  if (!match) return null;
  const [, prefix = "", face, w, count, prime] = match;
  const turns = (count ? Number(count) : 1) * (prime ? -1 : 1);
  return {
    prefix,
    face: face as Face,
    wide: w === "w",
    amount: ((turns % 4) + 4) % 4,
  };
}

function write(turn: Turn): string {
  const suffix = turn.amount === 1 ? "" : turn.amount === 2 ? "2" : "'";
  return `${turn.prefix}${turn.face}${turn.wide ? "w" : ""}${suffix}`;
}

function rewrite(
  scramble: string,
  mustTurnFromOtherSide: (turn: Turn) => boolean,
): string {
  // frame[f]: the face that is turned when the original sequence turns f.
  let frame: Record<Face, Face> = {
    U: "U",
    D: "D",
    F: "F",
    B: "B",
    L: "L",
    R: "R",
  };
  const out: Turn[] = [];
  for (const token of scramble.split(/\s+/).filter(Boolean)) {
    const parsed = parse(token);
    if (!parsed) return scramble; // not a cube scramble: leave it alone
    const turn = { ...parsed, face: frame[parsed.face] };
    if (mustTurnFromOtherSide(turn)) {
      const side = opposite[turn.face] as "R" | "U" | "F";
      turn.face = side;
      // The opposite side's turn leaves the puzzle turned by the inverse of
      // this side's whole-puzzle turn, as many times as the move turned.
      const times = (4 - turn.amount) % 4;
      const step = quarter[side];
      const next = { ...frame };
      for (const face of Object.keys(frame) as Face[]) {
        let f = frame[face];
        for (let i = 0; i < times; i++) f = step[f];
        next[face] = f;
      }
      frame = next;
    }
    const last = out.at(-1);
    if (
      last &&
      last.face === turn.face &&
      last.prefix === turn.prefix &&
      last.wide === turn.wide
    ) {
      last.amount = (last.amount + turn.amount) % 4;
      if (last.amount === 0) out.pop();
    } else if (turn.amount !== 0) {
      out.push(turn);
    }
  }
  return out.map(write).join(" ");
}

const awaySides = new Set<Face>(["L", "D", "B"]);

export function officialTwoByTwo(scramble: string): string {
  return rewrite(scramble, (turn) => awaySides.has(turn.face));
}

export function officialBigCube(scramble: string): string {
  return rewrite(
    scramble,
    (turn) => turn.prefix === "3" && turn.wide && awaySides.has(turn.face),
  );
}
