import { describe, expect, it } from "vitest";
import { stickerPairRu } from "./collwords";
import { trainerSet } from "./index";
import type { SetId } from "./types";

/**
 * The words of every shipped note, read as a cuber reads them: one term per thing across
 * the sets, short sentences, a colon at most once in a line (DESIGN.md section 17a). The
 * facts behind the words are proven per set (notes, two-notes, algs, f2l-idea tests).
 */
const SETS: readonly SetId[] = [
  "pll",
  "oll",
  "coll",
  "f2l",
  "f2l-left",
  "f2l-back",
  "f2l-back-left",
  "two-oll",
  "two-pbl",
  "two-cll",
  "two-adj",
  "two-diag",
];
const notes = SETS.flatMap((set) =>
  trainerSet(set).flatMap((c) => {
    const note = c.recognise ?? c.idea;
    return note ? [{ at: `${set} ${c.label}`, ...note }] : [];
  }),
);

describe("note words", () => {
  it("every note is one sentence with at most one colon, in both languages", () => {
    expect(notes.length).toBeGreaterThan(300);
    for (const n of notes)
      for (const line of [n.en, n.ru]) {
        expect(line, n.at).toMatch(/^[A-ZА-ЯЁ].*\.$/u);
        expect(line, n.at).not.toMatch(/\.\s/);
        expect(line.split(":").length - 1, `${n.at}: ${line}`).toBeLessThan(2);
      }
  });

  it("the Russian uses one cuber's word for each thing", () => {
    const stiff = [
      // A sticker named only by its end: «левая справа, правая слева».
      /(левая|правая) (спереди|справа|сзади|слева)/,
      /верхнего цвета/,
      /Вверх ни одного/,
      /по бокам без пар/,
      /совпадает по цвету/,
      /два (противоположных|соседних) цвета/,
      /угл(а|ов)? сверху/,
      /стикер/,
      /оба,/,
      /соедините/,
    ];
    for (const n of notes)
      for (const word of stiff) expect(n.ru, n.at).not.toMatch(word);
  });

  it("two stickers are named by their corners and sides", () => {
    expect(stickerPairRu(["FL", "F"], ["BR", "R"], "same")).toBe(
      "наклейки переднего левого угла спереди и заднего правого справа одного цвета",
    );
    expect(stickerPairRu(["FR", "R"], ["FL", "L"], "opposite")).toBe(
      "наклейки переднего правого угла справа и переднего левого слева противоположных цветов",
    );
  });

  it("PBL says each layer in a phrase of its own", () => {
    const pbl = trainerSet("two-pbl").map((c) => c.recognise);
    expect(pbl).toContainEqual({
      en: "One bar on top, no bar on the bottom.",
      ru: "Сверху одна полоса, снизу полос нет.",
    });
    expect(pbl).toContainEqual({
      en: "Top solved, no bar on the bottom.",
      ru: "Верх собран, снизу полос нет.",
    });
    // The same kind on both layers is said once in Russian.
    expect(pbl.map((n) => n?.ru)).toEqual(
      expect.arrayContaining([
        "Ни сверху, ни снизу полос нет.",
        "Сверху и снизу по одной полосе.",
      ]),
    );
  });
});
