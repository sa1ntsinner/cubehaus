// Licences of the Rust crates the desktop app ships. Build-only crates
// (build scripts, procedural macros and what only they use) end up in no
// binary, so they are listed but do not fail the check.
import { execFileSync } from "node:child_process";
import { isAllowed } from "./check-licenses.mjs";

// Two more permissive licences, for crates only: Tauri cannot be built
// without them (ICU and unicode-ident under Unicode-3.0 through `url`,
// zlib-rs and foldhash under Zlib). Both ask for the notice to be kept and
// nothing else.
const crateExtra = new Set(["Unicode-3.0", "Zlib"]);

const manifest = new URL(
  "../apps/desktop/src-tauri/Cargo.toml",
  import.meta.url,
).pathname;

const metadata = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--format-version",
      "1",
      "--locked",
      "--manifest-path",
      manifest,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ),
);

const byId = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));

// Walk from the app through normal (not build, not dev) dependency edges,
// and not into procedural macros: those run in the compiler only.
const shipped = new Set();
const queue = [metadata.resolve.root];
while (queue.length > 0) {
  const id = queue.pop();
  if (shipped.has(id)) continue;
  shipped.add(id);
  for (const dep of nodes.get(id)?.deps ?? []) {
    const normal = dep.dep_kinds.some((kind) => kind.kind === null);
    const target = byId.get(dep.pkg);
    const procMacro = target?.targets.some((t) =>
      t.kind.includes("proc-macro"),
    );
    if (normal && !procMacro) queue.push(dep.pkg);
  }
}

let failed = 0;
const buildOnly = [];
for (const pkg of metadata.packages) {
  if (pkg.id === metadata.resolve.root) continue;
  const license = (pkg.license ?? "").replaceAll("/", " OR ");
  if (isAllowed(license, crateExtra)) continue;
  const line = `${pkg.name}@${pkg.version}: ${pkg.license ?? "no licence field"}`;
  if (shipped.has(pkg.id)) {
    console.error(`shipped  ${line}`);
    failed += 1;
  } else {
    buildOnly.push(line);
  }
}
for (const line of buildOnly) console.log(`build only  ${line}`);
console.log(
  `${shipped.size - 1} shipped crates, ${metadata.packages.length - shipped.size} build-only; ${failed} shipped outside the allowed licences.`,
);
if (failed > 0) process.exitCode = 1;
