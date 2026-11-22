/** Bounds are in newest-first order, with last exclusive. */
export function windowOf(
  scrollTop: number,
  viewport: number,
  rowHeight: number,
  count: number,
  overscan = 8,
): { first: number; last: number; offset: number } {
  if (count <= 0 || rowHeight <= 0) return { first: 0, last: 0, offset: 0 };
  const scroll = Math.min(
    Math.max(0, scrollTop),
    Math.max(0, count * rowHeight - viewport),
  );
  const first = Math.max(0, Math.floor(scroll / rowHeight) - overscan);
  const last = Math.min(
    count,
    Math.ceil((scroll + viewport) / rowHeight) + overscan,
  );
  return { first, last, offset: first * rowHeight };
}
