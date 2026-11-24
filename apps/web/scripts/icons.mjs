// Renders the app icons into public/ from the house mark (DESIGN.md, Decisions): a white
// 3×3 cube under a roof of two bars, on black. One shape, no colour.
// Run from apps/web: node scripts/icons.mjs [--preview <path prefix>]
// The mark lives in scripts/mark/ as outlines on a 1024 square, in three cuts:
//   mark.svg     the full mark (window and door), for 64 px and up
//   mark-32.svg  drawn for the 32 px grid: sticker 6, gap 1, roof 2, no window or door
//   mark-16.svg  drawn for the 16 px grid: sticker 2, gap 1
// The desktop source (1024 px, macOS plate on a transparent square) then feeds
// `pnpm --filter @cubehaus/desktop exec tauri icon src-tauri/app-icon.png`.
// tauri scales the full mark down for the small sizes; afterwards put the pixel cuts into
// the Mac file: `iconutil -c iconset icons/icon.icns`, copy public/favicon-16.png over
// icon_16x16.png and public/favicon-32.png over icon_16x16@2x.png and icon_32x32.png (and
// over icons/32x32.png), then `iconutil -c icns`.
// The iPhone app's icons are apps/mobile/icon*.png, written here too.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const cut = (name) =>
  readFileSync(here(`mark/${name}.svg`), "utf8").match(/ d="([^"]+)"/)[1];

// The dark theme's tokens (src/design/tokens.css).
const colours = { ground: "#000000", ink: "#ffffff" };
// The plate's corner on a full square, as on iOS: 22.5 % of the side.
const CORNER = 230.4;

// ground: "square" fills the square (the system rounds it), "round" is a rounded plate
// with clear corners (browser tabs), "mac" is the macOS plate (824 of 1024, radius 185),
// "clear" is the mark alone on a transparent square.
// scale shrinks the mark about the centre.
function svg(name, ground, scale = 1) {
  const plate =
    ground === "clear"
      ? ""
      : ground === "mac"
        ? `<rect x="100" y="100" width="824" height="824" rx="185" fill="${colours.ground}" stroke="#262626" stroke-width="4"/>`
        : `<rect width="1024" height="1024"${ground === "round" ? ` rx="${CORNER}"` : ""} fill="${colours.ground}"/>`;
  const at = 512 * (1 - scale);
  const place =
    scale === 1 ? "" : ` transform="translate(${at} ${at}) scale(${scale})"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><title>cubehaus</title>${plate}<path${place} fill="${colours.ink}" fill-rule="evenodd" d="${cut(name)}"/></svg>\n`;
}

const icons = [
  ["favicon-16.png", 16, "mark-16", "round"],
  ["favicon-32.png", 32, "mark-32", "round"],
  ["apple-touch-icon.png", 180, "mark", "square"],
  ["icon-192.png", 192, "mark", "square"],
  ["icon-512.png", 512, "mark", "square"],
  // Maskable: the mark inside the safe circle (80 % of the square).
  ["icon-maskable-512.png", 512, "mark", "square", 0.8],
  // iPhone app: the mark on a full black square, which iOS rounds itself
  // (apps/mobile/icon.png feeds the app icon set).
  ["../../mobile/icon.png", 1024, "mark", "square"],
  // Its dark appearance: the mark alone on a transparent square, over the background the
  // system draws. Its tinted appearance: a grayscale image, which the default already is.
  ["../../mobile/icon-dark.png", 1024, "mark", "clear"],
  ["../../mobile/icon-tinted.png", 1024, "mark", "square"],
  // Desktop source: the mark on the macOS plate.
  ["../../desktop/src-tauri/app-icon.png", 1024, "mark", "mac", 824 / 1024],
];

const preview = process.argv.indexOf("--preview");
const out = (name) =>
  preview === -1
    ? here(`../public/${name}`)
    : `${process.argv[preview + 1]}-${name.split("/").pop()}`;

// The SVG favicon, for browsers that take it: the 32 px cut, since a tab shows it small.
writeFileSync(out("favicon.svg"), svg("mark-32", "round"));
if (preview === -1)
  writeFileSync(here("../../desktop/icon.svg"), svg("mark", "round"));

const browser = await chromium.launch({ args: ["--use-angle=metal"] });
for (const [name, size, mark, ground, scale] of icons) {
  const tab = await browser.newPage({
    viewport: { width: size, height: size },
  });
  await tab.setContent(
    `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg(mark, ground, scale)}`,
  );
  writeFileSync(
    out(name),
    await tab.screenshot({ type: "png", omitBackground: ground !== "square" }),
  );
  await tab.close();
}
await browser.close();
