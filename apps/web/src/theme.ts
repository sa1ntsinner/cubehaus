export type ThemeChoice = "system" | "dark" | "light" | "custom";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return (
    value === "system" ||
    value === "dark" ||
    value === "light" ||
    value === "custom"
  );
}

/** A custom theme's colours as the page paints them: its base and the changed tokens. */
export type CustomColours = {
  readonly base: "dark" | "light";
  readonly tokens: Readonly<Record<string, string>>;
};

export function resolveTheme(
  choice: ThemeChoice,
  systemDark: boolean,
  custom?: CustomColours | null,
): "dark" | "light" {
  if (choice === "custom")
    return custom?.base ?? (systemDark ? "dark" : "light");
  return choice === "system" ? (systemDark ? "dark" : "light") : choice;
}

const systemScheme = "(prefers-color-scheme: dark)";
const mirrorKey = "cubehaus.theme";
const customMirrorKey = "cubehaus.theme.custom";
const HEX = /^#[0-9a-f]{6}$/;
/** The tokens a custom theme may set inline (theme-editor.ts); any other choice clears them. */
const TOKENS = [
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
];

export function readThemeMirror(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(mirrorKey);
    if (isThemeChoice(value)) return value;
  } catch {
    // localStorage may be unavailable.
  }
  return "system";
}

/** The custom colours the first paint used, until the stored theme has loaded. */
export function readCustomMirror(): CustomColours | null {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(customMirrorKey) ?? "null",
    ) as unknown;
    if (
      value &&
      typeof value === "object" &&
      ((value as CustomColours).base === "dark" ||
        (value as CustomColours).base === "light") &&
      typeof (value as CustomColours).tokens === "object"
    )
      return value as CustomColours;
  } catch {
    // A missing or broken mirror: no custom colours yet.
  }
  return null;
}

/**
 * The custom theme's picture behind the timer, off the path to a ready timer: decoded
 * when the page is idle, as a blob URL that is revoked when it changes or goes.
 */
export function showThemeImage(
  image: { mime: string; data: string; strength: number } | null,
): () => void {
  const root = document.documentElement;
  let url: string | null = null;
  let cancelled = false;
  const clear = () => {
    root.removeAttribute("data-image");
    root.style.removeProperty("--ground-image");
    root.style.removeProperty("--image-strength");
  };
  if (!image) {
    clear();
    return () => {};
  }
  const later =
    "requestIdleCallback" in window
      ? (run: () => void) => window.requestIdleCallback(run, { timeout: 1000 })
      : (run: () => void) => window.setTimeout(run, 50);
  later(() => {
    if (cancelled) return;
    try {
      const text = atob(image.data);
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
      url = URL.createObjectURL(new Blob([bytes], { type: image.mime }));
      root.style.setProperty("--ground-image", `url("${url}")`);
      root.style.setProperty("--image-strength", String(image.strength));
      root.setAttribute("data-image", "");
    } catch {
      clear();
    }
  });
  return () => {
    cancelled = true;
    clear();
    if (url) URL.revokeObjectURL(url);
  };
}

export function applyTheme(
  choice: ThemeChoice,
  custom?: CustomColours | null,
): void {
  updateTheme(choice, true, custom ?? null);
}

function updateTheme(
  choice: ThemeChoice,
  mirror: boolean,
  custom: CustomColours | null,
): void {
  const theme = resolveTheme(
    choice,
    window.matchMedia(systemScheme).matches,
    custom,
  );
  const root = document.documentElement;
  root.dataset.theme = theme;
  // Also clears what the first paint's script set from the mirror.
  for (const name of TOKENS) root.style.removeProperty(`--${name}`);
  if (choice === "custom" && custom)
    for (const [name, value] of Object.entries(custom.tokens))
      if (TOKENS.includes(name) && HEX.test(value))
        root.style.setProperty(`--${name}`, value);
  const ground =
    choice === "custom" &&
    custom?.tokens.ground &&
    HEX.test(custom.tokens.ground)
      ? custom.tokens.ground
      : theme === "dark"
        ? "#000000"
        : "#ffffff";
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (meta) meta.content = ground;
  if (!mirror) return;
  try {
    window.localStorage.setItem(mirrorKey, choice);
    if (choice === "custom" && custom)
      window.localStorage.setItem(customMirrorKey, JSON.stringify(custom));
  } catch {
    // The document can still use the setting when localStorage is restricted.
  }
}

export function watchTheme(
  choice: ThemeChoice,
  mirror = true,
  custom: CustomColours | null = null,
): () => void {
  const update = () => updateTheme(choice, mirror, custom);
  update();
  if (choice !== "system" && !(choice === "custom" && !custom)) return () => {};
  const scheme = window.matchMedia(systemScheme);
  scheme.addEventListener("change", update);
  return () => scheme.removeEventListener("change", update);
}
