import { F2L_CASES, f2lState, f2lStickers } from "@cubehaus/scramble/f2l-state";
import { F2L_RANKS } from "./data/f2l-ranks";

/**
 * A learner's order for the 41 F2L cases, read from the model, with no published numbering
 * behind it. Cases are grouped by where the pair is (both on top, the edge in the slot, the
 * corner in the slot, both in the slot), then by where the corner's cross colour faces, then
 * by whether the two are already joined; inside a section the shortest main algorithm comes
 * first. Ids never change (they key stored progress); this only gives each case a place, a
 * label `F2L n` in that place and its section. Every slot uses the front right slot's
 * algorithms for the order, so case n is the same case in all four.
 */

export type F2lWhere = "top" | "edge" | "corner" | "slot";
/** Where the corner's cross colour faces, with the corner above or in the slot. */
export type F2lFacing = "up" | "down" | "front" | "right";

export type F2lFacts = {
  where: F2lWhere;
  facing: F2lFacing;
  /** 0, 1, 2: the order of `facing` inside its where-group. */
  twistRank: number;
  /** The edge touches the corner and every face they share shows one colour on both. */
  joined: boolean;
};

const WHERE: readonly F2lWhere[] = ["top", "edge", "corner", "slot"];

/*
 * Sticker places on the 27-letter picture (f2l-state.ts) in the key's frame, where a corner
 * on top stands on place 0 (above the slot): the corner there shows U 8, R 18, F 11; in the
 * slot F 17, R 24 (its D sticker is not drawn). Edges: UF U 7 F 10, UR U 5 R 19, in the slot
 * F 14 R 21; UB and UL touch no corner the key puts the pair's corner on.
 */
const CORNER_AT: Record<number, Record<string, number>> = {
  0: { U: 8, R: 18, F: 11 },
  4: { F: 17, R: 24 },
};
const EDGE_AT: Record<number, Record<string, number>> = {
  0: { U: 7, F: 10 },
  1: { U: 5, R: 19 },
  8: { F: 14, R: 21 },
};

/** The facts of a case key, read from its picture. */
export function f2lFacts(key: string): F2lFacts {
  const s = f2lState(key);
  const p = f2lStickers(s);
  const onTop = s.corner < 4;
  const where: F2lWhere =
    onTop && s.edge < 4
      ? "top"
      : onTop
        ? "edge"
        : s.edge < 4
          ? "corner"
          : "slot";
  const corner = CORNER_AT[s.corner] as Record<string, number>;
  const found = Object.entries(corner).find(([, at]) => p[at] === "D");
  const facing: F2lFacing = found
    ? ({ U: "up", F: "front", R: "right" } as const)[
        found[0] as "U" | "F" | "R"
      ]
    : "down";
  const edge = EDGE_AT[s.edge];
  const shared = edge ? Object.keys(edge).filter((face) => face in corner) : [];
  const joined =
    shared.length === 2 &&
    shared.every(
      (face) => p[corner[face] as number] === p[edge?.[face] as number],
    );
  const ranks: Record<F2lFacing, number> = onTop
    ? { right: 0, front: 1, up: 2, down: 3 }
    : { down: 0, front: 1, right: 2, up: 3 };
  return { where, facing, twistRank: ranks[facing], joined };
}

export type F2lSetId = "f2l" | "f2l-left" | "f2l-back" | "f2l-back-left";

const PREFIX: Record<F2lSetId, string> = {
  f2l: "f2l-",
  "f2l-left": "f2l-left-",
  "f2l-back": "f2l-back-",
  "f2l-back-left": "f2l-back-left-",
};

type Words = { en: string; ru: string };

const WHERE_WORDS: Record<F2lWhere, Words> = {
  top: { en: "Both on top", ru: "Оба наверху" },
  edge: { en: "Edge in the slot", ru: "Ребро в слоте" },
  corner: { en: "Corner in the slot", ru: "Угол в слоте" },
  slot: { en: "Both in the slot", ru: "Оба в слоте" },
};

/** The side a front right picture's F and R stand for in each slot (slotStickers). */
const SIDES: Record<F2lSetId, { front: string; right: string }> = {
  f2l: { front: "F", right: "R" },
  "f2l-left": { front: "F", right: "L" },
  "f2l-back": { front: "R", right: "B" },
  "f2l-back-left": { front: "L", right: "B" },
};
const TOWARDS: Record<string, Words> = {
  F: { en: "to the front", ru: "вперёд" },
  R: { en: "to the right", ru: "вправо" },
  B: { en: "to the back", ru: "назад" },
  L: { en: "to the left", ru: "влево" },
};

function facingWords(set: F2lSetId, facing: F2lFacing): Words {
  if (facing === "up")
    return { en: "cross colour up", ru: "цвет креста вверх" };
  if (facing === "down")
    return { en: "cross colour down", ru: "цвет креста вниз" };
  const side = TOWARDS[SIDES[set][facing]] as Words;
  return { en: `cross colour ${side.en}`, ru: `цвет креста ${side.ru}` };
}

export type F2lPlace = {
  id: string;
  /** `F2L n`, n its place in this order. */
  label: string;
  section: string;
};

export type F2lSection = Words & { id: string; ids: string[] };

const sectionId = (f: F2lFacts) =>
  `${f.where}-${f.facing}-${f.joined ? "joined" : "apart"}`;

/** The front right keys in order: the order every slot shares. */
const ORDER: readonly string[] = (() => {
  const rank = (key: string) => {
    const f = f2lFacts(key);
    return [WHERE.indexOf(f.where), f.twistRank, f.joined ? 0 : 1];
  };
  return F2L_CASES.map((c) => c.key).sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    for (let i = 0; i < 3; i++)
      if (ra[i] !== rb[i]) return (ra[i] as number) - (rb[i] as number);
    const ma = F2L_RANKS[a];
    const mb = F2L_RANKS[b];
    return (
      (ma?.[0] ?? 0) - (mb?.[0] ?? 0) ||
      (ma?.[1] ?? 0) - (mb?.[1] ?? 0) ||
      a.localeCompare(b)
    );
  });
})();

/** The set's cases in a learner's order, each with its label and section. */
export function f2lOrder(set: F2lSetId): F2lPlace[] {
  return ORDER.map((key, i) => ({
    id: `${PREFIX[set]}${key}`,
    label: `F2L ${i + 1}`,
    section: sectionId(f2lFacts(key)),
  }));
}

/**
 * The cases in four groups by where the pair is, in order, for the list in Learn: the
 * sections' first fact alone. The rest (where the cross colour faces, joined or not) is
 * what the picture shows and what the order inside a group follows.
 */
export function f2lGroups(set: F2lSetId): F2lSection[] {
  const out: F2lSection[] = [];
  for (const place of f2lOrder(set)) {
    const where = place.section.split("-")[0] as F2lWhere;
    let group = out[out.length - 1];
    if (group?.id !== where) {
      group = { id: where, ...WHERE_WORDS[where], ids: [] };
      out.push(group);
    }
    group.ids.push(place.id);
  }
  return out;
}

/** The sections in order, named in both languages for the slot's own sides. */
export function f2lSections(set: F2lSetId): F2lSection[] {
  const out: F2lSection[] = [];
  for (const place of f2lOrder(set)) {
    let section = out[out.length - 1];
    if (section?.id !== place.section) {
      const f = f2lFacts(place.id.slice(PREFIX[set].length));
      const where = WHERE_WORDS[f.where];
      const facing = facingWords(set, f.facing);
      // Both in the slot they always touch; there they are only not matched.
      const joined = f.joined
        ? { en: "joined", ru: "соединены" }
        : f.where === "slot"
          ? { en: "not matched", ru: "не совпадают" }
          : { en: "apart", ru: "порознь" };
      section = {
        id: place.section,
        en: `${where.en}, ${facing.en}, ${joined.en}`,
        ru: `${where.ru}, ${facing.ru}, ${joined.ru}`,
        ids: [],
      };
      out.push(section);
    }
    section.ids.push(place.id);
  }
  return out;
}
