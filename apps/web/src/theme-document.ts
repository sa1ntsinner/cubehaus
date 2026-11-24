/**
 * A custom theme: one of the two built-in themes as its base, the colours the person
 * changed, and an optional picture behind the timer. Stored as one validated document
 * under `theme.custom.v1` in the setting store (so backups carry it), exported and
 * imported as the same JSON through the same validator. Colours are plain `#rrggbb`;
 * the picture is a local PNG, JPEG or WebP, checked by its own bytes, never fetched.
 */

export type ThemeBase = "light" | "dark";
/** The tokens a person may change: the ground, the text, the fills and the hues. */
export const THEME_TOKENS = [
  "ground",
  "ink",
  "dim",
  "gutter",
  "line",
  "prime",
  "double",
  "wide",
  "warn",
  "error",
  "pb",
] as const;
export type ThemeToken = (typeof THEME_TOKENS)[number];
export type ImageMime = "image/png" | "image/jpeg" | "image/webp";
export type ThemeImage = {
  mime: ImageMime;
  /** The file's bytes in base64. */
  data: string;
  /** How strongly it shows through the ground: 0.1 to 0.4. */
  strength: number;
  /** Its darkest and lightest tones (relative luminance, 2nd and 98th percentile). */
  tones: [number, number];
};
export type ThemeDocument = {
  version: 1;
  base: ThemeBase;
  tokens: Partial<Record<ThemeToken, string>>;
  image: ThemeImage | null;
};

export const customThemeKey = "theme.custom.v1";
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const IMAGE_MAX_SIDE = 4096;
export const IMAGE_STRENGTHS = [0.1, 0.2, 0.3, 0.4] as const;

export class ThemeError extends Error {
  readonly reason: "colour" | "image" | "size" | "format";
  constructor(reason: ThemeError["reason"], message: string) {
    super(message);
    this.reason = reason;
  }
}

/** `#rgb` or `#rrggbb` as lowercase `#rrggbb`; anything else is refused. */
export function parseColour(value: unknown): string {
  if (typeof value !== "string") throw new ThemeError("colour", "Not a colour");
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value.trim());
  if (short)
    return `#${short
      .slice(1)
      .map((d) => `${d}${d}`)
      .join("")}`.toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(value.trim())) return value.trim().toLowerCase();
  throw new ThemeError("colour", `Not a colour: ${String(value).slice(0, 40)}`);
}

export function bytesFromBase64(data: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0)
    throw new ThemeError("image", "The picture is not base64");
  const text = atob(data);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length));

/**
 * The picture's kind and size read from its own header, so a file named `.png` that is
 * an SVG or anything else is refused before it is decoded.
 */
export function imageInfo(
  bytes: Uint8Array,
): { mime: ImageMime; width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === "PNG" &&
    ascii(bytes, 12, 4) === "IHDR"
  )
    return {
      mime: "image/png",
      width: view.getUint32(16),
      height: view.getUint32(20),
    };
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    // Walk the markers to the first frame header (SOF0–SOF15 but DHT, JPG, DAC).
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1] as number;
      if (marker === 0xff) {
        at++;
        continue;
      }
      const length = view.getUint16(at + 2);
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      )
        return {
          mime: "image/jpeg",
          height: view.getUint16(at + 5),
          width: view.getUint16(at + 7),
        };
      at += 2 + length;
    }
    return null;
  }
  if (
    bytes.length >= 30 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WEBP"
  ) {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === "VP8X")
      return {
        mime: "image/webp",
        width: 1 + (view.getUint32(24, true) & 0xffffff),
        height: 1 + (view.getUint32(27, true) & 0xffffff),
      };
    if (chunk === "VP8L") {
      const bits = view.getUint32(21, true);
      return {
        mime: "image/webp",
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >> 14) & 0x3fff),
      };
    }
    if (chunk === "VP8 ")
      return {
        mime: "image/webp",
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
  }
  return null;
}

/** Checks a picture's bytes: a raster of the named kind, at most 2 MiB and 4096 px a side. */
export function checkImage(bytes: Uint8Array, mime?: string): ImageMime {
  if (bytes.length > IMAGE_MAX_BYTES)
    throw new ThemeError("size", "The picture is over 2 MB");
  const info = imageInfo(bytes);
  if (!info || (mime !== undefined && info.mime !== mime))
    throw new ThemeError("image", "Not a PNG, JPEG or WebP picture");
  if (
    info.width < 1 ||
    info.height < 1 ||
    info.width > IMAGE_MAX_SIDE ||
    info.height > IMAGE_MAX_SIDE
  )
    throw new ThemeError("size", "The picture is over 4096 px a side");
  return info.mime;
}

/** A theme document from untrusted JSON (a stored row or an imported file), or a ThemeError. */
export function validateTheme(value: unknown): ThemeDocument {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ThemeError("format", "Not a cubehaus theme");
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || (v.base !== "light" && v.base !== "dark"))
    throw new ThemeError("format", "Not a cubehaus theme");
  const tokens: Partial<Record<ThemeToken, string>> = {};
  const given = v.tokens;
  if (!given || typeof given !== "object" || Array.isArray(given))
    throw new ThemeError("format", "Not a cubehaus theme");
  for (const [key, colour] of Object.entries(given)) {
    if (!(THEME_TOKENS as readonly string[]).includes(key))
      throw new ThemeError("format", `Unknown colour ${key.slice(0, 20)}`);
    tokens[key as ThemeToken] = parseColour(colour);
  }
  let image: ThemeImage | null = null;
  if (v.image !== null && v.image !== undefined) {
    const i = v.image as Record<string, unknown>;
    if (typeof i !== "object" || typeof i.data !== "string")
      throw new ThemeError("image", "Not a PNG, JPEG or WebP picture");
    const mime = checkImage(bytesFromBase64(i.data), i.mime as string);
    const strength = IMAGE_STRENGTHS.find((s) => s === i.strength);
    const tones = i.tones;
    if (
      strength === undefined ||
      !Array.isArray(tones) ||
      tones.length !== 2 ||
      !tones.every((t) => typeof t === "number" && t >= 0 && t <= 1) ||
      (tones[0] as number) > (tones[1] as number)
    )
      throw new ThemeError("image", "Not a PNG, JPEG or WebP picture");
    image = {
      mime,
      data: i.data,
      strength,
      tones: [tones[0] as number, tones[1] as number],
    };
  }
  return { version: 1, base: v.base, tokens, image };
}

/** The stored document, or null when there is none or it no longer validates. */
export function parseStoredTheme(text: string | null): ThemeDocument | null {
  if (text === null) return null;
  try {
    return validateTheme(JSON.parse(text));
  } catch {
    return null;
  }
}

interface SettingRows {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/**
 * Validates, then writes the whole document in one setting row. A refused document or a
 * failed write (storage full) throws, and the stored theme stays as it was.
 */
export async function saveTheme(
  store: SettingRows,
  doc: ThemeDocument,
): Promise<ThemeDocument> {
  const valid = validateTheme(doc);
  await store.set(customThemeKey, JSON.stringify(valid));
  return valid;
}

export async function loadTheme(
  store: SettingRows,
): Promise<ThemeDocument | null> {
  return parseStoredTheme(await store.get(customThemeKey));
}
