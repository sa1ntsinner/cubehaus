import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";

const domNames = new Set(["document", "window"]);
const unknown = Symbol("unknown");

function domMember(node) {
  return (
    node?.type === "MemberExpression" &&
    node.object.type === "Identifier" &&
    ["globalThis", "self"].includes(node.object.name) &&
    domNames.has(node.computed ? node.property.value : node.property.name)
  );
}

function safeTypeof(node) {
  return (
    node?.type === "UnaryExpression" &&
    node.operator === "typeof" &&
    ((node.argument.type === "Identifier" &&
      domNames.has(node.argument.name)) ||
      domMember(node.argument))
  );
}

// Evaluate only literal/typeof guards whose value is known in a browser worker.
function staticString(node) {
  if (node?.type === "Literal" && typeof node.value === "string")
    return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked ?? undefined;
  return undefined;
}

function guardValue(node) {
  if (!node) return unknown;
  if (node.type === "Literal") return node.value;
  const text = staticString(node);
  if (text !== undefined) return text;
  if (safeTypeof(node)) return "undefined";
  if (node.type === "UnaryExpression" && node.operator === "!") {
    const value = guardValue(node.argument);
    return value === unknown ? unknown : !value;
  }
  if (node.type === "BinaryExpression") {
    const left = guardValue(node.left);
    const right = guardValue(node.right);
    if (left === unknown || right === unknown) return unknown;
    if (
      (node.operator === "==" || node.operator === "!=") &&
      typeof left !== typeof right
    )
      return unknown;
    switch (node.operator) {
      case "===":
      case "==":
        return left === right;
      case "!==":
      case "!=":
        return left !== right;
      case "<":
        return left < right;
      case ">":
        return left > right;
      case "<=":
        return left <= right;
      case ">=":
        return left >= right;
      default:
        return unknown;
    }
  }
  return unknown;
}

const functionTypes = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

// The function a call runs immediately: `(function(){})()`, `(() => {})()`,
// and `(function(){}).call(this)` or `.apply(...)`.
function invokedFunction(call) {
  const callee = call.callee;
  if (functionTypes.has(callee.type)) return callee;
  if (
    callee.type === "MemberExpression" &&
    functionTypes.has(callee.object.type) &&
    !callee.computed &&
    ["call", "apply"].includes(callee.property.name)
  )
    return callee.object;
  return null;
}

// Flags `document` and `window` only where they run while the module is
// evaluated: at top level or inside an immediately invoked function. A
// function body that nothing calls during evaluation is not visited.
function checkDom(ast, filename) {
  function runFunction(fn) {
    for (const param of fn.params)
      if (param.type === "AssignmentPattern")
        visit(param.right, param, "right");
    visit(fn.body, fn, "body");
  }
  function visit(node, parent, key) {
    if (!node || typeof node !== "object" || !node.type) return false;
    if (safeTypeof(node)) return false;
    if (domMember(node))
      throw new Error(
        `${filename}: DOM reference to ${node.computed ? node.property.value : node.property.name}`,
      );
    if (node.type === "Identifier" && domNames.has(node.name)) {
      const propertyName =
        (parent?.type === "MemberExpression" &&
          key === "property" &&
          !parent.computed) ||
        (parent?.type === "Property" &&
          key === "key" &&
          !parent.computed &&
          !parent.shorthand) ||
        (parent?.type === "MethodDefinition" && key === "key") ||
        (parent?.type === "PropertyDefinition" && key === "key");
      if (!propertyName)
        throw new Error(`${filename}: DOM reference to ${node.name}`);
    }
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportAllDeclaration"
    )
      return false;
    if (node.type === "VariableDeclarator") {
      visit(node.init, node, "init");
      return false;
    }
    if (functionTypes.has(node.type)) return false;
    if (node.type === "CallExpression" || node.type === "NewExpression") {
      const fn = node.type === "CallExpression" ? invokedFunction(node) : null;
      if (fn) runFunction(fn);
      else visit(node.callee, node, "callee");
      for (const argument of node.arguments) visit(argument, node, "arguments");
      return false;
    }
    if (node.type === "BlockStatement" || node.type === "Program") {
      for (const statement of node.body)
        if (visit(statement, node, "body")) return true;
      return false;
    }
    if (node.type === "IfStatement" || node.type === "ConditionalExpression") {
      visit(node.test, node, "test");
      const condition = guardValue(node.test);
      if (condition !== unknown)
        return visit(
          condition ? node.consequent : node.alternate,
          node,
          "branch",
        );
      const first = visit(node.consequent, node, "consequent");
      const second = visit(node.alternate, node, "alternate");
      return first && second;
    }
    if (node.type === "LogicalExpression") {
      visit(node.left, node, "left");
      const left = guardValue(node.left);
      if (
        left !== unknown &&
        ((node.operator === "&&" && !left) || (node.operator === "||" && left))
      )
        return false;
      visit(node.right, node, "right");
      return false;
    }
    for (const [childKey, child] of Object.entries(node)) {
      if (Array.isArray(child)) {
        for (const item of child) visit(item, node, childKey);
      } else visit(child, node, childKey);
    }
    return node.type === "ReturnStatement" || node.type === "ThrowStatement";
  }
  visit(ast);
}

function importsOf(ast, filename) {
  const imports = new Set();
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "ImportExpression") {
      const specifier = staticString(node.source);
      if (specifier === undefined)
        throw new Error(
          `${filename}: dynamic import cannot be checked: ${node.source.type} at ${node.start}`,
        );
      imports.add(specifier);
    } else if (
      [
        "ImportDeclaration",
        "ExportNamedDeclaration",
        "ExportAllDeclaration",
      ].includes(node.type) &&
      typeof node.source?.value === "string"
    )
      imports.add(node.source.value);
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) {
        for (const item of child) visit(item);
      } else if (child && typeof child === "object") visit(child);
    }
  }
  visit(ast);
  return imports;
}

export function checkWorkerGraph(directory) {
  const root = resolve(directory);
  function filesIn(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? filesIn(join(dir, entry.name))
        : [join(dir, entry.name)],
    );
  }
  const entries = filesIn(root).filter((file) =>
    /(?:^|[\\/])search-worker-entry(?:-[\w-]+)?\.js$/.test(file),
  );
  if (!entries.length) throw new Error("No search worker entry found in build");
  const visited = new Set();
  function check(file) {
    if (visited.has(file)) return;
    if (!existsSync(file))
      throw new Error(`Missing worker dependency: ${relative(root, file)}`);
    visited.add(file);
    const ast = parse(readFileSync(file, "utf8"), {
      ecmaVersion: "latest",
      sourceType: "module",
    });
    checkDom(ast, relative(root, file));
    for (const specifier of importsOf(ast, relative(root, file))) {
      if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
        throw new Error(
          `External worker dependency cannot be checked: ${specifier}`,
        );
      }
      const path = specifier.split(/[?#]/)[0];
      const dependency = specifier.startsWith("/")
        ? resolve(root, `.${path}`)
        : resolve(dirname(file), path);
      if (relative(root, dependency).startsWith(".."))
        throw new Error(`Worker dependency outside build: ${specifier}`);
      check(dependency);
    }
  }
  for (const entry of entries) check(entry);
  return { entries: entries.length, files: visited.size };
}

if (import.meta.main) {
  try {
    const result = checkWorkerGraph(
      fileURLToPath(new URL("../dist/", import.meta.url)),
    );
    console.log(
      `Worker check passed (${result.entries} entries, ${result.files} files).`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
