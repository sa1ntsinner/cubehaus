import type { clockDials } from "@cubehaus/cube";
import { bounds } from "./geometry";

export type ClockState = Awaited<ReturnType<typeof clockDials>>;

const radius = 20;
const step = 60;
const rim = radius * 1.45;
const lastDial = 2 * step;
const faceSize = lastDial + 2 * rim;
const faceOffset = faceSize + radius * 0.9;
const extent = radius * 1.55;
export const clockBox = bounds(
  [
    [-extent, -extent],
    [faceOffset + lastDial + extent, lastDial + extent],
  ],
  (faceOffset + lastDial + 2 * extent) * 0.012,
);

const pins = [
  ["UL", "UR", 0.5, 0.5],
  ["UR", "UL", 1.5, 0.5],
  ["DL", "DR", 0.5, 1.5],
  ["DR", "DL", 1.5, 1.5],
] as const;

export function Clock({ clock }: { clock: ClockState }) {
  return (["front", "back"] as const).map((side) => {
    const back = side === "back";
    return (
      <g key={side} transform={back ? `translate(${faceOffset} 0)` : undefined}>
        <rect
          data-part="clock-face"
          data-side={side}
          x={-rim}
          y={-rim}
          width={faceSize}
          height={faceSize}
          rx={radius * 1.3}
        />
        {pins.map(([pin, mirrored, col, row]) => (
          <circle
            key={pin}
            data-part="clock-pin"
            data-side={side}
            data-up={
              clock.pins && (back ? !clock.pins[mirrored] : clock.pins[pin])
                ? "true"
                : undefined
            }
            cx={col * step}
            cy={row * step}
            r={radius * 0.17}
            strokeWidth={radius * 0.09}
          />
        ))}
        {clock[side].map((hour, i) => (
          <g
            // biome-ignore lint/suspicious/noArrayIndexKey: a dial's grid position is its identity.
            key={i}
            transform={`translate(${(i % 3) * step} ${Math.floor(i / 3) * step})`}
          >
            <circle data-part="clock-dial" data-side={side} r={radius * 0.92} />
            <circle
              data-part="clock-twelve"
              cy={-radius * 1.2}
              r={radius * 0.09}
            />
            <path
              data-part="clock-hand"
              data-side={side}
              transform={`rotate(${hour * 30})`}
              d={`M0 ${-radius * 0.74} L${radius * 0.13} 0 A${radius * 0.13} ${radius * 0.13} 0 0 1 ${-radius * 0.13} 0 Z`}
            />
          </g>
        ))}
      </g>
    );
  });
}
