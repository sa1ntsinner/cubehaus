import { expect, test } from "vitest";
import { trackKeyboardInset } from "./keyboard-inset";

function fakes(innerHeight = 699) {
  const listeners = new Map<string, Set<() => void>>();
  const props = new Map<string, string>();
  const viewport = {
    height: innerHeight,
    offsetTop: 0,
    scale: 1,
    addEventListener: (type: string, f: () => void) =>
      listeners.set(type, (listeners.get(type) ?? new Set()).add(f)),
    removeEventListener: (type: string, f: () => void) =>
      listeners.get(type)?.delete(f),
  };
  const win = {
    visualViewport: viewport,
    document: {
      documentElement: {
        clientHeight: innerHeight,
        style: {
          setProperty: (name: string, value: string) => props.set(name, value),
          removeProperty: (name: string) => props.delete(name),
        },
      },
    },
  };
  const fire = (type: string) => {
    for (const f of listeners.get(type) ?? []) f();
  };
  const count = () =>
    [...listeners.values()].reduce((n, set) => n + set.size, 0);
  return { win, viewport, props, fire, count };
}

test("the on-screen keyboard's height is the inset, while it shows", () => {
  const f = fakes();
  const stop = trackKeyboardInset(f.win);
  expect(f.props.has("--keyboard-inset")).toBe(false);
  f.viewport.height = 369;
  f.fire("resize");
  expect(f.props.get("--keyboard-inset")).toBe("330px");
  f.viewport.offsetTop = 30;
  f.fire("scroll");
  expect(f.props.get("--keyboard-inset")).toBe("300px");
  f.viewport.height = 699;
  f.viewport.offsetTop = 0;
  f.fire("resize");
  expect(f.props.has("--keyboard-inset")).toBe(false);
  stop();
  expect(f.count()).toBe(0);
});

test("the toolbar growing by a few points is not a keyboard", () => {
  const f = fakes();
  trackKeyboardInset(f.win);
  f.viewport.height = 650;
  f.fire("resize");
  expect(f.props.has("--keyboard-inset")).toBe(false);
});

test("a pinch zoom is not a keyboard", () => {
  const f = fakes();
  trackKeyboardInset(f.win);
  f.viewport.scale = 2;
  f.viewport.height = 349;
  f.fire("resize");
  expect(f.props.has("--keyboard-inset")).toBe(false);
});

test("without a visual viewport nothing happens", () => {
  const f = fakes();
  const stop = trackKeyboardInset({ ...f.win, visualViewport: null });
  stop();
  expect(f.props.size).toBe(0);
});
