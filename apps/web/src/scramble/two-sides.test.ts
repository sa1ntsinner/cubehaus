import { pictureOf, trainerSet } from "@cubehaus/algs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { TwoDiagram, TwoSides } from "./Training";

/**
 * What a PBL tile in Learn lets a person read: for each layer, on how many of the four
 * sides its two stickers are one colour (4 whole, 1 a bar, 0 none), read off the tile's
 * own drawing, face by face, the top layer's row over the bottom's.
 */
function readTile(stickers: string) {
  const markup = renderToStaticMarkup(createElement(TwoSides, { stickers }));
  const drawn = [...markup.matchAll(/data-letter="(\w)"/g)].map((m) => m[1]);
  expect(drawn).toHaveLength(16);
  const kind = (row: 0 | 1) =>
    [0, 1, 2, 3].filter((face) => {
      const at = face * 4 + row * 2;
      return drawn[at] === drawn[at + 1];
    }).length;
  return { top: kind(0), bottom: kind(1) };
}

const KIND = { 4: "whole", 1: "bar", 0: "none" } as const;

test("the five PBL tiles tell the five cases apart: each shows its own layers' bars", () => {
  const cases = trainerSet("two-pbl");
  expect(cases).toHaveLength(5);
  const read = cases.map((c) => readTile(pictureOf(c)));
  read.forEach(({ top, bottom }, i) => {
    const c = cases[i];
    expect(
      `${KIND[top as 0 | 1 | 4]}-${KIND[bottom as 0 | 1 | 4]}`,
      c?.label,
    ).toBe(c?.group);
  });
  expect(new Set(read.map(({ top, bottom }) => `${top}-${bottom}`)).size).toBe(
    5,
  );
});

test("a PBL tile leaves out the top, one colour in every PBL case", () => {
  for (const c of trainerSet("two-pbl")) {
    const markup = renderToStaticMarkup(
      createElement(TwoSides, { stickers: pictureOf(c) }),
    );
    expect(markup, c.label).not.toContain('data-letter="U"');
  }
});

/**
 * A tile of the top in one go with the bottom swapped: the top and both rings, read off
 * the drawing. The bottom ring shows the swap (one bar side by side, none across), and
 * no two tiles of a set are drawn alike.
 */
test("the bottom-swap tiles show their bottom's bars, and no two are drawn alike", () => {
  for (const [set, bars] of [
    ["two-adj", 1],
    ["two-diag", 0],
  ] as const) {
    const drawings = new Set<string>();
    for (const c of trainerSet(set)) {
      const markup = renderToStaticMarkup(
        createElement(TwoDiagram, { stickers: pictureOf(c) }),
      );
      const drawn = [...markup.matchAll(/data-letter="(\w)"/g)].map(
        (m) => m[1],
      );
      // The top's four, then each ring's eight: F R B L, the first sticker of each, then
      // the second.
      expect(drawn, c.label).toHaveLength(20);
      const ring = (r: number) =>
        [0, 1, 2, 3].filter(
          (side) => drawn[4 + r * 8 + side] === drawn[4 + r * 8 + 4 + side],
        ).length;
      expect(ring(1), c.label).toBe(bars);
      drawings.add(drawn.join(""));
    }
    expect(drawings.size).toBe(trainerSet(set).length);
  }
});
