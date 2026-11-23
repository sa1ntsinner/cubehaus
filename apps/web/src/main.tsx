import { createRoot } from "react-dom/client";
import { App } from "./App";
import { inDesktopApp } from "./db/native";
import { watchOffline } from "./offline";
import { type LoadedSeed, loadSeed } from "./testing/load";
import "./design/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
const app = createRoot(root);
let renderApp: (() => void) | undefined;
// Only the offline specs opt in so other specs can intercept network requests. The desktop
// app runs from its bundled files and updates through its own signed updater, never the
// service worker.
const offlineEnabled =
  import.meta.env.PROD &&
  !inDesktopApp() &&
  (import.meta.env.VITE_TEST_HOOKS !== "1" ||
    new URLSearchParams(location.search).get("test-offline") === "1");
// The offline copy is fetched once the first scramble is on screen and the page is idle
// (or after 8 s at the latest), so it never competes with the first load.
const firstScramble = new Promise<void>((resolve) => {
  const settle = () => {
    observer.disconnect();
    clearTimeout(late);
    if ("requestIdleCallback" in window)
      requestIdleCallback(() => resolve(), { timeout: 2000 });
    else setTimeout(resolve, 200);
  };
  const shown = () =>
    document.querySelector('[data-part="scramble"] [data-move]') !== null;
  const observer = new MutationObserver(() => {
    if (shown()) settle();
  });
  const late = setTimeout(settle, 8000);
  observer.observe(root, { childList: true, subtree: true });
  // Opened on another screen (Settings, Progress, Algorithms): no scramble is coming, so
  // the page's own load is the sign.
  if (!/^#?\/?$/.test(location.hash))
    window.addEventListener("load", settle, { once: true });
});
const offline = offlineEnabled
  ? watchOffline((state) => {
      document.documentElement.dataset.offline = state;
      renderApp?.();
    }, firstScramble)
  : undefined;
const render = (seed?: LoadedSeed) => {
  renderApp = () =>
    app.render(
      <App
        seed={seed}
        applyUpdate={
          document.documentElement.dataset.offline === "update-waiting"
            ? offline?.applyUpdate
            : undefined
        }
      />,
    );
  renderApp();
};
const seed = loadSeed(location.search);
if (seed) void seed.then(render);
else render();
