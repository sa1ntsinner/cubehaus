import { describe, expect, it } from "vitest";
import { TWO_ADJ } from "./data/two-adj";
import { TWO_CLL } from "./data/two-cll";
import { TWO_DIAG } from "./data/two-diag";
import { SOLVED, twoStickers } from "./two";
import { classesOf, seenKey, stateFromKey, type TwoSet } from "./two-cases";
import { cllFactsHold, cllNote } from "./two-notes";

const SETS = [
  ["two-cll", TWO_CLL, 42],
  ["two-adj", TWO_ADJ, 43],
  ["two-diag", TWO_DIAG, 43],
] as const;

for (const [set, shipped, count] of SETS)
  describe(`2×2 ${set} recognition notes`, () => {
    const classes = classesOf(set as TwoSet).filter(
      (c) => !c.includes(seenKey(set as TwoSet, SOLVED)),
    );
    const classOf = (key: string) => classes.findIndex((c) => c.includes(key));

    it(`every one of the ${count} cases has a note`, () => {
      expect(shipped).toHaveLength(count);
      expect(shipped.filter((c) => !c.recognise).map((c) => c.label)).toEqual(
        [],
      );
    });

    it("each note's facts hold on its picture and together on no other case met from any side", () => {
      for (const c of shipped) {
        const shown = stateFromKey(c.state);
        const others = classes
          .filter((_, i) => i !== classOf(c.state))
          .flat()
          .map(stateFromKey);
        const note = cllNote(shown, others);
        expect(note, c.label).not.toBeNull();
        if (!note) continue;
        // The shipped words are the chosen facts' words.
        expect(c.recognise, c.label).toEqual({ en: note.en, ru: note.ru });
        expect(cllFactsHold(note.facts, shown, shown), c.label).toBe(true);
        for (const other of others)
          expect(
            cllFactsHold(note.facts, shown, other),
            `${c.label} also fits ${twoStickers(other)}`,
          ).toBe(false);
      }
    }, 60_000);

    it("a note reads the top's colour first, then at most three facts", () => {
      for (const c of shipped) {
        const parts = (c.recognise?.en ?? "").split("; ");
        expect(parts.length, c.label).toBeGreaterThanOrEqual(1);
        expect(parts.length, c.label).toBeLessThanOrEqual(5);
        expect(c.recognise?.en, c.label).toMatch(/^(None|One|Two|All) up/);
        expect(c.recognise?.ru, c.label).toMatch(
          /^(Вверх ни одного|Один|Два|Все)/,
        );
      }
    });
  });
