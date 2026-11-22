// Renders the app icons into public/ from the time's own face (DESIGN.md section 7): the
// timer's zero, solid, white on black. One shape, no colour.
// Run from apps/web: node scripts/icons.mjs [--preview <path prefix>]
// The desktop source (1024 px, macOS plate on a transparent square) then feeds
// `pnpm --filter @cubehaus/desktop exec tauri icon src-tauri/app-icon.png`.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const font = readFileSync(here("../public/fonts/roboto-solid.woff2")).toString(
  "base64",
);

// The dark theme's tokens (src/design/tokens.css).
const colours = { ground: "#000000", ink: "#ffffff" };

// size: the square in px; share: the zero's height as a share of the square;
// plate: draw the ground as a rounded plate (macOS grid: 824 of 1024, radius 185)
// on a transparent square instead of filling the square.
function page(size, share, plate = false) {
  return `<!doctype html><style>
@font-face { font-family: Solid; src: url(data:font/woff2;base64,${font}); font-weight: 700; }
html, body { margin: 0; background: ${plate ? "transparent" : colours.ground}; }
svg { display: block; }
</style>
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"></svg>
<script>
(async () => {
  await document.fonts.load("700 100px Solid");
  const size = ${size}, share = ${share};
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = "700 100px Solid";
  const m = probe.measureText("0");
  const height = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  const em = (100 * size * share) / height;
  const scale = em / 100;
  const top = (size - height * scale) / 2;
  const baseline = top + m.actualBoundingBoxAscent * scale;
  const x = size / 2; // a zero is symmetric: its advance centres it
  const glyph = (attrs) => \`<text x="\${x}" y="\${baseline}" text-anchor="middle" font-family="Solid" font-weight="700" font-size="\${em}" \${attrs}>0</text>\`;
  const inset = size * 100 / 1024;
  const ground = ${plate} ? \`<rect x="\${inset}" y="\${inset}" width="\${size - 2 * inset}" height="\${size - 2 * inset}" rx="\${size * 185 / 1024}" fill="${colours.ground}" stroke="#262626" stroke-width="\${size * 4 / 1024}"/>\` : "";
  document.querySelector("svg").innerHTML = \`
    \${ground}
    \${glyph('fill="${colours.ink}"')}\`;
  document.body.dataset.ready = "";
})();
</script>`;
}

const icons = [
  ["favicon-32.png", 32, 0.86],
  ["apple-touch-icon.png", 180, 0.62],
  ["icon-192.png", 192, 0.62],
  ["icon-512.png", 512, 0.62],
  // Maskable: the mark inside the safe circle (80 % of the square).
  ["icon-maskable-512.png", 512, 0.48],
  // Desktop source: the zero at the same weight on the plate.
  ["../../desktop/src-tauri/app-icon.png", 1024, 0.5, true],
];

// The SVG favicon: the same zero as favicon-32.png (0.86 of the square, centred by its
// advance), as an outline, since an icon cannot load the web font. The outline is the
// glyph "zero" of public/fonts/roboto-solid.woff2 in its own units (em 2048, advance
// 1175, ink 95..1080 by -20..1476), read with fontTools' SVGPathPen.
const ZERO =
  "M1080 856V604Q1080 440 1045.0 321.5Q1010 203 944.5 127.5Q879 52 789.0 16.0Q699 -20 589 -20Q501 -20 425.0 2.5Q349 25 288.5 73.0Q228 121 184.5 194.5Q141 268 118.0 370.0Q95 472 95 604V856Q95 1020 130.5 1137.5Q166 1255 231.5 1330.0Q297 1405 387.0 1440.5Q477 1476 587 1476Q675 1476 750.5 1453.5Q826 1431 887.0 1384.0Q948 1337 991.0 1263.5Q1034 1190 1057.0 1088.5Q1080 987 1080 856ZM791 566V895Q791 974 782.5 1033.0Q774 1092 757.0 1133.5Q740 1175 715.0 1201.0Q690 1227 658.0 1239.0Q626 1251 587 1251Q538 1251 500.5 1232.0Q463 1213 437.0 1171.5Q411 1130 397.5 1061.5Q384 993 384 895V566Q384 487 392.5 427.0Q401 367 418.5 324.5Q436 282 460.5 255.5Q485 229 517.5 217.0Q550 205 589 205Q637 205 674.5 224.5Q712 244 738.5 286.5Q765 329 778.0 398.0Q791 467 791 566Z";
{
  const ink = { top: 1476, bottom: -20, advance: 1175 };
  const square = Math.round((ink.top - ink.bottom) / 0.86);
  const x = square / 2 - ink.advance / 2;
  const y = ink.top + (square - (ink.top - ink.bottom)) / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${square} ${square}"><title>cubehaus</title><rect width="${square}" height="${square}" fill="${colours.ground}"/><path transform="matrix(1 0 0 -1 ${x} ${y})" fill="${colours.ink}" d="${ZERO}"/></svg>\n`;
  const preview = process.argv.indexOf("--preview");
  writeFileSync(
    preview === -1
      ? here("../public/favicon.svg")
      : `${process.argv[preview + 1]}-favicon.svg`,
    svg,
  );
}

const browser = await chromium.launch({ args: ["--use-angle=metal"] });
const preview = process.argv.indexOf("--preview");
for (const [name, size, share, plate] of icons) {
  const tab = await browser.newPage({
    viewport: { width: size, height: size },
  });
  await tab.setContent(page(size, share, plate));
  await tab.waitForSelector("body[data-ready]");
  const png = await tab.screenshot({ type: "png", omitBackground: !!plate });
  const out =
    preview === -1
      ? here(`../public/${name}`)
      : `${process.argv[preview + 1]}-${name.split("/").pop()}`;
  writeFileSync(out, png);
  await tab.close();
}
await browser.close();
