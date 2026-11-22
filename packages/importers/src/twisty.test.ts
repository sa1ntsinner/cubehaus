import { readFileSync } from "node:fs";
import { effectiveMs } from "@cubehaus/core";
import { createStore, migrate, snapshot } from "@cubehaus/storage";
import { createNodeDb } from "@cubehaus/storage/node";
import { expect, test } from "vitest";
import {
  importPlan,
  parseImport,
  runImport,
} from "../../../apps/web/src/import";
import { parseTwistyBackup } from "./index";

const fixture = readFileSync(
  new URL("./fixtures/twisty-backup.txt", import.meta.url),
  "utf8",
);
const [header, attempt] = fixture.trimEnd().split("\n");

test("twisty backup distinguishes duration from penalty", async () => {
  const result = parseTwistyBackup(fixture);
  const solve = {
    timeMs: 12345,
    plus2: 1,
    dnf: false,
    startedAt: 1700000000001,
    scramble: "R",
    comment: "a;b",
  };
  expect(result).toMatchObject({
    source: "twisty",
    sessions: [
      {
        key: '["333","A"]',
        name: "A",
        event: "333",
        meta: { puzzle: "333", category: "A" },
        solves: [
          { ...solve, row: 1 },
          { ...solve, row: 2 },
        ],
      },
    ],
    issues: [],
  });
  expect(result.sessions[0]?.solves.map(effectiveMs)).toEqual([14345, 14345]);

  const dnf = parseTwistyBackup(
    `${header}\n"333";"A";"12345";"1700000000001";"R";"2";"a;b"\n`,
  ).sessions[0]?.solves[0];
  expect(dnf).toMatchObject({ ...solve, plus2: 0, dnf: true });
  expect(dnf && effectiveMs(dnf)).toBe(Infinity);

  const parsed = await parseImport(new File([fixture], "backup.txt"));
  expect(parsed).toEqual(result);
  const db = createNodeDb(":memory:");
  try {
    await migrate(db);
    const store = createStore(db);
    const first = await runImport(store, parsed);
    expect(first).toMatchObject({
      added: 2,
      skipped: 0,
    });
    if (!first.firstSession) throw new Error("Missing Twisty Timer session");
    await store.sessions.rename(first.firstSession, "Renamed A");
    expect(await runImport(store, parsed)).toMatchObject({
      created: 0,
      added: 0,
      skipped: 2,
    });
    const backup = await snapshot(db);
    expect(backup.tables.session).toMatchObject([{ name: "Renamed A" }]);
    expect(backup.tables.import_session).toMatchObject([
      { source_key: '["333","A"]', session_id: first.firstSession },
    ]);
    expect(backup.tables.solve).toHaveLength(2);
    expect(backup.tables.solve?.map(({ comment }) => comment)).toEqual([
      "a;b",
      "a;b",
    ]);
    expect(
      JSON.parse(String(backup.tables.solve?.[0]?.import_extra)).twisty,
    ).toEqual(["333", "A", "12345", "1700000000001", "R", "1", "a;b"]);
  } finally {
    await db.close();
  }
});

test("Twisty puzzle codes map to puzzles; a 3×3 category named OH is One-Handed", () => {
  const events = {
    "222": "222",
    "333": "333oh",
    "444": "444",
    "555": "555",
    "666": "666",
    "777": "777",
    clock: "clock",
    mega: "minx",
    pyra: "pyram",
    skewb: "skewb",
    sq1: "sq1",
  };
  const rows = Object.keys(events).map(
    (puzzle) => `"${puzzle}";"OH";"12345";"1700000000001";"R";"0";""`,
  );
  const parsed = parseTwistyBackup(
    `\uFEFF${[header, ...rows].join("\r\n")}\r\n`,
  );
  expect(parsed.sessions.map(({ key, event }) => [key, event])).toEqual(
    Object.entries(events).map(([puzzle, event]) => [
      JSON.stringify([puzzle, "OH"]),
      event,
    ]),
  );
  expect(parsed.issues).toEqual([]);
});

test("equal attempts in different categories have separate source identities", async () => {
  const result = parseTwistyBackup(
    `${header}\n${attempt}\n${attempt?.replace('"A"', '"B"')}\n`,
  );
  const plan = await importPlan(result);
  expect(plan.source).toBe("twisty");
  expect(plan.sessions.map(({ sourceKey }) => sourceKey)).toEqual([
    '["333","A"]',
    '["333","B"]',
  ]);
  const hashes = plan.sessions.flatMap(({ solves }) =>
    solves.map(({ importHash }) => importHash),
  );
  expect(new Set(hashes).size).toBe(2);
});

test.each([
  '"333";"A";"12345+";"1700000000001";"R";"1";""',
  '"333";"A";"";"1700000000001";"R";"2";""',
  '"333";"A";"12345";"1700000000";"R";"0";""',
  '"333";"A";"12345";"1700000000001";"R";"3";""',
  '"333";"A";"12345";"1700000000001";"R";"0"',
])(
  "a record that cannot be read stays out by its row, the rest comes: %s",
  (bad) => {
    const result = parseTwistyBackup(`${header}\n${attempt}\n${bad}\n`);
    expect(result.sessions).toMatchObject([
      { key: '["333","A"]', solves: [{ row: 1, timeMs: 12345 }] },
    ]);
    expect(result.issues).toEqual([
      { sessionKey: '["333","A"]', row: 2, code: "invalid-row" },
    ]);
  },
);

test("an unknown puzzle becomes a 3×3 session and says so; a broken quote rejects the file", async () => {
  const result = parseTwistyBackup(
    `${header}\n"other";"A";"12345";"1700000000001";"R";"0";""\n`,
  );
  expect(result.sessions).toMatchObject([
    {
      key: '["other","A"]',
      name: "other A",
      event: "333",
      solves: [{ timeMs: 12345 }],
    },
  ]);
  expect(result.issues).toEqual([
    {
      sessionKey: '["other","A"]',
      row: null,
      code: "unknown-event",
      value: "other",
    },
  ]);
  await expect(
    parseImport(
      new File(
        [
          `${header}\n${attempt}\n"333";"A";"12345";"1700000000001";"R";"0";"open\n`,
        ],
        "backup.txt",
      ),
    ),
  ).rejects.toMatchObject({ problem: "twisty-backup" });
});

test("external share records cannot go through the backup route", async () => {
  const file = new File(['"12.345";"R";"a;b"\n'], "external.txt");
  await expect(parseImport(file)).rejects.toMatchObject({
    problem: "unsupported-shape",
  });
});
