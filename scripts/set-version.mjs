// Sets the app's version in every place that holds it, or checks that they agree:
//
//   node scripts/set-version.mjs <x.y.z> [--build <n>] [--root <folder>]
//   node scripts/set-version.mjs --check [--root <folder>]
//
// The places:
//   package.json, apps/*/package.json, packages/*/package.json   "version"
//   the same files' "workspace:<version>" dependencies, and pnpm-lock.yaml's copies
//   apps/desktop/src-tauri/tauri.conf.json                       "version"
//   apps/desktop/src-tauri/Cargo.toml and Cargo.lock             the cubehaus package
//   apps/mobile/ios/App/App.xcodeproj/project.pbxproj            MARKETING_VERSION and
//                                                                CURRENT_PROJECT_VERSION
//
// A release candidate is `x.y.z-rc.N`. The iPhone project takes only `x.y.z` (Apple
// allows nothing else there). Its build number rises by one whenever the version
// changes, or is set with --build; it never goes down, because App Store Connect
// refuses a build number it has already seen.
//
// Refuses a malformed version, one lower than the current one, and a tree whose places
// already disagree. The same version again changes nothing.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.([1-9]\d*))?$/;

/** [major, minor, patch, rc]; a release sorts after its candidates. */
function parse(version) {
  const match = VERSION.exec(version);
  if (!match) return null;
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    match[4] === undefined ? Number.POSITIVE_INFINITY : Number(match[4]),
  ];
}

/** Negative when `a` is lower than `b`, zero when equal. */
export function compareVersions(a, b) {
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 4; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}

function fail(message) {
  throw new Error(message);
}

/** Folders under `root/<group>` that hold a package.json. */
function members(root, group) {
  const folder = join(root, group);
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${group}/${entry.name}/package.json`)
    .filter((path) => existsSync(join(root, path)))
    .sort();
}

/**
 * Every place a version lives, as {file, what, pattern, kind}. `pattern` has one capture
 * group around the value and the `g` flag; `kind` says which value belongs there.
 */
function places(root) {
  const list = [];
  const packages = [
    "package.json",
    ...members(root, "apps"),
    ...members(root, "packages"),
  ];
  for (const file of packages) {
    list.push({
      file,
      what: "version",
      // The first "version" key at the top level: two spaces of indent.
      pattern: /^ {2}"version": "([^"]+)"/gm,
      kind: "version",
      count: 1,
    });
    list.push({
      file,
      what: "workspace dependencies",
      pattern: /"workspace:(\d[^"]*)"/g,
      kind: "version",
    });
  }
  list.push(
    {
      file: "pnpm-lock.yaml",
      what: "workspace specifiers",
      pattern: /^ +specifier: workspace:(\d\S*)$/gm,
      kind: "version",
    },
    {
      file: "apps/desktop/src-tauri/tauri.conf.json",
      what: "version",
      pattern: /^ {2}"version": "([^"]+)"/gm,
      kind: "version",
      count: 1,
    },
    {
      file: "apps/desktop/src-tauri/Cargo.toml",
      what: "package version",
      pattern: /^\[package\]\nname = "cubehaus"\nversion = "([^"]+)"/gm,
      kind: "version",
      count: 1,
    },
    {
      file: "apps/desktop/src-tauri/Cargo.lock",
      what: "package version",
      pattern: /^\[\[package\]\]\nname = "cubehaus"\nversion = "([^"]+)"/gm,
      kind: "version",
      count: 1,
    },
    {
      file: "apps/mobile/ios/App/App.xcodeproj/project.pbxproj",
      what: "MARKETING_VERSION",
      pattern: /MARKETING_VERSION = ([^;]+);/g,
      kind: "marketing",
      count: 2,
    },
    {
      file: "apps/mobile/ios/App/App.xcodeproj/project.pbxproj",
      what: "CURRENT_PROJECT_VERSION",
      pattern: /CURRENT_PROJECT_VERSION = ([^;]+);/g,
      kind: "build",
      count: 2,
    },
  );
  return list;
}

/** What the tree holds now: {version, build}, or an error naming the places that differ. */
export function readVersions(root) {
  const found = { version: new Map(), marketing: new Map(), build: new Map() };
  for (const place of places(root)) {
    const path = join(root, place.file);
    if (!existsSync(path)) fail(`${place.file} is missing`);
    const values = [...readFileSync(path, "utf8").matchAll(place.pattern)].map(
      (match) => match[1],
    );
    if (place.count !== undefined && values.length !== place.count) {
      fail(
        `${place.file}: ${values.length} ${place.what} found, expected ${place.count}`,
      );
    }
    for (const value of values) {
      const seen = found[place.kind];
      if (!seen.has(value)) seen.set(value, []);
      seen.get(value).push(`${place.file} (${place.what})`);
    }
  }
  const differ = (seen, name) =>
    fail(
      `the ${name} differs between places:\n${[...seen]
        .map(([value, where]) => `  ${value}: ${where.join(", ")}`)
        .join("\n")}`,
    );
  if (found.version.size !== 1) differ(found.version, "version");
  if (found.marketing.size !== 1) differ(found.marketing, "iPhone version");
  if (found.build.size !== 1) differ(found.build, "iPhone build number");
  const [version] = found.version.keys();
  const [marketing] = found.marketing.keys();
  const [build] = found.build.keys();
  if (!parse(version)) fail(`the current version is malformed: ${version}`);
  if (marketing !== version.replace(/-.*$/, "")) {
    fail(`the iPhone version is ${marketing}, the others are ${version}`);
  }
  if (!/^[1-9]\d*$/.test(build)) {
    fail(`the iPhone build number is malformed: ${build}`);
  }
  return { version, build: Number(build) };
}

/**
 * Writes `version` everywhere under `root`. `build` is the iPhone build number; left
 * out, it rises by one when the version changes. Returns what changed.
 */
export function setVersion(root, version, build) {
  if (!parse(version)) {
    fail(`not a version: ${version} (expected x.y.z or x.y.z-rc.N)`);
  }
  const current = readVersions(root);
  if (compareVersions(version, current.version) < 0) {
    fail(`${version} is lower than the current ${current.version}`);
  }
  const changed = version !== current.version;
  const nextBuild = build ?? current.build + (changed ? 1 : 0);
  if (!Number.isInteger(nextBuild) || nextBuild < 1) {
    fail(`not a build number: ${build}`);
  }
  if (nextBuild < current.build) {
    fail(`build ${nextBuild} is lower than the current build ${current.build}`);
  }
  const values = {
    version,
    marketing: version.replace(/-.*$/, ""),
    build: String(nextBuild),
  };
  const files = new Map();
  for (const place of places(root)) {
    const path = join(root, place.file);
    const before = files.get(path) ?? readFileSync(path, "utf8");
    files.set(
      path,
      before.replace(place.pattern, (whole, value) =>
        whole.replace(value, values[place.kind]),
      ),
    );
  }
  let written = 0;
  for (const [path, text] of files) {
    if (text === readFileSync(path, "utf8")) continue;
    writeFileSync(path, text);
    written += 1;
  }
  return {
    from: current,
    to: { version, build: nextBuild },
    files: files.size,
    written,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const take = (flag) => {
    const at = args.indexOf(flag);
    if (at === -1) return undefined;
    const [, value] = args.splice(at, 2);
    if (value === undefined) {
      console.error(`set-version: ${flag} needs a value`);
      process.exit(2);
    }
    return value;
  };
  const root = take("--root") ?? fileURLToPath(new URL("..", import.meta.url));
  const buildText = take("--build");
  const check = args.includes("--check");
  const [version] = args.filter((arg) => arg !== "--check");
  if (check === (version !== undefined) || args.length !== 1) {
    console.error(
      "usage: node scripts/set-version.mjs <x.y.z> [--build <n>] [--root <folder>]\n" +
        "       node scripts/set-version.mjs --check [--root <folder>]",
    );
    process.exit(2);
  }
  if (buildText !== undefined && !/^[1-9]\d*$/.test(buildText)) {
    console.error(`set-version: not a build number: ${buildText}`);
    process.exit(2);
  }
  try {
    if (check) {
      const { version: now, build } = readVersions(root);
      console.log(`set-version: ${now} everywhere, iPhone build ${build}`);
    } else {
      const result = setVersion(
        root,
        version,
        buildText === undefined ? undefined : Number(buildText),
      );
      console.log(
        `set-version: ${result.from.version} (build ${result.from.build}) -> ` +
          `${result.to.version} (build ${result.to.build}), ` +
          `${result.written} of ${result.files} files changed`,
      );
    }
  } catch (error) {
    console.error(`set-version: ${error.message}`);
    process.exit(1);
  }
}
