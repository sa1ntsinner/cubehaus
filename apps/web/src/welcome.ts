/**
 * The first run on a touch screen: the controls as small moving pictures, once per
 * device (screens/Welcome.tsx). Closed, it never comes back by itself; Settings › More
 * opens the same pictures as `Guide`.
 */
import { deviceStorage } from "./input/touch-screen";

export const WELCOME_KEY = "cubehaus.welcome";

export function welcomeSeen(): boolean {
  try {
    return deviceStorage()?.getItem(WELCOME_KEY) === "seen";
  } catch {
    return false;
  }
}

export function markWelcomeSeen(): void {
  try {
    deviceStorage()?.setItem(WELCOME_KEY, "seen");
  } catch {
    // A full or closed store: it stays closed for this launch.
  }
}
