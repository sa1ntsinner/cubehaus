import type { EventId } from "@cubehaus/core";
import { clockDials } from "@cubehaus/cube";
import {
  type CSSProperties,
  type Ref,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Clock, type ClockState, clockBox } from "./Clock";
import { polygonPoints } from "./geometry";
import { PictureZoom, type ZoomState } from "./PictureZoom";
import { cubeDrawing, cubeSizes, type TileDrawing } from "./picture";
import { squareDrawing } from "./square1";

type PictureDrawing =
  | TileDrawing
  | { viewBox: typeof clockBox; clock: ClockState };
type StickerStyle = CSSProperties & { "--d": string };

export function Drawing({
  drawing,
  scramble,
  svgRef,
}: {
  drawing: PictureDrawing;
  scramble: string;
  svgRef?: Ref<SVGSVGElement>;
}) {
  const gradient = `picture-sheen-${useId()}`;
  return (
    <svg
      ref={svgRef}
      data-part="picture-drawing"
      viewBox={drawing.viewBox.join(" ")}
      role="img"
      aria-label={scramble}
    >
      {"clock" in drawing ? (
        <Clock clock={drawing.clock} />
      ) : (
        <>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0.35" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity="0.12" />
              <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
              <stop offset="1" stopColor="#000" stopOpacity="0.08" />
            </linearGradient>
          </defs>
          {typeof drawing.body === "string" ? (
            <path data-part="picture-body" d={drawing.body} />
          ) : (
            <g
              data-part="picture-body"
              style={{ strokeWidth: drawing.body.seam }}
            >
              {drawing.body.outlines.map(({ id, points }) => (
                <polygon key={id} points={polygonPoints(points)} />
              ))}
            </g>
          )}
          {drawing.stickers.map(({ id, colour, path, delay }) => (
            <path
              key={id}
              data-sticker={colour}
              d={path}
              style={{ "--d": `${delay}ms` } as StickerStyle}
            />
          ))}
          <g data-part="picture-sheen" fill={`url(#${gradient})`}>
            {drawing.stickers.map(({ id, path }) => (
              <path key={id} d={path} />
            ))}
          </g>
        </>
      )}
    </svg>
  );
}

async function otherDrawing(
  event: EventId,
  alg: string,
): Promise<PictureDrawing | null> {
  if (event === "clock")
    return { viewBox: clockBox, clock: await clockDials(alg) };
  if (event === "sq1") return squareDrawing(alg);
  const { flatDrawing } = await import("./flat");
  return flatDrawing(event, alg);
}

function useDrawing(event: EventId, alg: string) {
  const size = cubeSizes[event];
  const net = useMemo(
    () => (size === undefined ? null : cubeDrawing(size, alg)),
    [size, alg],
  );
  const [loaded, setLoaded] = useState<PictureDrawing | null>(null);
  useEffect(() => {
    if (size !== undefined) return;
    let current = true;
    void otherDrawing(event, alg).then(
      (drawing) => {
        if (current) setLoaded(drawing);
      },
      () => {
        // A failed drawing leaves the timer and the last successful picture usable.
      },
    );
    return () => {
      current = false;
    };
  }, [event, alg, size]);
  return net ?? loaded;
}

export function Picture({
  event,
  scramble,
  alg,
  stepping,
  buttonRef,
  lineRef,
  label,
  zoom,
  onOpen,
  onClosed,
  size = 100,
}: {
  event: EventId;
  scramble: string;
  alg: string;
  stepping: boolean;
  buttonRef: Ref<HTMLButtonElement>;
  lineRef: RefObject<HTMLParagraphElement | null>;
  label: string;
  zoom: ZoomState;
  onOpen: () => void;
  onClosed: () => void;
  /** The picture's size in percent (view-size.ts). */
  size?: number;
}) {
  const source = useRef<SVGSVGElement>(null);
  const drawing = useDrawing(event, alg);
  if (drawing === null) return null;
  const [, , width, height] = drawing.viewBox;

  return (
    <>
      <figure
        data-part="scramble-picture"
        data-size-part="picture"
        data-size={size}
        data-event={event}
        data-no-timer
        data-stepping={stepping ? "" : undefined}
      >
        <button
          ref={buttonRef}
          type="button"
          data-action="picture-enlarge"
          aria-label={label}
          aria-expanded={zoom === "open"}
          onClick={onOpen}
        >
          <Drawing drawing={drawing} scramble={scramble} svgRef={source} />
        </button>
      </figure>
      {zoom !== null && (
        <PictureZoom
          source={source}
          line={lineRef}
          aspect={width / height}
          label={label}
          closing={zoom === "closing"}
          onClosed={onClosed}
        >
          <Drawing drawing={drawing} scramble={scramble} />
        </PictureZoom>
      )}
    </>
  );
}
