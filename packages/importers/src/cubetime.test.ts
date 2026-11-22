import { readFileSync } from "node:fs";
import { createStore, migrate, snapshot } from "@cubehaus/storage";
import { createNodeDb } from "@cubehaus/storage/node";
import { expect, test } from "vitest";
import { parseImport, runImport } from "../../../apps/web/src/import";
import { parseCubeTimeCsv, readDelimited } from "./index";

const fixture = readFileSync(
  new URL("./fixtures/cubetime.csv", import.meta.url),
  "utf8",
);
const options = {
  name: "OH",
  event: "333oh",
  timeZone: "Europe/Berlin",
} as const;
const header = "Time,Comment,Scramble,Date";
const comment = 'first, "quoted"\nвторая строка';

test("cubetime csv preserves time note and date", async () => {
  const result = parseCubeTimeCsv(fixture, options);
  expect(result).toMatchObject({
    source: "cubetime",
    issues: [],
    localDates: 0,
    sessions: [
      {
        name: "OH",
        event: "333oh",
        solves: [1, 2].map((row) => ({
          row,
          timeMs: 12345,
          comment,
          scramble: "R U",
          startedAt: 1767312000000,
          plus2: 0,
          dnf: false,
        })),
      },
    ],
  });

  const db = createNodeDb(":memory:");
  try {
    await migrate(db);
    const store = createStore(db);
    expect(await runImport(store, result)).toMatchObject({
      added: 2,
      skipped: 0,
    });
    expect(await runImport(store, result)).toMatchObject({
      added: 0,
      skipped: 2,
    });
    const backup = await snapshot(db);
    expect(backup.tables.solve).toHaveLength(2);
    expect(
      JSON.parse(String(backup.tables.solve?.[0]?.import_extra)).csv,
    ).toEqual(["12.345", comment, "R U", "2026-01-02T00:00:00Z"]);
  } finally {
    await db.close();
  }
});

test("ambiguous dates and penalty-shaped cells identify the row before saving", () => {
  const result = parseCubeTimeCsv(
    [
      header,
      "12.345,,R U,2025-10-26 02:30:00",
      "DNF,,R U,2026-01-02 00:00:00 +0000",
      "12.345+,,R U,2026-01-02 00:00:00 +0000",
      "12.345,,R U,2025-03-30 02:30:00",
    ].join("\n"),
    options,
  );
  expect(result.sessions[0]?.solves).toEqual([]);
  expect(
    result.issues.map(({ row, code, value }) => ({ row, code, value })),
  ).toEqual([
    { row: 1, code: "ambiguous-local-date", value: "2025-10-26 02:30:00" },
    { row: 2, code: "missing-dnf-time", value: "DNF" },
    { row: 3, code: "ambiguous-plus2", value: "12.345+" },
    { row: 4, code: "nonexistent-local-date", value: "2025-03-30 02:30:00" },
  ]);
});

test("decimal truncation, offsets, and local civil times are exact", () => {
  const csv = [
    header,
    "12.345000000000001,,R U,2026-01-02 01:00:00 +0100",
    "12.344999999999999,,R U,2026-01-02 01:00:00",
    "12.3445,,R U,2025-10-26 02:30:00 +0200",
    "5e-4,,R U,2025-10-26 02:30:00 +0100",
    "12.345,,R U,2026-02-30 00:00:00 +0000",
  ].join("\r\n");
  const { sessions, issues, localDates } = parseCubeTimeCsv(
    `\uFEFF${csv}\r\n`,
    options,
  );
  expect(
    sessions[0]?.solves.map(({ timeMs, startedAt }) => [timeMs, startedAt]),
  ).toEqual([
    [12345, 1767312000000],
    [12344, 1767312000000],
    [12344, Date.UTC(2025, 9, 26, 0, 30)],
    [0, Date.UTC(2025, 9, 26, 1, 30)],
  ]);
  expect(issues).toMatchObject([{ row: 5, code: "invalid-date" }]);
  // Only row 2 was read in the chosen zone: the panel names the zone only then.
  expect(localDates).toBe(1);
  expect(parseCubeTimeCsv(header, options).sessions[0]?.solves).toEqual([]);
  expect(() => parseCubeTimeCsv(`${header},Penalty\n`, options)).toThrow();
});

test("delimited records keep quoted line endings, separators and empty cells", () => {
  expect(
    readDelimited('\uFEFFa;b;c\r\n"one;two";"three\r\n""four""";\r\n', ";"),
  ).toEqual([
    ["a", "b", "c"],
    ["one;two", 'three\r\n"four"', ""],
  ]);
  expect(() => readDelimited('a,"open', ",")).toThrow();
});

test("two CSVs keep their own sessions even with equal attempts and edited names", async () => {
  const files = ["OH", "3x3"].map(
    (name) => new File([fixture], `CubeTime - ${name}.csv`),
  );
  const sessions = [
    { name: "A", event: "333" },
    { name: "A", event: "333" },
  ] as const;
  const request = { files, sessions, timeZone: options.timeZone };
  const parsed = await parseImport(request);
  const db = createNodeDb(":memory:");
  try {
    await migrate(db);
    const store = createStore(db);
    expect(await runImport(store, parsed)).toMatchObject({
      created: 2,
      added: 4,
    });
    const edited = await parseImport({
      ...request,
      sessions: [{ name: "B", event: "333" }, sessions[1]],
    });
    expect(await runImport(store, edited)).toMatchObject({
      created: 0,
      added: 0,
      skipped: 4,
    });
  } finally {
    await db.close();
  }
});
