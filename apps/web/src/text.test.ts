import { describe, expect, test } from "vitest";
import { plural, textFor, texts } from "./text";

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return [prefix];
  return Object.entries(value).flatMap(([key, inner]) =>
    keys(inner, prefix ? `${prefix}.${key}` : key),
  );
}

describe("text", () => {
  test("every English string exists in Russian, and no other", () => {
    expect(keys(texts.ru).sort()).toEqual(keys(texts.en).sort());
  });

  test("no Russian string is left in English by mistake", () => {
    const same = keys(texts.en).filter((key) => {
      const pick = (table: unknown) =>
        key
          .split(".")
          .reduce<unknown>(
            (value, part) => (value as Record<string, unknown>)[part],
            table,
          );
      const en = pick(texts.en);
      return typeof en === "string" && en === pick(texts.ru);
    });
    // Terms that are the same in both languages on purpose.
    expect(same.sort()).toEqual(
      [
        "ao100",
        "ao12",
        "ao5",
        "commentPrefix",
        "defaultSession",
        "mo3",
        "penaltyDnf",
        "penaltyOk",
        "penaltyPlus2",
        "progress.dnf",
        "settings.languages.en",
        "settings.languages.ru",
        "train.memberWords.coll.cmll",
        "train.memberWords.coll.coll",
        "train.memberWords.ls.front",
        "train.memberWords.ls.right",
        "train.memberWords.oll.oll",
        "train.memberWords.oll.ollcp",
        "train.puzzles.222",
        "train.puzzles.333",
        "train.slots.bl",
        "train.slots.br",
        "train.slots.fl",
        "train.slots.fr",
      ].sort(),
    );
  });

  test("A2: the official Russian terms", () => {
    const ru = textFor("ru");
    expect(ru.inspection).toBe("Инспекция");
    expect(ru.penalty).toBe("Штраф");
    expect(ru.scramble).toBe("Скрамбл");
    expect(ru.attempt).toBe("Попытка");
    expect(ru.formats.ao5).toBe("Среднее из 5");
    expect(ru.formats.mo3).toBe("Среднее из 3");
    expect(ru.formats.bo5).toBe("Лучшая из 5");
  });

  test("A3b3, A3b4: the calls", () => {
    expect(textFor("en").calls).toEqual({ 8: "8 seconds", 12: "12 seconds" });
    expect(textFor("ru").calls).toEqual({ 8: "8 секунд", 12: "12 секунд" });
  });

  test("Russian plurals", () => {
    const solves = (n: number) => plural(n, "сборка", "сборки", "сборок");
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(solves)).toEqual([
      "сборка",
      "сборки",
      "сборки",
      "сборок",
      "сборок",
      "сборок",
      "сборок",
      "сборка",
      "сборки",
      "сборок",
      "сборка",
      "сборок",
    ]);
    const ru = textFor("ru").settings;
    expect(ru.imported({ added: 6722, skipped: 0, created: 1 })).toBe(
      "Добавлены 6722 сборки.",
    );
    expect(ru.imported({ added: 21, skipped: 5, created: 0 })).toBe(
      "Добавлена 21 сборка. Ещё 5 уже было здесь.",
    );
    expect(ru.imported({ added: 0, skipped: 1, created: 0 })).toBe(
      "Ничего нового: 1 сборка уже была здесь.",
    );
    expect(ru.importConfirm(3)).toBe("Импортировать 3 сборки");
  });

  test("unreadable rows are listed by number, the rest counted", () => {
    const en = textFor("en").settings;
    const ru = textFor("ru").settings;
    expect(en.importUnreadRows("Main", [4])).toBe(
      "“Main”: row 4 can’t be read and will stay out.",
    );
    expect(en.importUnreadRows("Main", [4, 9])).toBe(
      "“Main”: rows 4 and 9 can’t be read and will stay out.",
    );
    expect(en.importUnreadRows("Main", [1, 2, 3, 4, 5, 6])).toBe(
      "“Main”: rows 1, 2, 3, 4, 5 and 6 can’t be read and will stay out.",
    );
    expect(en.importUnreadRows("Main", [1, 2, 3, 4, 5, 6, 7, 8])).toBe(
      "“Main”: rows 1, 2, 3, 4, 5 and 3 more can’t be read and will stay out.",
    );
    expect(ru.importUnreadRows("Основная", [2])).toBe(
      "«Основная»: строка 2 не читается и не войдёт.",
    );
    expect(ru.importUnreadRows("Основная", [2, 3, 4, 5, 6, 7, 8])).toBe(
      "«Основная»: строки 2, 3, 4, 5, 6 и ещё 2 не читаются и не войдут.",
    );
    // A name two sessions in the file share gets its puzzle.
    expect(en.importUnreadRows("Normal", [1], "2×2")).toBe(
      "“Normal” (2×2): row 1 can’t be read and will stay out.",
    );
    expect(ru.importUnreadRows("Normal", [1], "2×2")).toBe(
      "«Normal» (2×2): строка 1 не читается и не войдёт.",
    );
  });
});
