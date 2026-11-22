import type { EventId } from "@cubehaus/core";
import { officialBigCube, officialTwoByTwo } from "./rewrite";

// The official program writes Clock's front pins in this order; the
// library writes the same turns in another. Clock turns add up, so any
// order of one side's turns gives the same state.
const clockFront = ["UR", "DR", "DL", "UL", "U", "R", "D", "L", "ALL"];
const clockToken = /^(UR|DR|DL|UL|U|R|D|L|ALL)\d[+-]$/;

function officialClock(scramble: string): string {
  const tokens = scramble.split(/\s+/).filter(Boolean);
  const flip = tokens.indexOf("y2");
  const front = flip === -1 ? tokens : tokens.slice(0, flip);
  if (!front.every((token) => clockToken.test(token))) return scramble;
  const pin = (token: string) =>
    clockFront.indexOf(
      (clockToken.exec(token) as RegExpExecArray)[1] as string,
    );
  const ordered = [...front].sort((a, b) => pin(a) - pin(b));
  return [...ordered, ...(flip === -1 ? [] : tokens.slice(flip))].join(" ");
}

function officialSquareOne(scramble: string): string {
  return scramble.replace(/\((-?\d+),\s+(-?\d+)\)/g, "($1,$2)");
}

// The library ends a blindfolded scramble with a wide D turn to set the
// orientation; the official program uses a wide U turn. Both reach all 24
// orientations, so the swap keeps the scramble fair.
function officialBlindfolded(scramble: string): string {
  return scramble
    .split("\n")
    .map((line) => line.replace(/\bDw(2|')?(\s*)$/, "Uw$1$2"))
    .join("\n");
}

export function toOfficial(event: EventId, scramble: string): string {
  switch (event) {
    case "222":
      return officialTwoByTwo(scramble);
    case "666":
      return officialBigCube(scramble);
    case "333bf":
    case "333mbf":
      return officialBlindfolded(scramble);
    case "clock":
      return officialClock(scramble);
    case "sq1":
      return officialSquareOne(scramble);
    default:
      return scramble;
  }
}

export function officialTokens(event: EventId, scramble: string): string[] {
  const tokens = scramble.split(/\s+/).filter(Boolean);
  if (event !== "sq1") return tokens;
  // A Square-1 unit "(x, y)" may still hold a space before it is official.
  return officialSquareOne(scramble).split(/\s+/).filter(Boolean);
}
