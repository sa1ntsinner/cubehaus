/**
 * The size of each part of the timer screen, in percent, kept per device (DESIGN §8:
 * + and − resize the part under the pointer in steps of 10 % from 70 to 150 %).
 * Pages read them as `data-size` on each part and `--size-<part>` (a plain number,
 * 1 at 100 %) on the timer's `<main>`.
 */
export type ViewPart = "scramble" | "picture" | "time" | "averages" | "times";
export type ViewSizes = Readonly<Record<ViewPart, number>>;

export const VIEW_PARTS: readonly ViewPart[] = [
  "scramble",
  "picture",
  "time",
  "averages",
  "times",
];
export const SIZE_STEP = 10;
export const SIZE_MIN = 70;
export const SIZE_MAX = 150;
/** The setting row that holds the sizes (a device setting, no schema change). */
export const viewSizesKey = "view.sizes.v1";

export const DEFAULT_SIZES: ViewSizes = {
  scramble: 100,
  picture: 100,
  time: 100,
  averages: 100,
  times: 100,
};

const onScale = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= SIZE_MIN &&
  value <= SIZE_MAX &&
  value % SIZE_STEP === 0;

/** A stored value read tolerantly: each part off the scale falls back to 100. */
export function cleanSizes(value: unknown): ViewSizes {
  const stored =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    VIEW_PARTS.map((part) => [
      part,
      onScale(stored[part]) ? stored[part] : DEFAULT_SIZES[part],
    ]),
  ) as ViewSizes;
}

export const isViewSizes = (value: unknown): value is ViewSizes =>
  !!value &&
  typeof value === "object" &&
  VIEW_PARTS.every((part) => onScale((value as Record<string, unknown>)[part]));

/** One step larger or smaller; the same object when the step would leave the range. */
export function stepSize(
  part: ViewPart,
  delta: -1 | 1,
  current: ViewSizes,
): ViewSizes {
  const next = current[part] + delta * SIZE_STEP;
  if (next < SIZE_MIN || next > SIZE_MAX) return current;
  return { ...current, [part]: next };
}

/** Which part + and − act on: the one with the keyboard's focus, else under the pointer. */
export function sizeTarget(
  focused: ViewPart | null,
  hovered: ViewPart | null,
): ViewPart | null {
  return focused ?? hovered;
}

/** The part an element belongs to, by the `data-size-part` its part carries. */
export function partOf(element: Element | null): ViewPart | null {
  const part = element
    ?.closest("[data-size-part]")
    ?.getAttribute("data-size-part");
  return VIEW_PARTS.includes(part as ViewPart) ? (part as ViewPart) : null;
}
