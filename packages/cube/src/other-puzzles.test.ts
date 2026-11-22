import { puzzles } from "cubing/puzzles";
import { describe, expect, it } from "vitest";
import {
  clockDials,
  type Sq1Layer,
  STICKER_COLOURS,
  square1Layers,
  stickerColours,
} from "./index";

const svgPalette: Record<string, string[]> = {
  U: ["white", "#ffffff"],
  D: ["yellow", "#f4f400"],
  F: ["limegreen", "#44ee00", "#008800"],
  R: ["red", "#ff0000"],
  B: ["#26f", "#2266ff", "#0000ff"],
  L: ["orange", "#ff8000"],
  purple: ["#8800dd"],
  cream: ["#e8d0a0"],
  sky: ["#3399ff"],
  lime: ["#99ff00"],
  pink: ["#ff66cc"],
  grey: ["#888888", "#aaaaaa", "#d8d8d8"],
};

function svgColour(fill: string): string {
  const name = Object.keys(svgPalette).find((name) =>
    svgPalette[name]?.includes(fill.toLowerCase()),
  );
  if (!name) throw new Error(`Unexpected SVG fill ${fill}`);
  return name;
}

const stickered = ["pyraminx", "skewb", "megaminx", "fto"] as const;

describe("stickerColours", () => {
  it("exports the cubehaus colour palette", () => {
    expect(STICKER_COLOURS).toEqual(Object.keys(svgPalette));
  });

  it.each(stickered)(
    "matches every solved %s facelet in cubing.js",
    async (puzzle) => {
      const svg = await puzzles[puzzle]?.svg();
      const expected = new Map(
        [
          ...(svg ?? "").matchAll(
            /id="([\w]+-l\d+-o\d+)"[^>]+style="fill: ([^";]+);?"/g,
          ),
        ].map(([, id = "", fill = ""]) => [id, svgColour(fill)]),
      );
      expect(expected.size).toBe(
        { pyraminx: 36, skewb: 48, megaminx: 180, fto: 72 }[puzzle],
      );
      expect(await stickerColours(puzzle, "")).toEqual(expected);
    },
  );

  it("changes exactly the three tip stickers on a Pyraminx u turn", async () => {
    const solved = await stickerColours("pyraminx", "");
    const turned = await stickerColours("pyraminx", "u");
    expect(
      new Map([...turned].filter(([id, colour]) => solved.get(id) !== colour)),
    ).toEqual(
      new Map([
        ["CORNERS2-l0-o0", "B"],
        ["CORNERS2-l0-o1", "F"],
        ["CORNERS2-l0-o2", "R"],
      ]),
    );
  });

  it.each([
    ["megaminx", "R++ D--", "D++ R--"],
    ["pyraminx", "u r' b", "b' r u'"],
    ["skewb", "R U' L B", "B' L' U R'"],
    ["fto", "U BL' BR", "BR' BL U'"],
  ] as const)("parses %s scramble notation", async (puzzle, alg, inverse) => {
    const solved = await stickerColours(puzzle, "");
    expect(await stickerColours(puzzle, alg)).not.toEqual(solved);
    expect(await stickerColours(puzzle, `${alg} ${inverse}`)).toEqual(solved);
  });

  it("has no stickers for Clock", async () => {
    expect(await stickerColours("clock", "UR3+ y2 ALL2-")).toEqual(new Map());
  });
});

function wedges(layer: Sq1Layer, first: number) {
  const flattened = [];
  for (const piece of layer) {
    for (const [i, slot] of piece.slots.entries()) {
      flattened.push({
        slot,
        top: piece.top,
        side: piece.sides[i],
        edge: piece.kind === "edge",
      });
    }
  }
  return flattened
    .sort((a, b) => a.slot - b.slot)
    .map(({ slot, ...colours }, i) => {
      expect(slot).toBe(first + i);
      return colours;
    });
}

describe("square1Layers", () => {
  it("starts with four corners and four edges on each layer and matches the SVG wedge data", async () => {
    const { top, bottom, middleFlipped } = await square1Layers("");
    expect(middleFlipped).toBe(false);
    for (const layer of [top, bottom]) {
      expect(layer.map(({ kind }) => kind)).toEqual([
        "corner",
        "edge",
        "corner",
        "edge",
        "corner",
        "edge",
        "corner",
        "edge",
      ]);
    }
    const svg = await puzzles.square1?.svg();
    const fills = new Map(
      [
        ...(svg ?? "").matchAll(
          /id="(WEDGES-l\d+-o\d+)" style="fill: ([^";]+)"/g,
        ),
      ].map(([, id = "", fill]) => [id, fill]),
    );
    const expected = Array.from({ length: 24 }, (_, i) => {
      const top = fills.get(`WEDGES-l${i}-o1`) ?? "";
      return {
        edge: top !== fills.get(`WEDGES-l${i}-o2`),
        top: svgColour(top),
        side: svgColour(fills.get(`WEDGES-l${i}-o0`) ?? ""),
      };
    });
    expect([...wedges(top, 0), ...wedges(bottom, 12)]).toEqual(expected);
  });

  it("shifts the top one slot on (1,0) and leaves the bottom fixed", async () => {
    const solved = await square1Layers("");
    const turned = await square1Layers("(1,0)");
    const original = wedges(solved.top, 0);
    expect(wedges(turned.top, 0)).toEqual([
      original[11],
      ...original.slice(0, 11),
    ]);
    expect(turned.bottom).toEqual(solved.bottom);
    expect(turned.middleFlipped).toBe(false);
  });

  it("swaps top slots 6–11 with bottom slots 12–17 and flips the middle on /", async () => {
    const solved = await square1Layers("");
    const [top, bottom] = [wedges(solved.top, 0), wedges(solved.bottom, 12)];
    const sliced = await square1Layers("/");
    expect(wedges(sliced.top, 0)).toEqual([
      ...top.slice(0, 6),
      ...bottom.slice(0, 6),
    ]);
    expect(wedges(sliced.bottom, 12)).toEqual([
      ...top.slice(6),
      ...bottom.slice(6),
    ]);
    expect(sliced.middleFlipped).toBe(true);
    expect(await square1Layers("/ /")).toEqual(solved);
  });

  it.each([
    "(-1, 0)",
    "(0, 1)",
    "(0, -1) / (0, 1) /",
    "(3, 3) / (3, -3) / (-3, 6) /",
    "(0,-1) / (0,1) / (3,-3) /",
  ])("keeps 12 slots and intact corners per layer after %s", async (alg) => {
    const { top, bottom } = await square1Layers(alg);
    for (const [first, layer] of [
      [0, top],
      [12, bottom],
    ] as const) {
      expect(wedges(layer, first)).toHaveLength(12);
      for (const piece of layer) {
        const [a = NaN, b] = piece.slots;
        expect(piece.sides).toHaveLength(piece.kind === "edge" ? 1 : 2);
        if (piece.kind === "corner")
          expect(b).toBe(first + ((a - first + 1) % 12));
        else expect(piece.slots).toHaveLength(1);
      }
    }
    expect(
      [...top, ...bottom].filter(({ kind }) => kind === "corner"),
    ).toHaveLength(8);
  });

  it("keeps a wraparound corner and its side colours in cyclic slot order", async () => {
    const { top, bottom } = await square1Layers("(-1, 1)");
    expect(top.find((piece) => piece.slots.includes(11))).toEqual({
      kind: "corner",
      slots: [11, 0],
      top: "D",
      sides: ["R", "B"],
    });
    expect(bottom.find((piece) => piece.slots.includes(23))).toEqual({
      kind: "corner",
      slots: [23, 12],
      top: "U",
      sides: ["B", "R"],
    });
  });

  it("rejects a slash that would leave a split corner", async () => {
    await expect(square1Layers("(-1,0) /")).rejects.toThrow(RangeError);
  });
});

describe("clockDials", () => {
  it("returns two solved faces in reading order with unspecified pins", async () => {
    expect(await clockDials("")).toEqual({
      front: Array(9).fill(0),
      back: Array(9).fill(0),
      pins: null,
    });
  });

  it("moves the upper-right four dials and the corresponding back corner on UR3+", async () => {
    expect(await clockDials("UR3+")).toEqual({
      front: [0, 3, 3, 0, 3, 3, 0, 0, 0],
      back: [9, 0, 0, 0, 0, 0, 0, 0, 0],
      pins: null,
    });
  });

  it("parses WCA dial turns, a flip and optional final pins", async () => {
    const turns = "UR3+ y2 ALL2-";
    const expected = {
      front: [7, 10, 10, 10, 10, 10, 10, 10, 10],
      back: [2, 3, 5, 0, 3, 3, 2, 0, 2],
    };
    expect(await clockDials(turns)).toEqual({ ...expected, pins: null });
    expect(await clockDials(`${turns}  UR DL  `)).toEqual({
      ...expected,
      pins: { UL: false, UR: true, DL: true, DR: false },
    });
  });
});
