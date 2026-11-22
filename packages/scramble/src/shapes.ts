import type { EventId } from "@cubehaus/core";

// What an official scramble of each event looks like (research D2), as one
// regular expression per event. The browser tests share these.
const move = (faces: string) => `(?:${faces})(?:2|')?`;
const line = (unit: string) => `^${unit}(?: ${unit})*$`;
export const officialShape: Record<EventId, RegExp> = {
  "333": new RegExp(line(move("[UDFBLR]"))),
  "333oh": new RegExp(line(move("[UDFBLR]"))),
  "222": new RegExp(line(move("[URF]"))),
  "444": new RegExp(line(move("[UDFBLR]|[RUF]w"))),
  "555": new RegExp(line(move("[UDFBLR]w?"))),
  "666": new RegExp(line(move("[UDFBLR]w?|3[RUF]w"))),
  "777": new RegExp(line(move("[UDFBLR]w?|3[UDFBLR]w"))),
  "333bf": new RegExp(
    `^${move("[UDFBLR]")}(?: ${move("[UDFBLR]")})*(?: ${move("Rw|Fw")})?(?: ${move("Uw")})?$`,
  ),
  "333fm": /^R' U' F (?:[UDFBLR](?:2|')? )+R' U' F$/,
  "333mbf": new RegExp(
    `^(?:${move("[UDFBLR]")}(?: ${move("[UDFBLR]")})*(?: ${move("Rw|Fw")})?(?: ${move("Uw")})?\\n?)+$`,
  ),
  clock:
    /^UR\d[+-] DR\d[+-] DL\d[+-] UL\d[+-] U\d[+-] R\d[+-] D\d[+-] L\d[+-] ALL\d[+-] y2 U\d[+-] R\d[+-] D\d[+-] L\d[+-] ALL\d[+-]$/,
  minx: /^(?:(?:[RD](?:\+\+|--) ){10}U'?\n?){7}$/,
  // Exactly 11 main moves (as the official program writes them), then 0 to 4 tips.
  pyram: new RegExp(
    `^${move("[ULRB]")}(?: ${move("[ULRB]")}){10}(?: [ulrb]'?){0,4}$`,
  ),
  skewb: new RegExp(line(move("[RLUB]"))),
  sq1: /^(?:\(-?\d,-?\d\)(?: \/)?(?: |$))+$/,
  "444bf": new RegExp(
    `^${move("[UDFBLR]|[RUF]w")}(?: ${move("[UDFBLR]|[RUF]w")})*(?: [xz](?:2|')?)?(?: y(?:2|')?)?$`,
  ),
  "555bf": new RegExp(
    `^${move("[UDFBLR]w?")}(?: ${move("[UDFBLR]w?")})*(?: ${move("3Rw|3Fw")})?(?: ${move("3Uw")})?$`,
  ),
  fto: new RegExp(line("(?:BR|BL|[UFRLBD])'?")),
};
