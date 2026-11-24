// Writes the updater manifest (latest.json) for a release from the signed update files in
// a folder:
//
//   node scripts/release-manifest.mjs <folder> <version> <download base URL> [notes]
//
// It looks for each platform's update file next to its `.sig`:
//   cubehaus.app.tar.gz                 darwin-aarch64 and darwin-x86_64 (one universal app)
//   cubehaus_<v>_amd64.AppImage         linux-x86_64
//   cubehaus_<v>_aarch64.AppImage       linux-aarch64
//   cubehaus_<v>_amd64.deb              linux-x86_64-deb
//   cubehaus_<v>_arm64.deb              linux-aarch64-deb
//   cubehaus_<v>_x64-setup.exe          windows-x86_64
// An app installed from the .deb looks for `linux-<arch>-deb` first and installs that
// package (the updater runs dpkg through pkexec); without it, it would fall back to the
// AppImage entry and refuse it as not a .deb. The AppImage reads `linux-<arch>`.
// It fails when a `.sig` is missing or the folder has no update file at all. The
// signature is the contents of the `.sig` file, not its path.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [folder, version, base, notes = ""] = process.argv.slice(2);
if (!folder || !version || !base) {
  console.error(
    "usage: node scripts/release-manifest.mjs <folder> <version> <download base URL> [notes]",
  );
  process.exit(2);
}
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
  console.error(`release-manifest: not a version: ${version}`);
  process.exit(2);
}

const rules = [
  [/^cubehaus\.app\.tar\.gz$/, ["darwin-aarch64", "darwin-x86_64"]],
  [/_(amd64|x86_64)\.AppImage$/, ["linux-x86_64"]],
  [/_aarch64\.AppImage$/, ["linux-aarch64"]],
  [/_amd64\.deb$/, ["linux-x86_64-deb"]],
  [/_arm64\.deb$/, ["linux-aarch64-deb"]],
  [/_x64-setup\.exe$/, ["windows-x86_64"]],
  [/_arm64-setup\.exe$/, ["windows-aarch64"]],
];

const platforms = {};
for (const name of readdirSync(folder).sort()) {
  const rule = rules.find(([pattern]) => pattern.test(name));
  if (!rule) continue;
  if (!name.startsWith("cubehaus.app") && !name.includes(`_${version}_`)) {
    console.error(`release-manifest: ${name} is not version ${version}`);
    process.exit(1);
  }
  const sig = join(folder, `${name}.sig`);
  if (!existsSync(sig)) {
    console.error(`release-manifest: ${name} has no ${name}.sig`);
    process.exit(1);
  }
  const signature = readFileSync(sig, "utf8").trim();
  const url = `${base.replace(/\/$/, "")}/${encodeURIComponent(name)}`;
  for (const platform of rule[1]) {
    if (platforms[platform]) {
      console.error(`release-manifest: two files for ${platform}`);
      process.exit(1);
    }
    platforms[platform] = { url, signature };
  }
}
if (Object.keys(platforms).length === 0) {
  console.error(`release-manifest: no update files in ${folder}`);
  process.exit(1);
}

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  platforms,
};
writeFileSync(
  join(folder, "latest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  `latest.json: ${version}, ${Object.keys(platforms).sort().join(", ")}`,
);
