import { useEffect, useRef, useState } from "react";
import type { AppState } from "../app-state";
import { download } from "../backup-file";
import type { Text } from "../text";
import {
  base64FromBytes,
  checkImage,
  contrastIssues,
  exportTheme,
  IMAGE_STRENGTHS,
  importTheme,
  resolvedTokens,
  THEME_TOKENS,
  type ThemeDocument,
  type ThemeImage,
  type ThemeToken,
} from "../theme-editor";
import "../design/theme-editor.css";

/**
 * The custom theme (Settings, when the theme is Custom): its base, each colour, a picture
 * behind the timer, and the theme as a file. A change that leaves any text under 4.5:1
 * stays in the editor with the reason and is not applied, so the page stays readable.
 */
export function ThemeEditor({
  app,
  saved,
  enabled,
  words,
}: {
  app: AppState;
  saved: ThemeDocument;
  enabled: boolean;
  words: Text;
}) {
  const t = words.themeEditor;
  const [draft, setDraft] = useState(saved);
  const [problem, setProblem] = useState<string | null>(null);
  const [fileStatus, setFileStatus] = useState<
    "savedToDownloads" | "backupFailed" | null
  >(null);
  const savedRef = useRef(saved);
  // A theme saved elsewhere (an import, a restore) replaces the draft.
  useEffect(() => {
    if (savedRef.current !== saved) {
      savedRef.current = saved;
      setDraft(saved);
    }
  }, [saved]);
  const issues = contrastIssues(draft);
  const colours = resolvedTokens(draft);

  const change = (next: ThemeDocument) => {
    setDraft(next);
    setProblem(null);
    setFileStatus(null);
    if (contrastIssues(next).length > 0) return;
    void app.setCustomTheme(next).then((ok) => {
      if (!ok) setProblem(t.saveFailed);
    });
  };
  const setColour = (token: ThemeToken, value: string) =>
    change({ ...draft, tokens: { ...draft.tokens, [token]: value } });

  async function choosePicture(file: File) {
    setFileStatus(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime = checkImage(bytes, file.type || undefined);
      const tones = await toneRange(file);
      // As strong as reads well: the strength in use (20 % at first), or less.
      const first = draft.image?.strength ?? 0.2;
      const strength =
        IMAGE_STRENGTHS.filter((s) => s <= first)
          .reverse()
          .find(
            (s) =>
              contrastIssues({
                ...draft,
                image: { mime, data: "", strength: s, tones },
              }).length === 0,
          ) ?? IMAGE_STRENGTHS[0];
      const image: ThemeImage = {
        mime,
        data: base64FromBytes(bytes),
        strength,
        tones,
      };
      change({ ...draft, image });
    } catch {
      setProblem(t.pictureRefused);
    }
  }

  async function importFile(file: File) {
    setFileStatus(null);
    try {
      const doc = importTheme(await file.text());
      // The tones are measured here again: a file cannot vouch for its own picture.
      const image = doc.image
        ? {
            ...doc.image,
            tones: await toneRange(
              new Blob([bytesOf(doc.image.data)], { type: doc.image.mime }),
            ),
          }
        : null;
      change({ ...doc, image });
    } catch {
      setProblem(t.importRefused);
    }
  }

  return (
    <>
      <h2>{t.title}</h2>
      <ul data-part="theme-editor">
        <li data-setting="theme-base">
          <label htmlFor="theme-base">{t.base}</label>{" "}
          <select
            id="theme-base"
            value={draft.base}
            disabled={!enabled}
            onChange={(event) =>
              change({
                ...draft,
                base: event.currentTarget.value === "light" ? "light" : "dark",
                tokens: {},
              })
            }
          >
            <option value="dark">{words.settings.themeChoices.dark}</option>
            <option value="light">{words.settings.themeChoices.light}</option>
          </select>
        </li>
        {THEME_TOKENS.map((token) => (
          <li key={token} data-setting={`theme-${token}`}>
            <label htmlFor={`theme-${token}`}>{t.token[token]}</label>{" "}
            <span data-part="theme-colour">
              <output htmlFor={`theme-${token}`}>{colours[token]}</output>
              <input
                id={`theme-${token}`}
                type="color"
                value={colours[token]}
                disabled={!enabled}
                data-weak={
                  issues.some((issue) => issue.token === token) || undefined
                }
                onChange={(event) =>
                  setColour(token, event.currentTarget.value)
                }
              />
            </span>
          </li>
        ))}
        <li data-setting="theme-picture">
          <span>{t.picture}</span>{" "}
          <span data-part="theme-picture-actions">
            {draft.image && (
              <button
                type="button"
                data-action="theme-picture-remove"
                disabled={!enabled}
                onClick={() => change({ ...draft, image: null })}
              >
                {t.remove}
              </button>
            )}
            <label data-action="theme-picture">
              {t.choose}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label={t.picture}
                disabled={!enabled}
                onChange={({ currentTarget }) => {
                  const file = currentTarget.files?.[0];
                  currentTarget.value = "";
                  if (file) void choosePicture(file);
                }}
              />
            </label>
          </span>
        </li>
        {draft.image && (
          <li data-setting="theme-strength">
            <label htmlFor="theme-strength">{t.strength}</label>{" "}
            <select
              id="theme-strength"
              value={draft.image.strength}
              disabled={!enabled}
              onChange={(event) =>
                draft.image &&
                change({
                  ...draft,
                  image: {
                    ...draft.image,
                    strength: Number(event.currentTarget.value),
                  },
                })
              }
            >
              {IMAGE_STRENGTHS.map((strength) => (
                <option key={strength} value={strength}>
                  {Math.round(strength * 100)} %
                </option>
              ))}
            </select>
          </li>
        )}
        <li data-setting="theme-file">
          <span>{t.file}</span>{" "}
          <span data-part="theme-picture-actions">
            <button
              type="button"
              data-action="theme-export"
              onClick={() => {
                const writing = download(
                  "cubehaus-theme.json",
                  exportTheme(savedRef.current),
                );
                if (writing) {
                  setFileStatus(null);
                  void writing.then(
                    () => setFileStatus("savedToDownloads"),
                    () => setFileStatus("backupFailed"),
                  );
                }
              }}
            >
              {t.export}
            </button>
            <label data-action="theme-import">
              {t.import}
              <input
                type="file"
                accept=".json,application/json"
                aria-label={t.import}
                disabled={!enabled}
                onChange={({ currentTarget }) => {
                  const file = currentTarget.files?.[0];
                  currentTarget.value = "";
                  if (file) void importFile(file);
                }}
              />
            </label>
          </span>
        </li>
      </ul>
      {(Object.keys(draft.tokens).length > 0 || issues.length > 0) && (
        <button
          type="button"
          data-action="theme-reset-colours"
          disabled={!enabled}
          onClick={() => change({ ...draft, tokens: {} })}
        >
          {t.resetColours}
        </button>
      )}
      <p
        data-part="theme-status"
        role="status"
        data-tone={fileStatus === "savedToDownloads" ? "ok" : undefined}
      >
        {fileStatus
          ? words.settings[fileStatus]
          : issues.length > 0
            ? t.unreadable(
                issues
                  .map((issue) => `${t.token[issue.token]} ${issue.ratio}:1`)
                  .join(", "),
              )
            : problem}
      </p>
    </>
  );
}

function bytesOf(data: string): Uint8Array<ArrayBuffer> {
  const text = atob(data);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/**
 * The picture's darkest and lightest tones (2nd and 98th percentile of relative
 * luminance), read from a 64 px copy. Decoding refuses anything that is not a picture.
 */
async function toneRange(file: Blob): Promise<[number, number]> {
  const bitmap = await createImageBitmap(file, {
    resizeWidth: 64,
    resizeHeight: 64,
  });
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("No canvas");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data } = context.getImageData(0, 0, 64, 64);
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const tones: number[] = [];
  for (let i = 0; i < data.length; i += 4)
    tones.push(
      0.2126 * linear(data[i] as number) +
        0.7152 * linear(data[i + 1] as number) +
        0.0722 * linear(data[i + 2] as number),
    );
  tones.sort((a, b) => a - b);
  const at = (q: number) => tones[Math.floor(q * (tones.length - 1))] as number;
  return [at(0.02), at(0.98)];
}
