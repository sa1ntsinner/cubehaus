import { describe, expect, it } from "vitest";
import { statOf } from "./average";
import {
  ASSIGN,
  assignColour,
  type ColourEntry,
  colourAverage,
  colourGaps,
  colourSummary,
  gapTrend,
  seedOf,
} from "./colours";

type C = "white" | "yellow" | "green" | "blue";
const run = (colour: C, values: readonly number[]): ColourEntry<C>[] =>
  values.map((value) => ({ colour, value }));
const repeat = (colour: C, n: number, value: number) =>
  run(
    colour,
    Array.from({ length: n }, () => value),
  );

describe("the numbers", () => {
  it("are the ones the plan names", () => {
    expect(ASSIGN).toEqual({
      block: 12,
      window: 24,
      least: 12,
      mixWithin: 0.25,
      thereWithin: 0.1,
      maxRun: 3,
      gapWeight: 10,
    });
  });
});

describe("colourAverage", () => {
  it("is the app's ao over the last 24, or over all from 12 to 23, else none", () => {
    expect(colourAverage([10, 11])).toBeNaN();
    const eleven = Array.from({ length: 11 }, (_, i) => 10_000 + i);
    expect(colourAverage(eleven)).toBeNaN();
    const twelve = [...eleven, 30_000];
    expect(colourAverage(twelve)).toBe(statOf(twelve, { kind: "ao", n: 12 }));
    const thirty = Array.from({ length: 30 }, (_, i) => 10_000 + 100 * i);
    expect(colourAverage(thirty)).toBe(
      statOf(thirty.slice(-24), { kind: "ao", n: 24 }),
    );
  });

  it("drops two at each end of 24, so two DNFs still count and three make it DNF", () => {
    const base = Array.from({ length: 24 }, () => 12_000);
    expect(colourAverage([...base.slice(2), Infinity, Infinity])).toBe(12_000);
    expect(
      colourAverage([...base.slice(3), Infinity, Infinity, Infinity]),
    ).toBe(Infinity);
  });
});

describe("colourGaps", () => {
  it("is each colour's average over the best one's, less one; none known is infinite", () => {
    const gaps = colourGaps(
      new Map<C, number>([
        ["white", 10_000],
        ["yellow", 12_500],
        ["green", Number.NaN],
        ["blue", Infinity],
      ]),
    );
    expect(gaps.get("white")).toBe(0);
    expect(gaps.get("yellow")).toBeCloseTo(0.25, 10);
    expect(gaps.get("green")).toBe(Infinity);
    expect(gaps.get("blue")).toBe(Infinity);
    expect(
      colourGaps(new Map<C, number>([["white", Number.NaN]])).get("white"),
    ).toBe(Infinity);
  });
});

describe("assignColour", () => {
  const dual: C[] = ["white", "yellow"];

  it("starts on the first colour in play, the main one", () => {
    expect(assignColour({ colours: dual, history: [], seed: 1 })).toEqual({
      colour: "white",
      stage: "block",
    });
  });

  it("keeps a block of one colour for 12, then moves to the colour furthest behind", () => {
    let history = repeat("white", 11, 10_000);
    expect(assignColour({ colours: dual, history, seed: 3 }).colour).toBe(
      "white",
    );
    history = repeat("white", 12, 10_000);
    expect(assignColour({ colours: dual, history, seed: 3 }).colour).toBe(
      "yellow",
    );
    // Yellow 50 % slower: blocks again, the other colour each time.
    history = [...history, ...repeat("yellow", 12, 15_000)];
    expect(assignColour({ colours: dual, history, seed: 3 })).toEqual({
      colour: "white",
      stage: "block",
    });
  });

  it("with more colours, a block goes to the one furthest behind, never the one just done", () => {
    const four: C[] = ["white", "yellow", "green", "blue"];
    const history = [
      ...repeat("white", 12, 10_000),
      ...repeat("yellow", 12, 11_000),
      ...repeat("green", 12, 16_000),
      ...repeat("blue", 12, 14_000),
    ];
    expect(assignColour({ colours: four, history, seed: 5 }).colour).toBe(
      "green",
    );
    const afterGreen = [...history, ...repeat("green", 12, 16_000)];
    expect(
      assignColour({ colours: four, history: afterGreen, seed: 5 }).colour,
    ).toBe("blue");
  });

  it("mixes once every colour is within 25 % of the best", () => {
    const history = [
      ...repeat("white", 24, 10_000),
      ...repeat("yellow", 24, 12_400),
    ];
    expect(assignColour({ colours: dual, history, seed: 9 }).stage).toBe(
      "mixed",
    );
    const slower = [
      ...repeat("white", 24, 10_000),
      ...repeat("yellow", 24, 12_600),
    ];
    expect(
      assignColour({ colours: dual, history: slower, seed: 9 }).stage,
    ).toBe("block");
  });

  it("in the mix, picks by weight: the base weight within 10 %, more with the gap", () => {
    const history = [
      ...repeat("white", 24, 10_000),
      ...repeat("yellow", 24, 12_000),
      // A short run, so no colour is held back.
      ...repeat("white", 1, 10_000),
    ];
    let yellow = 0;
    const rounds = 4000;
    for (let seed = 0; seed < rounds; seed++)
      if (assignColour({ colours: dual, history, seed }).colour === "yellow")
        yellow++;
    // Yellow 20 % behind: weight 1 + 10 × 0.10 = 2 against white's 1, so two in three.
    expect(yellow / rounds).toBeGreaterThan(0.63);
    expect(yellow / rounds).toBeLessThan(0.7);

    const close = [
      ...repeat("white", 24, 10_000),
      ...repeat("yellow", 24, 10_900),
      ...repeat("white", 1, 10_000),
    ];
    let even = 0;
    for (let seed = 0; seed < rounds; seed++)
      if (
        assignColour({ colours: dual, history: close, seed }).colour ===
        "yellow"
      )
        even++;
    // Within 10 %: both there, equal weights.
    expect(even / rounds).toBeGreaterThan(0.46);
    expect(even / rounds).toBeLessThan(0.54);
  });

  it("in the mix, never the same colour more than 3 times in a row", () => {
    const base = [
      ...repeat("white", 24, 10_000),
      ...repeat("yellow", 24, 12_000),
    ];
    const history = [...base, ...repeat("yellow", 3, 12_000)];
    for (let seed = 0; seed < 500; seed++)
      expect(assignColour({ colours: dual, history, seed }).colour).toBe(
        "white",
      );
  });

  it("is the same for the same seed and history", () => {
    const history = [
      ...repeat("white", 24, 10_000),
      ...repeat("yellow", 24, 11_500),
    ];
    for (let seed = 0; seed < 50; seed++)
      expect(assignColour({ colours: dual, history, seed })).toEqual(
        assignColour({ colours: dual, history, seed }),
      );
  });

  it("ignores colours not in play and holds one colour alone", () => {
    const history = [
      ...repeat("green", 30, 9_000),
      ...repeat("white", 5, 10_000),
    ];
    expect(assignColour({ colours: ["yellow"], history, seed: 1 })).toEqual({
      colour: "yellow",
      stage: "block",
    });
    // Green is not in play: it is not the best, and the white block goes on.
    expect(assignColour({ colours: dual, history, seed: 1 }).colour).toBe(
      "white",
    );
  });
});

describe("colourSummary", () => {
  it("each colour with its count, average and gap to the best, in the order asked for", () => {
    const history = [
      ...repeat("yellow", 24, 12_000),
      ...repeat("white", 24, 10_000),
      ...repeat("green", 3, 9_000),
    ];
    expect(colourSummary(history, ["white", "yellow", "green"])).toEqual([
      { colour: "white", count: 24, n: 24, average: 10_000, gap: 0 },
      {
        colour: "yellow",
        count: 24,
        n: 24,
        average: 12_000,
        gap: expect.closeTo(0.2, 10),
      },
      { colour: "green", count: 3, n: 0, average: Number.NaN, gap: Infinity },
    ]);
  });
});

describe("gapTrend", () => {
  it("is each colour's gap to the best after every solve once both have an average", () => {
    const history = [
      ...repeat("white", 12, 10_000),
      ...repeat("yellow", 12, 13_000),
      ...repeat("yellow", 24, 11_000),
    ];
    const trend = gapTrend(history, ["white", "yellow"]);
    // White is best throughout: its gap is 0 from when yellow has an average.
    expect(trend.get("white")?.[0]).toEqual({ index: 23, gap: 0 });
    const yellow = trend.get("yellow") ?? [];
    expect(yellow[0]).toEqual({ index: 23, gap: expect.closeTo(0.3, 10) });
    expect(yellow.at(-1)).toEqual({ index: 47, gap: expect.closeTo(0.1, 10) });
    // Gaps only shrink as the faster yellows come in.
    for (let i = 1; i < yellow.length; i++)
      expect(yellow[i]?.gap).toBeLessThanOrEqual(yellow[i - 1]?.gap ?? 0);
  });
});

describe("seedOf", () => {
  it("is a stable 32-bit number for a text", () => {
    expect(seedOf("R U R'")).toBe(seedOf("R U R'"));
    expect(seedOf("R U R'")).not.toBe(seedOf("R U R"));
    expect(Number.isInteger(seedOf(""))).toBe(true);
    expect(seedOf("x")).toBeGreaterThanOrEqual(0);
    expect(seedOf("x")).toBeLessThan(2 ** 32);
  });
});
