/** The page fullscreen and back (Shift+F), where the browser allows it. */
export type FullscreenHost = {
  fullscreenEnabled?: boolean;
  fullscreenElement: unknown;
  documentElement: { requestFullscreen?: () => Promise<void> };
  exitFullscreen?: () => Promise<void>;
};

export const canFullscreen = (doc: FullscreenHost) =>
  doc.fullscreenEnabled === true &&
  typeof doc.documentElement.requestFullscreen === "function";

export async function toggleFullscreen(doc: FullscreenHost): Promise<void> {
  if (!canFullscreen(doc)) return;
  try {
    if (doc.fullscreenElement) await doc.exitFullscreen?.();
    else await doc.documentElement.requestFullscreen?.();
  } catch {
    // Refused (no user gesture, a policy): the page stays as it is.
  }
}
