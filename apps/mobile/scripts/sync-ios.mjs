// Puts the web build into the iOS project, as `cap copy ios` would: the files of
// apps/web/dist in ios/App/App/public, and the runtime config Capacitor reads at launch.
// Capacitor's CLI is not a dependency (its tools carry licences outside the allowed list);
// the native project is committed and its Package.swift pins the Capacitor version.
import {
  cpSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(
  readFileSync(join(root, "capacitor.config.json"), "utf8"),
);
const web = resolve(root, config.webDir);
const app = join(root, "ios/App/App");

if (!existsSync(join(web, "index.html"))) {
  console.error(
    `sync-ios: no build in ${web} (run pnpm --filter @cubehaus/web build)`,
  );
  process.exit(1);
}
rmSync(join(app, "public"), { recursive: true, force: true });
cpSync(web, join(app, "public"), { recursive: true });
writeFileSync(
  join(app, "capacitor.config.json"),
  `${JSON.stringify({ ...config, packageClassList: [] }, null, "\t")}\n`,
);
writeFileSync(
  join(app, "config.xml"),
  `<?xml version='1.0' encoding='utf-8'?>\n<widget version="1.0.0" xmlns="http://www.w3.org/ns/widgets" xmlns:cdv="http://cordova.apache.org/ns/1.0">\n  <access origin="*" />\n</widget>\n`,
);
console.log(`sync-ios: ${web} -> ${join(app, "public")}`);
