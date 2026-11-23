import { type CrossColour, faceOfCrossColour } from "@cubehaus/core";
import { Fragment } from "react";
import type { Text } from "../text";

/**
 * Each colour's shortest cross as a small grid, one colour to a cell (its sticker, its
 * name, the length), so a colour and its number never part on a narrow screen. Opposite
 * colours share a column (white over yellow) where two rows hold them all; a phone with
 * all six in play gives each opposite pair a row instead. The shortest is `pb` (unless
 * every colour is as short); the
 * colour that counts (the solve's own, or the pick) is `ink`, and a pick is underlined
 * and followed by how many turns longer it was than the shortest.
 */
export function CrossCells({
  cells,
  words,
  own = null,
  pick = null,
  over,
  overTip,
}: {
  cells: readonly { colour: CrossColour; length: number }[];
  words: Text;
  /** The colour the solve was built on. */
  own?: CrossColour | null;
  /** Choosing the cross: the colour picked. */
  pick?: CrossColour | null;
  /** Choosing the cross: how many turns the pick's cross is longer than the shortest. */
  over?: number;
  overTip?: string;
}) {
  const shortest = Math.min(...cells.map(({ length }) => length));
  // When every colour is as short, none is marked: there was nothing to choose.
  const marked = cells.some(({ length }) => length > shortest);
  return (
    <span data-part="cross-cells" data-count={cells.length}>
      {cells.map(({ colour, length }, index) => (
        <Fragment key={colour}>
          {index > 0 && " "}
          <span
            data-part="cross-cell"
            data-colour={colour}
            data-own={colour === own || undefined}
            data-picked={colour === pick || undefined}
            data-shortest={(marked && length === shortest) || undefined}
          >
            <span
              data-part="cross-swatch"
              data-face={faceOfCrossColour(colour)}
              aria-hidden="true"
            />
            <span data-part="cross-cell-words">
              {words.cross.name[colour]}{" "}
              <span data-part="cross-length">{length}</span>
            </span>
            {colour === pick && over !== undefined && (
              <span
                data-part="choice-over"
                data-near={over <= 1 || undefined}
                title={overTip}
              >
                +{over}
              </span>
            )}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
