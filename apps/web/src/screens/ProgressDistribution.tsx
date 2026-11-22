import { useEffect, useState } from "react";
import type { ProgressDistribution as Distribution } from "../progress-worker";
import type { Text } from "../text";

/**
 * How the scope's results spread, folded away until asked for: at most 40 bars from the
 * fastest to the slowest, the DNFs counted apart. The worker counts them only on opening.
 */
export function ProgressDistribution({
  load,
  format,
  numbers,
  labels,
}: {
  load: () => Promise<Distribution | null>;
  format: (value: number) => string;
  numbers: Intl.NumberFormat;
  labels: Text["progress"];
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Distribution | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    load().then(
      (next) => live && setData(next),
      () => live && setData(null),
    );
    return () => {
      live = false;
    };
  }, [open, load]);

  const bins = data?.bins ?? [];
  const most = Math.max(1, ...bins.map(({ count }) => count));
  const step =
    bins.length > 1 ? (bins[1]?.start ?? 0) - (bins[0]?.start ?? 0) : 0;
  const first = bins[0];
  const last = bins.at(-1);

  return (
    <details
      data-part="progress-more"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{labels.distribution}</summary>
      {open && data && (
        <div data-part="progress-distribution">
          {first && last && (
            <>
              <svg
                role="img"
                aria-label={labels.distribution}
                viewBox={`0 0 ${bins.length * 10} 100`}
                preserveAspectRatio="none"
                width="100%"
                height="96"
              >
                {bins.map(({ start, count }, index) => (
                  <rect
                    key={start}
                    data-count={count}
                    x={index * 10 + 1}
                    width={8}
                    y={100 - (count / most) * 100}
                    height={(count / most) * 100}
                  >
                    <title>
                      {format(start)} · {numbers.format(count)}
                    </title>
                  </rect>
                ))}
              </svg>
              <p data-part="progress-distribution-axis">
                <span>{format(first.start)}</span>
                {step > 0 && <span>{format(last.start + step)}</span>}
              </p>
            </>
          )}
          {data.dnf > 0 && (
            <p data-part="progress-distribution-dnf">
              {numbers.format(data.dnf)} {labels.dnf}
            </p>
          )}
        </div>
      )}
    </details>
  );
}
