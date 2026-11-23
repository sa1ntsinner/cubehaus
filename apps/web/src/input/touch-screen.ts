/** A screen worked by a finger, with no pointer that hovers: gestures and their hints. */
export function isTouchScreen(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(hover: none) and (pointer: coarse)").matches
  );
}

/** This device's localStorage, or null where reading it throws (a private window). */
export function deviceStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
