import {
  type ThemeBase,
  type ThemeDocument,
  ThemeError,
  type ThemeToken,
  validateTheme,
} from "./theme-document";

export * from "./theme-document";

/** The built-in values (tokens.css), the base a custom theme starts from. */
export const BASE_TOKENS: Record<ThemeBase, Record<ThemeToken, string>> = {
  dark: {
    ground: "#000000",
    ink: "#ffffff",
    dim: "#c8c8c8",
    gutter: "#929292",
    line: "#1a1a1a",
    prime: "#ffb878",
    double: "#9ccbff",
    wide: "#c8b0f7",
    warn: "#f0bd4a",
    error: "#ff8f9a",
    pb: "#8ff09a",
  },
  light: {
    ground: "#ffffff",
    ink: "#000000",
    dim: "#454545",
    gutter: "#636363",
    line: "#f2f2f2",
    prime: "#8f3700",
    double: "#0349a0",
    wide: "#6331bd",
    warn: "#735000",
    error: "#ad1420",
    pb: "#116329",
  },
};

export function base64FromBytes(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

export function resolvedTokens(doc: ThemeDocument): Record<ThemeToken, string> {
  return { ...BASE_TOKENS[doc.base], ...doc.tokens };
}

// Contrast (WCAG 2): relative luminance of sRGB, and the ratio of two luminances.
const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const rgb = (hex: string) =>
  [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [
    number,
    number,
    number,
  ];
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(channel) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrastOf = (a: number, b: number) =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** The text colours and the contrast each needs on the ground (DESIGN §2: 4.5:1). */
const TEXT: readonly ThemeToken[] = [
  "ink",
  "dim",
  "gutter",
  "prime",
  "double",
  "wide",
  "warn",
  "error",
  "pb",
];
export const MIN_CONTRAST = 4.5;

export type ContrastIssue = { token: ThemeToken; ratio: number };

/**
 * Every text colour that falls under 4.5:1 on the ground: the plain ground, the ground
 * with the highlight fill under the text (`line`), and with a picture, the ground mixed
 * with the picture's darkest and lightest tones at its strength. The worst case counts.
 */
export function contrastIssues(doc: ThemeDocument): ContrastIssue[] {
  const t = resolvedTokens(doc);
  // Mixing in linear light is close enough for a check at this strength.
  const ground = luminance(t.ground);
  const grounds = [ground, luminance(t.line)];
  if (doc.image)
    for (const tone of doc.image.tones)
      grounds.push(
        ground * (1 - doc.image.strength) + tone * doc.image.strength,
      );
  const issues: ContrastIssue[] = [];
  for (const token of TEXT) {
    const text = luminance(t[token]);
    const ratio = Math.min(...grounds.map((g) => contrastOf(text, g)));
    if (ratio < MIN_CONTRAST)
      issues.push({ token, ratio: Math.floor(ratio * 10) / 10 });
  }
  return issues;
}

/** The document as a file to keep or share. */
export function exportTheme(doc: ThemeDocument): string {
  return `${JSON.stringify({ cubehaus: "theme", ...doc }, null, 2)}\n`;
}

/** A theme file read back; the `cubehaus` marker is optional, the rest validated. */
export function importTheme(text: string): ThemeDocument {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ThemeError("format", "Not a cubehaus theme");
  }
  if (value && typeof value === "object" && "cubehaus" in value) {
    const { cubehaus, ...rest } = value as Record<string, unknown>;
    if (cubehaus !== "theme")
      throw new ThemeError("format", "Not a cubehaus theme");
    value = rest;
  }
  return validateTheme(value);
}
