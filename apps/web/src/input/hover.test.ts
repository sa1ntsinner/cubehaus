import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

// A touch screen keeps the last tap's :hover on whatever lies under the finger after the
// screen changes, and iOS spends a first tap on a hover that reveals something. Every
// :hover rule therefore stands inside `@media (hover: hover)`, where only a pointer that
// can hover sees it (docs/testing/ios-simulator.md).
const ROOT = join(import.meta.dirname, "..");

/** Hover rules that may stand outside the media query, and why. Keep it short. */
const ALLOWED: Record<string, string> = {};

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

/** Every selector with :hover, with the preludes of the blocks around it. */
function hoverRules(css: string): { selector: string; within: string[] }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const found: { selector: string; within: string[] }[] = [];
  const stack: string[] = [];
  let start = 0;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (char === "{") {
      const prelude = text.slice(start, at).trim().replace(/\s+/g, " ");
      if (!prelude.startsWith("@") && prelude.includes(":hover"))
        found.push({ selector: prelude, within: [...stack] });
      stack.push(prelude);
      start = at + 1;
    } else if (char === "}") {
      stack.pop();
      start = at + 1;
    } else if (char === ";") {
      start = at + 1;
    }
  }
  return found;
}

const hovers = (within: string[]) =>
  within.some((prelude) => /^@media\b.*\(hover:\s*hover\)/.test(prelude));

test("the scan sees a bare hover rule and one inside the media query", () => {
  const rules = hoverRules(
    "a:hover { color: red } @media (hover: hover) { b:hover { color: red } } .c { &:hover { x: y } }",
  );
  expect(rules.map((rule) => [rule.selector, hovers(rule.within)])).toEqual([
    ["a:hover", false],
    ["b:hover", true],
    ["&:hover", false],
  ]);
});

test("every :hover rule is for a pointer that can hover", () => {
  const bare = cssFiles(ROOT).flatMap((file) =>
    hoverRules(readFileSync(file, "utf8"))
      .filter((rule) => !hovers(rule.within))
      .map((rule) => `${relative(ROOT, file)}: ${rule.selector}`)
      .filter((line) => !(line in ALLOWED)),
  );
  expect(bare).toEqual([]);
});
