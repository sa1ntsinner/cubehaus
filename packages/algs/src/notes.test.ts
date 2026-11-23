import { describe, expect, it } from "vitest";
import { pictureOf, trainerSet } from "./index";
import { factsHold, noteFor, sayFacts } from "./notes";

describe("recognition notes", () => {
  for (const set of ["pll", "oll"] as const)
    it(`every ${set.toUpperCase()} note's facts hold on its picture and on no other case`, () => {
      const cases = trainerSet(set);
      for (const c of cases) {
        const picture = pictureOf(c);
        const others = cases
          .filter((o) => o !== c)
          .flatMap((o) => [0, 1, 2, 3].map((t) => pictureOf(o, t)));
        const note = noteFor(set, picture, others);
        // The shipped words are these facts' words, and nothing else.
        expect(c.recognise, c.label).toEqual(
          note ? { en: note.en, ru: note.ru } : null,
        );
        if (!note) continue;
        expect(sayFacts(set, picture, note.facts)).toEqual({
          en: note.en,
          ru: note.ru,
        });
        // Every stated fact holds on the picture Learn shows...
        expect(factsHold(set, picture, note.facts, picture), c.label).toBe(
          true,
        );
        // ...and together they fit no other case, met from any side.
        for (const o of cases)
          if (o !== c)
            for (const t of [0, 1, 2, 3])
              expect(
                factsHold(set, picture, note.facts, pictureOf(o, t)),
                `${c.label} vs ${o.label} turned ${t}`,
              ).toBe(false);
        // One line: one sentence in each language.
        for (const line of [note.en, note.ru]) {
          expect(line).not.toMatch(/\n|\.\s/);
          expect(line.endsWith(".")).toBe(true);
        }
      }
    });

  it("a fact that does not hold is caught", () => {
    const t = trainerSet("pll").find((c) => c.label === "T");
    const picture = pictureOf(t as NonNullable<typeof t>);
    // T has no bar in front.
    expect(factsHold("pll", picture, ["bar-F"], picture)).toBe(false);
    expect(factsHold("pll", picture, ["lights-L"], picture)).toBe(true);
  });
});
