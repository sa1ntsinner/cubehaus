import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

function integrity(bytes: Buffer | string): string {
  return `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
}

function offlinePrecache(): Plugin {
  return {
    name: "cubehaus-offline-precache",
    apply: "build",
    writeBundle: {
      order: "post",
      handler({ dir }) {
        if (!dir) this.error("The offline build needs an output directory.");
        const workerPath = join(dir, "sw.js");
        const worker = readFileSync(workerPath, "utf8");
        // Read after Vite has written public files and the separate worker builds.
        const paths = readdirSync(dir, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
          .filter((path) => path !== "sw.js") // The browser manages this script itself.
          .sort();
        let size = 0;
        const files = Object.fromEntries(
          paths.map((path) => {
            const bytes = readFileSync(join(dir, path));
            size += bytes.length;
            return [path.split(sep).join("/"), integrity(bytes)];
          }),
        );
        const build = createHash("sha256")
          .update(worker)
          .update(JSON.stringify(files))
          .digest("hex");
        // Derive the build from the unstamped HTML to avoid hashing the ID into itself.
        // The integrity manifest must still match the final HTML served to the page.
        const htmlPath = join(dir, "index.html");
        const original = readFileSync(htmlPath, "utf8");
        const html = original.replace(
          "</head>",
          `<meta name="cubehaus-build" content="${build.slice(0, 7)}">\n</head>`,
        );
        writeFileSync(htmlPath, html);
        files["index.html"] = integrity(html);
        size += Buffer.byteLength(html) - Buffer.byteLength(original);
        writeFileSync(
          workerPath,
          worker
            .replace("__CUBEHAUS_BUILD__", JSON.stringify(build))
            .replace("__CUBEHAUS_FILES__", JSON.stringify(files)),
        );
        this.info(`Precached ${paths.length} files (${size} bytes).`);
      },
    },
  };
}

export default defineConfig({
  base: "./",
  define: { __CUBEHAUS_VERSION__: JSON.stringify(version) },
  plugins: [offlinePrecache()],
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  worker: { format: "es" },
  build: {
    target: "es2023",
    modulePreload: {
      polyfill: false,
      // Discover the startup graph from HTML, including the React runtime. Leave
      // dynamic imports to fetch their own JS, including inside cubing's worker.
      resolveDependencies: (_file, deps, { hostType }) =>
        hostType === "html" ? deps : [],
    },
    rolldownOptions: {
      input: {
        index: fileURLToPath(new URL("index.html", import.meta.url)),
        sw: fileURLToPath(new URL("src/sw.ts", import.meta.url)),
      },
      // cubing.js imports its own search worker entry from the page, then
      // starts a module worker from that file's URL, so the worker loads the
      // page's chunks. Vite's app default (`false`) lets Rolldown merge
      // cubing's shared chunk into the page entry; the worker then imports the
      // page entry and runs `document` code at evaluation. `'strict'` keeps
      // the entry's exports exact, so that chunk stays separate.
      // The preload helper that remains in the worker graph touches `document`
      // only inside functions; scripts/check-worker.mjs verifies this.
      preserveEntrySignatures: "strict",
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /[/\\]node_modules[/\\](?:react|react-dom|scheduler)[/\\]/,
            },
          ],
        },
        entryFileNames: ({ name }) =>
          name === "sw" ? "sw.js" : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
