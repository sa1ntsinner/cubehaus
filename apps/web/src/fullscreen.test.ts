import { expect, test, vi } from "vitest";
import { canFullscreen, toggleFullscreen } from "./fullscreen";
import { ACTIONS } from "./keys/actions";
import { validateBindings } from "./keys/keymap";

const page = (enabled: boolean) => {
  const doc = {
    fullscreenEnabled: enabled,
    fullscreenElement: null as unknown,
    documentElement: {
      requestFullscreen: vi.fn(async () => {
        doc.fullscreenElement = doc.documentElement;
      }),
    },
    exitFullscreen: vi.fn(async () => {
      doc.fullscreenElement = null;
    }),
  };
  return doc;
};

test("Shift+F goes fullscreen and back; nothing where the browser has none", async () => {
  const spec = ACTIONS.find((a) => a.id === "view.fullscreen");
  expect(spec?.keys).toEqual(["Shift+KeyF"]);
  expect(validateBindings({}, "mac")).toEqual([]);
  const doc = page(true);
  expect(canFullscreen(doc)).toBe(true);
  await toggleFullscreen(doc);
  expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
  await toggleFullscreen(doc);
  expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
  const none = page(false);
  expect(canFullscreen(none)).toBe(false);
  await toggleFullscreen(none);
  expect(none.documentElement.requestFullscreen).not.toHaveBeenCalled();
});
