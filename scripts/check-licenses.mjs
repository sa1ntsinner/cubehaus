import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fonts = new Map([
  ["roboto.woff2", "OFL-roboto.txt"],
  ["roboto-solid.woff2", "OFL-roboto.txt"],
  ["geistmono.woff2", "OFL-geistmono.txt"],
]);

export function fontLicenseErrors(directory) {
  const root = resolve(directory);
  const licenses = resolve(root, "LICENSES");
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory() && entry.parentPath !== licenses)
    .flatMap((entry) => {
      const license = entry.parentPath === root && fonts.get(entry.name);
      try {
        if (
          license &&
          readFileSync(resolve(licenses, license), "utf8").includes(
            "SIL OPEN FONT LICENSE Version 1.1",
          )
        )
          return [];
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      return [`${entry.name}: missing SIL OFL-1.1 licence text`];
    });
}

const allowed = new Set([
  "MIT",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSD-4-Clause",
  "ISC",
  "Apache-2.0",
  "MPL-2.0",
  "Unlicense",
  "0BSD",
  "CC0-1.0",
]);

// Evaluate SPDX-style AND/OR expressions, with AND binding more tightly.
// Unknown licences and WITH exceptions fail closed; no terms are discarded.
// `extra` widens the list for one check (the Rust crates of the desktop app).
export function isAllowed(expression, extra = new Set()) {
  if (typeof expression !== "string") return false;
  const tokens = expression.match(/[()]|[A-Za-z0-9.+-]+/g) ?? [];
  if (tokens.join("") !== expression.replace(/\s/g, "")) return false;
  let position = 0;

  function term() {
    const token = tokens[position++];
    if (token === "(") {
      const result = either();
      if (tokens[position++] !== ")")
        throw new SyntaxError("Unclosed licence expression");
      return result;
    }
    if (!token || token === ")" || /^(AND|OR|WITH)$/i.test(token)) {
      throw new SyntaxError("Expected licence identifier");
    }
    if (tokens[position]?.toUpperCase() === "WITH") {
      position += 1;
      const exception = tokens[position++];
      if (
        !exception ||
        !/^[A-Za-z0-9.+-]+$/.test(exception) ||
        /^(AND|OR|WITH)$/i.test(exception)
      ) {
        throw new SyntaxError("Expected licence exception");
      }
      return false;
    }
    return allowed.has(token) || extra.has(token);
  }

  function both() {
    let result = term();
    while (tokens[position]?.toUpperCase() === "AND") {
      position += 1;
      const right = term();
      result = result && right;
    }
    return result;
  }

  function either() {
    let result = both();
    while (tokens[position]?.toUpperCase() === "OR") {
      position += 1;
      const right = both();
      result = result || right;
    }
    return result;
  }

  try {
    const result = either();
    return position === tokens.length && result;
  } catch {
    return false;
  }
}

if (import.meta.main) {
  // pnpm 12 lists only the root's dependencies unless recursive is explicit.
  const report = JSON.parse(
    execFileSync(
      "pnpm",
      ["licenses", "list", "--json", "--prod", "--recursive"],
      { encoding: "utf8" },
    ),
  );
  let count = 0;
  for (const [license, packages] of Object.entries(report)) {
    for (const pkg of packages) {
      count += 1;
      if (!isAllowed(license)) {
        console.error(`${pkg.name}@${pkg.versions.join(",")}: ${license}`);
        process.exitCode = 1;
      }
    }
  }
  const fontErrors = fontLicenseErrors(
    fileURLToPath(new URL("../apps/web/public/fonts", import.meta.url)).replace(
      /\/$/,
      "",
    ),
  );
  for (const error of fontErrors) console.error(error);
  if (fontErrors.length) process.exitCode = 1;
  if (!process.exitCode)
    console.log(
      `License check passed (${count} production dependencies and font licences).`,
    );
}
