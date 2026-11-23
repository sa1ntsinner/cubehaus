import { f2lKey, f2lOf } from "@cubehaus/scramble/f2l";
import { f2lState, f2lStickers } from "@cubehaus/scramble/f2l-state";
import { describe, expect, it } from "vitest";
import { f2lFacts, f2lOrder, f2lSections } from "./f2l-order";
import { trainerSet } from "./index";
import type { SetId } from "./types";
import { kpuzzle } from "./verify";

const SLOTS = ["f2l", "f2l-left", "f2l-back", "f2l-back-left"] as const;

/** The case ids as shipped before the order existed: they are stored progress. */
const IDS = [
  "f2l-0000",
  "f2l-0001",
  "f2l-0010",
  "f2l-0011",
  "f2l-0020",
  "f2l-0021",
  "f2l-0030",
  "f2l-0031",
  "f2l-0100",
  "f2l-0101",
  "f2l-0110",
  "f2l-0111",
  "f2l-0120",
  "f2l-0121",
  "f2l-0130",
  "f2l-0131",
  "f2l-0200",
  "f2l-0201",
  "f2l-0210",
  "f2l-0211",
  "f2l-0220",
  "f2l-0221",
  "f2l-0230",
  "f2l-0231",
  "f2l-0080",
  "f2l-0081",
  "f2l-0180",
  "f2l-0181",
  "f2l-0280",
  "f2l-0281",
  "f2l-4000",
  "f2l-4001",
  "f2l-4100",
  "f2l-4101",
  "f2l-4200",
  "f2l-4201",
  "f2l-4081",
  "f2l-4180",
  "f2l-4181",
  "f2l-4280",
  "f2l-4281",
];

describe("F2L order for a learner", () => {
  it("leaves every shipped id as it was", () => {
    expect(trainerSet("f2l").map((c) => c.id)).toEqual(IDS);
    for (const set of SLOTS.slice(1))
      expect(
        trainerSet(set).map((c) => c.id.replace(`${set}-`, "f2l-")),
      ).toEqual(IDS);
  });

  it("puts every case in exactly one section, sections in the stated order", () => {
    for (const set of SLOTS) {
      const order = f2lOrder(set);
      expect(order.map((o) => o.id).sort()).toEqual(
        trainerSet(set)
          .map((c) => c.id)
          .sort(),
      );
      expect(order.map((o) => o.label)).toEqual(
        order.map((_, i) => `F2L ${i + 1}`),
      );
      const sections = f2lSections(set);
      // Each case's section lists it, and no other section does.
      for (const o of order) {
        const holding = sections.filter((s) => s.ids.includes(o.id));
        expect(
          holding.map((s) => s.id),
          o.id,
        ).toEqual([o.section]);
      }
      // Sections in order hold the cases in order, none empty.
      expect(sections.flatMap((s) => s.ids)).toEqual(order.map((o) => o.id));
      for (const s of sections) {
        expect(s.ids.length).toBeGreaterThan(0);
        expect(s.en.length).toBeGreaterThan(0);
        expect(s.ru.length).toBeGreaterThan(0);
      }
    }
  });

  it("groups by where the pieces are, then the corner's twist, then joined, shortest first", () => {
    const where = ["top", "edge", "corner", "slot"];
    const order = f2lOrder("f2l");
    const cases = new Map(trainerSet("f2l").map((c) => [c.id, c]));
    const rank = (id: string) => {
      const f = f2lFacts(id.slice(4));
      return [where.indexOf(f.where), f.twistRank, f.joined ? 0 : 1];
    };
    for (let i = 1; i < order.length; i++) {
      const a = order[i - 1] as (typeof order)[number];
      const b = order[i] as (typeof order)[number];
      const [ra, rb] = [rank(a.id), rank(b.id)];
      const cmp =
        (ra[0] as number) - (rb[0] as number) ||
        (ra[1] as number) - (rb[1] as number) ||
        (ra[2] as number) - (rb[2] as number);
      expect(cmp, `${a.id} before ${b.id}`).toBeLessThanOrEqual(0);
      if (cmp === 0) {
        const ma = cases.get(a.id)?.algs[0]?.metrics;
        const mb = cases.get(b.id)?.algs[0]?.metrics;
        expect((ma?.moves ?? 0) <= (mb?.moves ?? 0), `${a.id} ${b.id}`).toBe(
          true,
        );
      }
    }
    // The same order every time, and the same case n in every slot.
    expect(f2lOrder("f2l")).toEqual(order);
    for (const set of SLOTS.slice(1))
      expect(f2lOrder(set).map((o) => o.id.replace(`${set}-`, "f2l-"))).toEqual(
        order.map((o) => o.id),
      );
  });

  it("reads each fact from the picture: where the cross colour faces, and a joined pair's touching stickers match", async () => {
    for (const id of IDS) {
      const key = id.slice(4);
      const s = f2lState(key);
      const p = f2lStickers(s);
      const f = f2lFacts(key);
      // Where the cross colour (D) is: on the picture, or hidden below the slot.
      const at = [...p]
        .map((c, i) => (c === "D" ? i : -1))
        .filter((i) => i >= 0);
      const face =
        at.length === 0
          ? "down"
          : (at[0] as number) < 9
            ? "up"
            : (at[0] as number) < 18
              ? "front"
              : "right";
      expect(f.facing, id).toBe(face);
      // A corner in the slot never touches an edge on top.
      if (f.where === "corner") expect(f.joined).toBe(false);
    }
    // On top, the joined pairs are exactly the two that R U' R' and F' U F put in the slot
    // without first moving them; R U R' and F' U' F start by turning the pair's own layer,
    // so the pairs they insert stand apart.
    const puzzle = await kpuzzle();
    const madeBy = (alg: string) =>
      f2lKey(f2lOf(puzzle.defaultPattern().applyAlg(alg))) as string;
    const joinedTop = IDS.map((id) => id.slice(4)).filter(
      (k) => f2lFacts(k).where === "top" && f2lFacts(k).joined,
    );
    expect(new Set(joinedTop)).toEqual(
      new Set([madeBy("R U R'"), madeBy("F' U' F")]),
    );
    for (const alg of ["R U' R'", "F' U F"])
      expect(f2lFacts(madeBy(alg)).joined, alg).toBe(false);
    // Off the top one pair is joined: the corner right above the slot, cross colour up,
    // over its edge flipped in the slot, each side colour over the same colour. In the slot
    // only the solved pair would match.
    expect(
      IDS.filter(
        (id) =>
          f2lFacts(id.slice(4)).joined && f2lFacts(id.slice(4)).where !== "top",
      ),
    ).toEqual(["f2l-0081"]);
    expect(f2lFacts("0081")).toMatchObject({ where: "edge", facing: "up" });
  });

  it("names every section in both languages and for the slot's own sides", () => {
    const names = (set: SetId) =>
      f2lSections(set as (typeof SLOTS)[number])
        .map((s) => s.en)
        .join(" | ");
    expect(names("f2l")).toMatch(/right/);
    expect(names("f2l-left")).toMatch(/left/);
    expect(names("f2l-left")).not.toMatch(/right/);
    expect(names("f2l-back")).toMatch(/back/);
  });
});
