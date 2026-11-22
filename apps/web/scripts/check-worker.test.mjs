import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { checkWorkerGraph } from "./check-worker.mjs";

function fixture(files, check) {
  const dir = mkdtempSync(join(tmpdir(), "cubehaus-worker-"));
  try {
    for (const [name, code] of Object.entries(files)) {
      const path = join(dir, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, code);
    }
    check(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const entry = "assets/search-worker-entry-fixture.js";

test("follows static imports, re-exports and literal dynamic imports", () => {
  fixture(
    {
      [entry]:
        'import "./a.js"; export * from "./b.js"; function unused(){ return import("./c.js"); }',
      "assets/a.js": 'export const value = "document window";',
      "assets/b.js": "export const object = { document: 1, window: 2 };",
      "assets/c.js": "export const value = 1;",
    },
    (dir) => expect(checkWorkerGraph(dir)).toEqual({ entries: 1, files: 4 }),
  );
});
test.each([
  "document.createElement('link');",
  "window.dispatchEvent(new Event('error'));",
  "globalThis.document.body;",
  "self['window'].location;",
  "typeof document.body;",
])("rejects unguarded DOM access: %s", (code) => {
  fixture({ [entry]: code }, (dir) =>
    expect(() => checkWorkerGraph(dir)).toThrow(/DOM reference/),
  );
});
test.each([
  'if (typeof document !== "undefined") document.createElement("link");',
  'typeof window < "u" && window.dispatchEvent(new Event("error"));',
  'typeof window === "undefined" ? 1 : window.location;',
  'if (typeof globalThis.document === "object") globalThis.document.body;',
  'function pageOnly(){ if (typeof document === "undefined") return; document.body; }',
])("accepts guarded browser code: %s", (code) => {
  fixture({ [entry]: code }, (dir) =>
    expect(checkWorkerGraph(dir).files).toBe(1),
  );
});
test("rejects DOM access in a transitive, unused dynamic import", () => {
  fixture(
    {
      [entry]: 'import "./a.js";',
      "assets/a.js": 'function unused(){ return import("./bad.js"); }',
      "assets/bad.js": "window.location;",
    },
    (dir) =>
      expect(() => checkWorkerGraph(dir)).toThrow(/bad.js.*DOM reference/),
  );
});
test("rejects a missing chunk", () => {
  fixture({ [entry]: 'import "./missing.js";' }, (dir) =>
    expect(() => checkWorkerGraph(dir)).toThrow(/Missing worker dependency/),
  );
});
test("rejects a build without a worker entry", () => {
  fixture({ "assets/app.js": "document.body;" }, (dir) =>
    expect(() => checkWorkerGraph(dir)).toThrow(/No search worker entry/),
  );
});

test("does not treat coercive comparisons as a false worker guard", () => {
  fixture({ [entry]: "if (0 == false) document.body;" }, (dir) =>
    expect(() => checkWorkerGraph(dir)).toThrow(/DOM reference/),
  );
});

test.each([
  "(function(){ document.body; })();",
  "(() => window.location)();",
  "!function(){ document.body; }();",
  "(function(){ document.body; }).call(this);",
  "(async () => { document.body; })();",
  "(function(){ (function(){ window.location; })(); })();",
  "export const value = (function(){ return document.title; })();",
])("rejects DOM access in an immediately invoked function: %s", (code) => {
  fixture({ [entry]: code }, (dir) =>
    expect(() => checkWorkerGraph(dir)).toThrow(/DOM reference/),
  );
});
test.each([
  "function unused(){ return document.body; }",
  "export function later(){ window.dispatchEvent(new Event('x')); }",
  "const later = () => window.location;",
  "export default class Page { show(){ document.body; } }",
  "(function(){ return function(){ document.body; }; })();",
  "var e=(function(){let e=typeof document<`u`&&document.createElement(`link`).relList;return e})(),a=function(){document.querySelector(`meta`)};",
])("accepts DOM access that does not run at module evaluation: %s", (code) => {
  fixture({ [entry]: code }, (dir) =>
    expect(checkWorkerGraph(dir).files).toBe(1),
  );
});
test("follows a dynamic import of a template literal without expressions", () => {
  fixture(
    {
      [entry]: "function later(){ return import(`./bad.js`); }",
      "assets/bad.js": "window.location;",
    },
    (dir) =>
      expect(() => checkWorkerGraph(dir)).toThrow(/bad.js.*DOM reference/),
  );
});
test.each([
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture is source text containing a template literal.
  "const name = 'a'; import(`./${name}.js`);",
  "const name = './a.js'; import(name);",
  "import('./' + 'a.js');",
])("rejects a dynamic import it cannot follow: %s", (code) => {
  fixture({ [entry]: code }, (dir) =>
    expect(() => checkWorkerGraph(dir)).toThrow(/cannot be checked/),
  );
});
