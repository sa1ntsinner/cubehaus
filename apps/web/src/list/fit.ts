/** What the file measures of itself: its height, the gap between its parts, one line of the
 * list, the parts that always stand with the list (with their gaps), the totals' rule and
 * padding, and each total in order. */
export interface FileRoom {
  room: number;
  gap: number;
  row: number;
  fixed: number;
  totalsChrome: number;
  totals: readonly number[];
}

/**
 * How much of the file fits its room (a phone at large sizes): the list keeps at least one
 * whole line, the totals give way from the last, and a room under one line shows no part of
 * the file, so nothing in it is drawn cut or runs into its neighbours.
 */
export function fitFile(file: FileRoom): {
  lines: boolean;
  totals: number;
  /** The height left to the list, which shows only the whole lines it holds. */
  list: number;
} {
  if (file.row <= 0)
    return { lines: true, totals: file.totals.length, list: file.room };
  for (let count = file.totals.length; count >= 0; count--) {
    const totals =
      count === 0
        ? 0
        : file.totalsChrome +
          file.totals.slice(0, count).reduce((sum, height) => sum + height, 0) +
          file.gap;
    const list = file.room - file.fixed - totals;
    if (list + 0.5 >= file.row) return { lines: true, totals: count, list };
  }
  return { lines: false, totals: 0, list: 0 };
}
