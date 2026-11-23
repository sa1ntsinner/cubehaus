import type { EventId } from "@cubehaus/core";
import type { FaceLetter } from "@cubehaus/cube/holding";
import { heldColour, puzzleGlyph } from "../puzzle-glyph";

type Faces = Readonly<Record<FaceLetter, FaceLetter>>;

/**
 * A puzzle's tile picture (puzzle-glyph.ts) in the colours the person holds
 * (`holdingFaces`); decoration, so screen readers skip it.
 */
export function PuzzleGlyph({
  event,
  faces,
}: {
  event: EventId;
  faces: Faces;
}) {
  const { shapes, mark } = puzzleGlyph(event);
  return (
    <svg data-part="glyph" viewBox="0 0 100 100" aria-hidden="true">
      {shapes.map(({ d, colour, shade }, index) =>
        colour ? (
          <path
            // biome-ignore lint/suspicious/noArrayIndexKey: a drawing's shapes never move.
            key={index}
            d={d}
            data-glyph={heldColour(event, colour, faces)}
            data-shade={shade}
          />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: as above.
          <path key={index} d={d} data-glyph="core" />
        ),
      )}
      {mark && (
        <text data-part="glyph-mark" x="99" y="97" textAnchor="end">
          {mark}
        </text>
      )}
    </svg>
  );
}

/** Up to four puzzles of a folder, two by two. */
export function FolderGlyph({
  events,
  faces,
}: {
  events: readonly EventId[];
  faces: Faces;
}) {
  return (
    <span data-part="glyph-folder" aria-hidden="true">
      {events.map((event, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the same puzzle can repeat.
        <PuzzleGlyph key={index} event={event} faces={faces} />
      ))}
    </span>
  );
}
