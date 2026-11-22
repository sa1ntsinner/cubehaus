import { EVENTS } from "@cubehaus/core";
import { clockDials, cubeState } from "@cubehaus/cube";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Timer } from "../screens/Timer";
import { clockBox } from "./Clock";
import { Drawing } from "./Picture.tsx";
import {
  cubeDrawing,
  cubeSizes,
  movesUpTo,
  pictureSupport,
  placeZoom,
} from "./picture";
import { squareDrawing } from "./square1";

test.each([2, 3, 4, 5, 6, 7])(
  "a %i cube draws six bodies and all of its stickers",
  (size) => {
    const svg = renderToStaticMarkup(
      createElement(Drawing, {
        drawing: cubeDrawing(size, "R"),
        scramble: "R",
      }),
    );
    expect(svg.match(/data-sticker=/g)).toHaveLength(6 * size ** 2);
    expect(svg.match(/data-part="picture-body"/g)).toHaveLength(1);
    const body = svg.match(/data-part="picture-body" d="([^"]+)"/)?.[1];
    expect(body?.match(/M/g)).toHaveLength(6);
  },
);

test("R changes the 3×3 in net order and all sweep delays are in range", () => {
  const svg = renderToStaticMarkup(
    createElement(Drawing, {
      drawing: cubeDrawing(3, "R"),
      scramble: "R",
    }),
  );
  const expected = cubeState(3, "R");
  expect(
    Array.from(svg.matchAll(/data-sticker="([^"]+)"/g), (m) => m[1]),
  ).toEqual([
    ...expected.U,
    ...expected.L,
    ...expected.F,
    ...expected.R,
    ...expected.B,
    ...expected.D,
  ]);
  const delays = Array.from(svg.matchAll(/--d:(\d+)ms/g), (m) => Number(m[1]));
  expect(delays).toHaveLength(54);
  expect(delays.every((delay) => delay >= 0 && delay <= 160)).toBe(true);
});

test("move indices count across Megaminx lines", () => {
  const alg = "R++ D-- U'\nR-- D++ U";
  expect(movesUpTo(alg, 2)).toBe("R++ D-- U'");
  expect(movesUpTo(alg, 3)).toBe("R++ D-- U' R--");
});

test.each([
  [1440, 900, 0, { left: 117, top: 48, width: 1206, height: 804 }],
  [
    400,
    800,
    0,
    {
      left: 48,
      top: 298.6666666666667,
      width: 304,
      height: 202.66666666666666,
    },
  ],
  [1440, 900, 176, { left: 231, top: 200, width: 978, height: 652 }],
])(
  "zoom placement in a %i × %i window with scramble ending at %i",
  (vw, vh, bottom, expected) => {
    expect(placeZoom(vw, vh, 1.5, bottom)).toEqual(expected);
  },
);

const timerProps = {
  scramble: "R F",
  pending: false,
  retry: () => {},
  phase: "idle",
  displayMs: 0,
  newest: undefined,
  justStopped: false,
  pictureButton: null,
  pictureZoom: null,
  onPictureOpen: () => {},
  onPictureClosed: () => {},
} as const;

test("cube events use their net and only Multi-Blind has no picture support", () => {
  expect(
    EVENTS.filter(({ id }) => pictureSupport(id) === "none").map(
      ({ id }) => id,
    ),
  ).toEqual(["333mbf"]);
  const counts = {
    "222": 24,
    "333": 54,
    "333bf": 54,
    "333fm": 54,
    "333oh": 54,
    "444": 96,
    "444bf": 96,
    "555": 150,
    "555bf": 150,
    "666": 216,
    "777": 294,
  };
  for (const { id } of EVENTS) {
    if (!(id in counts)) {
      expect(cubeSizes[id]).toBeUndefined();
      continue;
    }
    const html = renderToStaticMarkup(
      createElement(Timer, { ...timerProps, event: id }),
    );
    expect(html.match(/data-sticker=/g)).toHaveLength(
      counts[id as keyof typeof counts],
    );
    expect(html).toContain('role="img" aria-label="R F"');
  }
});

test("waiting, armed, running, disabled and Multi-Blind omit the figure", () => {
  for (const change of [
    { scramble: null },
    { phase: "ready" },
    { phase: "running" },
    { showPicture: false },
    { event: "333mbf" },
  ] as const) {
    const html = renderToStaticMarkup(
      createElement(Timer, { ...timerProps, event: "333", ...change }),
    );
    expect(html).not.toContain('data-part="scramble-picture"');
  }
});

test("Square-1 keeps the viewBox and turns the second middle half on a slice", async () => {
  const solved = await squareDrawing("");
  const sliced = await squareDrawing("/");
  expect(solved.stickers).toHaveLength(52);
  expect(sliced.stickers).toHaveLength(52);
  expect(sliced.viewBox).toEqual(solved.viewBox);
  const middleColours = (drawing: typeof solved) =>
    drawing.stickers
      .filter(({ id }) => id.startsWith("middle-"))
      .map(({ colour }) => colour);
  const original = middleColours(solved);
  expect(middleColours(sliced)).toEqual([
    ...original.slice(0, 6),
    ...original.slice(6).reverse(),
  ]);
  expect(
    sliced.stickers.every(
      ({ path, delay }) =>
        !/NaN|Infinity/.test(path) && delay >= 0 && delay <= 160,
    ),
  ).toBe(true);
});

test("Clock renders two equal faces, rotates their hands and marks only explicit up pins", async () => {
  const clock = await clockDials("UR3+");
  const svg = renderToStaticMarkup(
    createElement(Drawing, {
      drawing: { viewBox: clockBox, clock },
      scramble: "UR3+",
    }),
  );
  expect(svg.match(/data-part="clock-face"/g)).toHaveLength(2);
  expect(svg.match(/data-part="clock-dial"/g)).toHaveLength(18);
  expect(svg.match(/data-part="clock-twelve"/g)).toHaveLength(18);
  expect(svg.match(/data-part="clock-pin"/g)).toHaveLength(8);
  expect(
    svg.match(
      /data-part="clock-hand" data-side="front" transform="rotate\(90\)"/g,
    ),
  ).toHaveLength(4);
  expect(svg).not.toContain("data-up=");
  const clockWithPins = await clockDials("UR3+ UR");
  const withPins = renderToStaticMarkup(
    createElement(Drawing, {
      drawing: { viewBox: clockBox, clock: clockWithPins },
      scramble: "UR3+ UR",
    }),
  );
  expect(
    withPins.match(/data-part="clock-pin" data-side="front" data-up="true"/g),
  ).toHaveLength(1);
  expect(
    withPins.match(/data-part="clock-pin" data-side="back" data-up="true"/g),
  ).toHaveLength(3);
});
