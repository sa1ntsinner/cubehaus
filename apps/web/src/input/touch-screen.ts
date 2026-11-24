/** A screen worked by a finger, with no pointer that hovers: gestures and their hints. */
export function isTouchScreen(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(hover: none) and (pointer: coarse)").matches
  );
}

// Keep the portrait and short landscape rules in step with design/timer.css.
const PHONE_QUERY =
  "(max-width: 699px) and (min-height: 431px) and (hover: none) and (pointer: coarse), " +
  "(max-height: 460px) and (orientation: landscape) and (hover: none) and (pointer: coarse)";

export function isTouchPhone(): boolean {
  return typeof matchMedia === "function" && matchMedia(PHONE_QUERY).matches;
}

export function watchTouchPhone(change: () => void): () => void {
  const media = matchMedia(PHONE_QUERY);
  media.addEventListener("change", change);
  return () => media.removeEventListener("change", change);
}

/** This device's localStorage, or null where reading it throws (a private window). */
export function deviceStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
