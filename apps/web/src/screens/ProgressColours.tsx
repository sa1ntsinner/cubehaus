import {
  CROSS_COLOURS,
  type CrossColour,
  faceOfCrossColour,
  formatAverage,
} from "@cubehaus/core";
import {
  ASSIGN,
  type ColourEntry,
  colourSummary,
  gapTrend,
} from "@cubehaus/stats";
import type { ColourSeries } from "@cubehaus/storage";
import { useMemo } from "react";
import type { Text } from "../text";

/** Points a colour's gap line keeps at most. */
const POINTS = 48;
const WIDTH = 120;
const HEIGHT = 28;

/**
 * Progress by cross colour: each colour the scope's solves were assigned, with its
 * average over its last 24 and how far it is behind the best colour, and that gap over
 * time as one small line under it (down is closing in). Shown only once a solve has a
 * colour; a colour without 12 solves has no average yet.
 */
export function ProgressColours({
  series,
  words,
}: {
  series: ColourSeries;
  words: Text;
}) {
  const model = useMemo(() => {
    const history: ColourEntry<CrossColour>[] = series.colours.map(
      (colour, index) => ({ colour, value: series.values[index] as number }),
    );
    const colours = CROSS_COLOURS.filter((colour) =>
      series.colours.includes(colour),
    );
    const trend = gapTrend(history, colours);
    return {
      standings: colourSummary(history, colours),
      lines: new Map(
        colours.map((colour) => [colour, line(trend.get(colour) ?? [])]),
      ),
    };
  }, [series]);
  if (model.standings.length === 0) return null;
  return (
    <dl data-part="progress-colours" aria-label={words.progress.colours}>
      {model.standings.map(({ colour, n, average, gap }) => {
        const path = model.lines.get(colour);
        return (
          <div key={colour} data-colour={colour}>
            <dt>
              <span
                data-part="cross-swatch"
                data-face={faceOfCrossColour(colour)}
                aria-hidden="true"
              />
              {words.cross.name[colour]}
            </dt>
            <dd>
              {n > 0 && Number.isFinite(average) ? (
                <data value={average} title={`ao${n}`}>
                  {formatAverage(average)}
                </data>
              ) : (
                <data
                  value=""
                  title={words.progress.colourNeeds(ASSIGN.least)}
                  data-empty=""
                >
                  –
                </data>
              )}
              {Number.isFinite(gap) && gap > 0 && (
                <span
                  data-part="progress-colour-gap"
                  data-there={gap <= ASSIGN.thereWithin || undefined}
                >
                  +{Math.round(gap * 100)}%
                </span>
              )}
              {path && (
                <svg
                  data-part="progress-colour-trend"
                  viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                  width={WIDTH}
                  height={HEIGHT}
                  aria-hidden="true"
                >
                  <line x1={0} x2={WIDTH} y1={HEIGHT - 1} y2={HEIGHT - 1} />
                  <path d={path} />
                </svg>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** A colour's gap over time as a path: the floor is no gap, the top its largest. */
function line(points: readonly { index: number; gap: number }[]) {
  if (points.length < 2) return null;
  const top = Math.max(...points.map(({ gap }) => gap));
  if (!(top > 0)) return null;
  const step = Math.max(1, Math.ceil(points.length / POINTS));
  const kept = points.filter(
    (_, i) => i % step === 0 || i === points.length - 1,
  );
  const first = kept[0]?.index ?? 0;
  const span = Math.max(1, (kept.at(-1)?.index ?? 1) - first);
  return kept
    .map(({ index, gap }, i) => {
      const x = ((index - first) / span) * WIDTH;
      const y = HEIGHT - 1 - (Math.max(0, gap) / top) * (HEIGHT - 4);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}
