import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import config from "../vite.config.ts";

test("the page reports its worker's build and the worker precaches the stamped HTML", () => {
  const dir = mkdtempSync(join(tmpdir(), "cubehaus-precache-"));
  try {
    const workerPath = join(dir, "sw.js");
    const htmlPath = join(dir, "index.html");
    writeFileSync(workerPath, "[__CUBEHAUS_BUILD__, __CUBEHAUS_FILES__]");
    writeFileSync(htmlPath, "<html><head></head><body></body></html>");

    const plugin = config.plugins.find(
      ({ name }) => name === "cubehaus-offline-precache",
    );
    plugin.writeBundle.handler.call({ info() {} }, { dir });

    const [build, files] = JSON.parse(readFileSync(workerPath, "utf8"));
    const html = readFileSync(htmlPath, "utf8");
    expect(build).toMatch(/^[0-9a-f]{64}$/);
    expect(html).toContain(
      `<meta name="cubehaus-build" content="${build.slice(0, 7)}">`,
    );
    expect(files["index.html"]).toBe(
      `sha256-${createHash("sha256").update(html).digest("base64")}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
