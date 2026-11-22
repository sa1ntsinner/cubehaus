import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, expect, test, vi } from "vitest";
import { applyTheme, resolveTheme, watchTheme } from "./theme";

function browser(
  stored: string | null,
  systemDark = false,
  custom: string | null = null,
) {
  const props = new Map<string, string>();
  const root = {
    dataset: {} as Record<string, string>,
    style: {
      props,
      setProperty: (name: string, value: string) => props.set(name, value),
      removeProperty: (name: string) => props.delete(name),
    },
  };
  const meta = { content: "" };
  const storage = {
    getItem: vi.fn((key: string) =>
      key === "cubehaus.theme.custom" ? custom : stored,
    ),
    setItem: vi.fn(),
  };
  const scheme = Object.assign(new EventTarget(), { matches: systemDark });
  const document = { documentElement: root, querySelector: () => meta };
  const window = { localStorage: storage, matchMedia: () => scheme };
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  return { root, meta, storage, scheme, window, document };
}

afterEach(() => vi.unstubAllGlobals());

test.each([
  ["system", false, "light"],
  ["system", true, "dark"],
  ["dark", false, "dark"],
  ["dark", true, "dark"],
  ["light", false, "light"],
  ["light", true, "light"],
] as const)("resolves %s with dark system=%s", (choice, system, expected) => {
  expect(resolveTheme(choice, system)).toBe(expected);
});

test("applies the theme and mirrors the choice", () => {
  const { root, meta, storage } = browser(null);
  applyTheme("dark");
  expect(root.dataset).toEqual({ theme: "dark" });
  expect(meta.content).toBe("#000000");
  expect(storage.setItem).toHaveBeenCalledWith("cubehaus.theme", "dark");
});

test.each([
  ["malformed", true, "dark"],
  ["dark", false, "dark"],
  [null, false, "light"],
] as const)(
  "sets the initial theme from mirror %s",
  (mirror, dark, expected) => {
    const { root, meta, window, document } = browser(mirror, dark);
    const html = readFileSync(
      new URL("../index.html", import.meta.url),
      "utf8",
    );
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    runInNewContext(script ?? "", { window, document });
    expect(root.dataset).toEqual({ theme: expected });
    expect(meta.content).toBe(expected === "dark" ? "#000000" : "#ffffff");
  },
);

test("follows system changes until the watcher is removed", () => {
  const { root, scheme } = browser(null);
  const stop = watchTheme("system");
  expect(root.dataset).toEqual({ theme: "light" });
  scheme.matches = true;
  scheme.dispatchEvent(new Event("change"));
  expect(root.dataset).toEqual({ theme: "dark" });
  stop();
  scheme.matches = false;
  scheme.dispatchEvent(new Event("change"));
  expect(root.dataset).toEqual({ theme: "dark" });
  const stopForced = watchTheme("light");
  scheme.matches = true;
  scheme.dispatchEvent(new Event("change"));
  expect(root.dataset).toEqual({ theme: "light" });
  stopForced();
});

test("a custom theme paints its colours and the system choice drops them again", () => {
  const { root, meta, storage, scheme } = browser(null);
  const custom = {
    base: "dark",
    tokens: { ground: "#101820", ink: "#f0f0f0" },
  } as const;
  const stop = watchTheme("custom", true, custom);
  expect(root.dataset).toEqual({ theme: "dark" });
  expect(root.style.props.get("--ground")).toBe("#101820");
  expect(root.style.props.get("--ink")).toBe("#f0f0f0");
  expect(meta.content).toBe("#101820");
  expect(storage.setItem).toHaveBeenCalledWith("cubehaus.theme", "custom");
  expect(storage.setItem).toHaveBeenCalledWith(
    "cubehaus.theme.custom",
    JSON.stringify(custom),
  );
  stop();
  // Reset to the system: the colours go and the system scheme rules again.
  const stopSystem = watchTheme("system");
  expect(root.style.props.size).toBe(0);
  expect(root.dataset).toEqual({ theme: "light" });
  scheme.matches = true;
  scheme.dispatchEvent(new Event("change"));
  expect(root.dataset).toEqual({ theme: "dark" });
  expect(meta.content).toBe("#000000");
  stopSystem();
});

test("the first paint takes a custom theme from its mirror, and ignores a broken one", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
  const good = browser(
    "custom",
    false,
    JSON.stringify({ base: "dark", tokens: { ground: "#101820" } }),
  );
  runInNewContext(script, { window: good.window, document: good.document });
  expect(good.root.dataset).toEqual({ theme: "dark" });
  expect(good.root.style.props.get("--ground")).toBe("#101820");
  expect(good.meta.content).toBe("#101820");
  const broken = browser(
    "custom",
    true,
    JSON.stringify({ base: "dark", tokens: { ground: "url(x)" } }),
  );
  runInNewContext(script, { window: broken.window, document: broken.document });
  expect(broken.root.dataset).toEqual({ theme: "dark" });
  expect(broken.root.style.props.size).toBe(0);
  const missing = browser("custom", false, null);
  runInNewContext(script, {
    window: missing.window,
    document: missing.document,
  });
  expect(missing.root.dataset).toEqual({ theme: "light" });
});
