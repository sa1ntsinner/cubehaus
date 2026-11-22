import { describe, expect, it } from "vitest";
import { pllArrows } from "./arrows";
import { pictureOf, trainerSet } from "./index";
import { recolour } from "./show";

const pll = trainerSet("pll");
const byLabel = (label: string) => {
  const c = pll.find((x) => x.label === label);
  if (!c) throw new Error(label);
  return c;
};
const key = (a: { piece: string; from: number; to: number; both: boolean }) =>
  `${a.piece}:${a.both ? [a.from, a.to].sort().join("<>") : `${a.from}>${a.to}`}`;

describe("PLL arrows", () => {
  it("arrows follow each case's permutation", () => {
    for (const c of pll) {
      const arrows = pllArrows(pictureOf(c));
      const corners = arrows.filter((a) => a.piece === "corner");
      const edges = arrows.filter((a) => a.piece === "edge");
      expect(arrows.length, c.label).toBeGreaterThan(0);
      if (c.group === "edges") expect(corners, c.label).toHaveLength(0);
      if (c.group === "corners") expect(edges, c.label).toHaveLength(0);
      if (c.group !== "edges")
        expect(corners.length, c.label).toBeGreaterThan(0);
      if (c.group !== "corners")
        expect(edges.length, c.label).toBeGreaterThan(0);
      // An arrow never points at its own start, and each place is left at most once.
      for (const a of arrows) expect(a.from).not.toBe(a.to);
      const starts = arrows.flatMap((a) =>
        a.both ? [a.from, a.to] : [a.from],
      );
      expect(new Set(starts).size, c.label).toBe(starts.length);
    }
  });

  it("a swap is one arrow with two heads; a three-cycle is three arrows", () => {
    // T, bar on the left: the two right corners swap, and so do the left and right edges.
    expect(
      pllArrows(pictureOf(byLabel("T")))
        .map(key)
        .sort(),
    ).toEqual(["corner:2<>8", "edge:3<>5"]);
    const h = pllArrows(pictureOf(byLabel("H")));
    expect(h.map(key).sort()).toEqual(["edge:1<>7", "edge:3<>5"]);
    const aa = pllArrows(pictureOf(byLabel("Aa")));
    expect(aa).toHaveLength(3);
    expect(aa.every((a) => a.piece === "corner" && !a.both)).toBe(true);
    const ua = pllArrows(pictureOf(byLabel("Ua")));
    expect(ua).toHaveLength(3);
    expect(ua.every((a) => a.piece === "edge" && !a.both)).toBe(true);
  });

  it("a recoloured picture has the same arrows, a turned one the same arrows turned", () => {
    // A U turn moves the top's places: back left to back right, and so on round.
    const turn: Record<number, number> = {
      0: 2,
      2: 8,
      8: 6,
      6: 0,
      1: 5,
      5: 7,
      7: 3,
      3: 1,
    };
    const moved = (picture: string) =>
      pllArrows(picture).reduce((n, a) => n + (a.both ? 2 : 1), 0);
    for (const c of pll) {
      const arrows = pllArrows(pictureOf(c)).map(key).sort();
      for (let k = 1; k < 4; k++)
        expect(
          pllArrows(recolour(pictureOf(c), k))
            .map(key)
            .sort(),
        ).toEqual(arrows);
      // Turned, as many pieces move. N and the like read two ways (the same case with
      // another U turn after); a case with one reading turns its arrows with it.
      expect(moved(pictureOf(c, 1)), c.label).toBe(moved(pictureOf(c)));
    }
    const aa = pllArrows(pictureOf(byLabel("Aa")))
      .map((a) => ({
        ...a,
        from: turn[a.from] as number,
        to: turn[a.to] as number,
      }))
      .map(key)
      .sort();
    expect(
      pllArrows(pictureOf(byLabel("Aa"), 1))
        .map(key)
        .sort(),
    ).toEqual(aa);
  });
});
