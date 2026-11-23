/**
 * The on-screen keyboard's height, as `--keyboard-inset` on the root, while it shows.
 * iOS Safari lays the keyboard over the page without making the layout viewport shorter,
 * so a sheet fixed to the whole screen keeps its foot, and a field there, under the keys.
 * Only the visual viewport says how much of the page is left above them. A pinch zoom also
 * shrinks the visual viewport; that is not a keyboard.
 */
type Viewport = {
  height: number;
  offsetTop: number;
  scale: number;
  addEventListener(type: "resize" | "scroll", listener: () => void): void;
  removeEventListener(type: "resize" | "scroll", listener: () => void): void;
};
export type KeyboardHost = {
  visualViewport: Viewport | null;
  document: {
    documentElement: {
      /** The layout viewport's height, which the keyboard leaves as it is. */
      clientHeight: number;
      style: {
        setProperty(name: string, value: string): void;
        removeProperty(name: string): void;
      };
    };
  };
};

const NAME = "--keyboard-inset";
/** Less than this is the toolbar growing or shrinking, not a keyboard. */
const KEYBOARD_MIN_PX = 100;

export function trackKeyboardInset(win: KeyboardHost): () => void {
  const viewport = win.visualViewport;
  if (!viewport) return () => {};
  const root = win.document.documentElement;
  const style = root.style;
  const update = () => {
    const covered = Math.round(
      root.clientHeight - viewport.height - viewport.offsetTop,
    );
    if (Math.abs(viewport.scale - 1) < 0.01 && covered > KEYBOARD_MIN_PX)
      style.setProperty(NAME, `${covered}px`);
    else style.removeProperty(NAME);
  };
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  update();
  return () => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
    style.removeProperty(NAME);
  };
}
