import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import fixture from "../../../packages/importers/src/fixtures/cstimer-small.json" with {
  type: "json",
};
import cubedesk from "../../../packages/importers/src/fixtures/cubedesk.json" with {
  type: "json",
};
import { expect, test } from "./fixtures";
import {
  renameCurrentSession,
  sessionButton,
  sessionNames,
  switchSession,
} from "./helpers";

const exportFile = {
  name: "synthetic.txt",
  mimeType: "text/plain",
  buffer: Buffer.from(JSON.stringify(fixture)),
};

const solveRows = (page: Page) =>
  page.locator('[data-part="solves"] [data-solve-id]');

/** Settings with the database open, and its import field. */
async function openImport(page: Page) {
  await page.goto("/");
  await expect(sessionButton(page)).toBeEnabled();
  await page.goto("/#/settings/data");
  const input = page.locator('[data-action="import-file"] input');
  await expect(input).toBeEnabled();
  return input;
}

test("a csTimer file is shown before import, imported once, and the empty starter goes", async ({
  page,
}) => {
  const input = await openImport(page);
  const preview = page.locator('[data-part="import-preview"]');
  const result = page.locator('[data-part="data-result"]');

  await input.setInputFiles(exportFile);
  await expect(preview.locator("li")).toHaveText([
    "Practice3×36",
    "OH practiceOH1",
    "Two2×20",
  ]);
  await expect(page.locator('[data-action="import-confirm"]')).toBeFocused();
  await expect(page.locator('[data-action="import-confirm"]')).toHaveText(
    "Import 7 solves",
  );
  // Nothing is written until the import is confirmed.
  await page.locator('[data-action="import-cancel"]').click();
  await expect(preview).toHaveCount(0);
  await page.goto("/#/");
  expect(await sessionNames(page)).toEqual(["3×3"]);

  await page.goto("/#/settings/data");
  await input.setInputFiles(exportFile);
  await page.locator('[data-action="import-confirm"]').click();
  await expect(result).toHaveText("Added 7 solves.");
  await expect(preview).toHaveCount(0);
  await page.goto("/#/");
  expect(await sessionNames(page)).toEqual(["Practice", "OH practice", "Two"]);
  await switchSession(page, "Practice");
  await expect(solveRows(page)).toHaveCount(6);
  const before = await solveRows(page).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-solve-id")),
  );

  // A second import of the same file has nothing to add, and says so before writing.
  await page.goto("/#/settings/data");
  await input.setInputFiles(exportFile);
  await expect(page.locator('[data-part="import-here"]')).toHaveText(
    "All 7 solves are already here.",
  );
  await expect(page.locator('[data-action="import-confirm"]')).toHaveCount(0);
  await page.locator('[data-action="import-cancel"]').click();
  await expect(preview).toHaveCount(0);
  await page.goto("/#/");
  expect(await sessionNames(page)).toHaveLength(3);
  await expect(sessionButton(page)).toHaveText("Practice");
  expect(
    await solveRows(page).evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-solve-id")),
    ),
  ).toEqual(before);
});

test("a bad file explains the failure and leaves existing solves alone", async ({
  page,
}) => {
  const input = await openImport(page);
  const result = page.locator('[data-part="data-result"]');
  await input.setInputFiles(exportFile);
  await page.locator('[data-action="import-confirm"]').click();
  await expect(result).toHaveText("Added 7 solves.");

  await input.setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("{broken"),
  });
  await expect(result).toHaveText(
    "This file can’t be read. Choose the file csTimer exports.",
  );
  await expect(page.locator('[data-part="import-preview"]')).toHaveCount(0);
  await expect(input).toBeEnabled();
  await page.goto("/#/");
  expect(await sessionNames(page)).toHaveLength(3);
  await switchSession(page, "Practice");
  await expect(solveRows(page)).toHaveCount(6);
});

test("a native backup restores sessions, solves and order in a fresh profile", async ({
  page,
  browser,
  browserName,
  baseURL,
}) => {
  const importInput = await openImport(page);
  await importInput.setInputFiles(exportFile);
  await page.locator('[data-action="import-confirm"]').click();
  await expect(page.locator('[data-part="data-result"]')).toHaveText(
    "Added 7 solves.",
  );
  await page.goto("/#/");
  const rows = (p: typeof page) =>
    p.locator('[data-part="solves"] [data-solve-id]');
  const ids = (p: typeof page) =>
    rows(p).evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-solve-id")),
    );
  await switchSession(page, "Practice");
  await expect(rows(page)).toHaveCount(6);
  const labels = await sessionNames(page);
  const solveIds = await ids(page);

  await page.goto("/#/settings/data");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('[data-action="backup-save"]').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^cubehaus-backup-\d{4}-\d{2}-\d{2}\.json$/,
  );
  const file = (await download.path()) as string;

  // WebKit gives an ephemeral context no OPFS: the restore runs in memory there.
  const other = await browser.newContext(baseURL ? { baseURL } : {});
  try {
    const fresh = await other.newPage();
    await fresh.goto("/");
    await expect(sessionButton(fresh)).toBeEnabled();
    await fresh.goto("/#/settings/data");
    const input = fresh.locator('[data-action="backup-restore"] input');
    const result = fresh.locator('[data-part="data-result"]');
    await input.setInputFiles({
      name: "broken.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"format":"cstimer"}'),
    });
    await expect(result).toHaveText(
      "This file is not a cubehaus backup. Nothing was changed.",
    );
    await input.setInputFiles(file);
    await expect(result).toHaveText(
      /^Restored: \d+ added, 0 updated, 0 already here\.$/,
    );
    await fresh.goto("/#/");
    expect(await sessionNames(fresh)).toEqual(labels);
    await switchSession(fresh, "Practice");
    await expect(rows(fresh)).toHaveCount(6);
    expect(await ids(fresh)).toEqual(solveIds);

    await fresh.goto("/#/settings/data");
    await input.setInputFiles(file);
    await expect(result).toHaveText(
      /^Restored: 0 added, 0 updated, \d+ already here\.$/,
    );

    if (browserName === "chromium") {
      await fresh.goto("/");
      await fresh.reload();
      await switchSession(fresh, "Practice");
      expect(await ids(fresh)).toEqual(solveIds);
    }
  } finally {
    await other.close();
  }
});

test("three formats save from the keyboard and a csTimer file made here imports back as already here", async ({
  page,
}) => {
  await page.goto("/?state=session");
  await expect(sessionButton(page)).toBeEnabled();
  await page.evaluate(() => {
    location.hash = "#/settings/data";
  });
  const result = page.locator('[data-part="data-result"]');
  async function save(name: string) {
    const button = page.locator(`[data-action="${name}"]`);
    await expect(button).toBeEnabled();
    await button.focus();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.keyboard.press("Enter"),
    ]);
    return download;
  }

  const backup = await save("backup-save");
  expect(backup.suggestedFilename()).toMatch(
    /^cubehaus-backup-\d{4}-\d{2}-\d{2}\.json$/,
  );

  const cstimer = await save("export-cstimer");
  expect(cstimer.suggestedFilename()).toMatch(
    /^cubehaus-cstimer-\d{4}-\d{2}-\d{2}\.txt$/,
  );
  await expect(result).toHaveText(
    "Saved. For 2 solves the file leaves out inspection times. “All data as one file” keeps everything.",
  );
  const cstimerPath = (await cstimer.path()) as string;
  const file = JSON.parse(await readFile(cstimerPath, "utf8")) as {
    session1: unknown[];
    properties: { sessionData: string };
  };
  expect(file.session1).toHaveLength(60);
  expect(JSON.parse(file.properties.sessionData)).toEqual({
    "1": { name: expect.any(String), opt: { scrType: "333" } },
  });

  const csv = await save("export-csv");
  expect(csv.suggestedFilename()).toMatch(
    /^cubehaus-solves-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  await expect(result).toHaveText("Saved.");
  const table = await readFile((await csv.path()) as string, "utf8");
  expect(table.split("\r\n")[0]).toBe(
    "session_id,session_name,event,id,time_ms,plus2,dnf,started_at_utc,scramble,comment,inspection_ms,moves,solution,cubes_solved,cubes_attempted,splits",
  );
  expect(table.split("\r\n")).toHaveLength(62);

  await page
    .locator('[data-action="import-file"] input')
    .setInputFiles(cstimerPath);
  await expect(page.locator('[data-part="import-here"]')).toHaveText(
    "All 60 solves are already here.",
  );
  await expect(page.locator('[data-action="import-confirm"]')).toHaveCount(0);
  await expect(page.locator('[data-action="import-cancel"]')).toHaveText(
    "Close",
  );
  await expect(page.locator('[data-action="import-cancel"]')).toBeFocused();
});

test("two CubeTime CSVs can be mapped, imported and previewed again without duplicates", async ({
  page,
}) => {
  await openImport(page);
  // One picker takes csTimer files and CubeTime’s CSV files alike.
  const picker = page.locator('[data-action="import-file"] input');
  const panel = page.locator('[data-part="import-preview"]');
  const names = panel.locator('[data-action="import-session-name"]');
  const events = panel.locator('[data-action="import-session-event"]');
  const confirm = panel.locator('[data-action="import-confirm"]');
  const header = "Time,Comment,Scramble,Date\n";
  const files = [
    {
      name: "CubeTime - 2x2.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        header +
          '12.344999999999999,"первая, ""строка""\nsecond",R U,2026-01-02 01:00:00 +0100\n',
      ),
    },
    {
      name: "CubeTime - OH practice.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        header +
          "12.345000000000001,,R U,2026-01-02 02:00:00 +0100\n" +
          "DNF,,R U,2026-01-02 02:00:01 +0100\n",
      ),
    },
  ];

  async function mapFiles() {
    await picker.setInputFiles(files);
    await expect(confirm).toBeFocused();
    await expect(names.first()).toHaveValue("2x2");
    await expect(events.first()).toHaveValue("222");
    await expect(events.nth(1)).toHaveValue("333oh");
    await expect(
      panel.locator('[data-part="import-csv-penalties"]'),
    ).toContainText("+2 or DNF");
    // Every date names its offset, so nothing is said about a time zone.
    await expect(panel.locator('[data-part="import-csv-zone"]')).toHaveCount(0);
    await expect(panel.locator('[data-part="import-issue"]')).toHaveText([
      "“OH practice”: row 2 stays out. A DNF in CSV keeps no time.",
    ]);
    await names.first().fill("Тренировка");
    // A new puzzle reads the files again by itself; the hand stays on the choice.
    await events.first().focus();
    await events.first().selectOption("444");
    await expect(events.first()).toBeFocused();
  }

  await mapFiles();
  await expect(confirm).toHaveText("Import 2 solves");
  await expect(confirm).toBeEnabled();
  // Enter in the name field imports with the names as typed.
  await names.first().press("Enter");
  await expect(page.locator('[data-part="data-result"]')).toHaveText(
    "Added 2 solves.",
  );
  await expect(picker).toBeFocused();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('[data-action="backup-save"]').click(),
  ]);
  const backup = JSON.parse(
    await readFile((await download.path()) as string, "utf8"),
  ) as {
    tables: {
      session: Record<string, unknown>[];
      solve: Record<string, unknown>[];
    };
  };
  const sessions = backup.tables.session
    .map(({ id, name, event }) => ({ id, name, event }))
    .sort((a, b) => String(a.event).localeCompare(String(b.event)));
  expect(sessions).toEqual([
    { id: expect.any(String), name: "OH practice", event: "333oh" },
    { id: expect.any(String), name: "Тренировка", event: "444" },
  ]);
  expect(backup.tables.solve).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        session_id: sessions[1]?.id,
        event: "444",
        started_at: 1767312000000,
        // 12.344999999999999 s: whole milliseconds, the rest dropped, as the timer does.
        time_ms: 12344,
        plus2: 0,
        dnf: 0,
        scramble: "R U",
        comment: 'первая, "строка"\nsecond',
        import_source: "cubetime",
      }),
      expect.objectContaining({
        session_id: sessions[0]?.id,
        event: "333oh",
        started_at: 1767315600000,
        time_ms: 12345,
        plus2: 0,
        dnf: 0,
        scramble: "R U",
        comment: null,
        import_source: "cubetime",
      }),
    ]),
  );
  expect(backup.tables.solve).toHaveLength(2);

  await mapFiles();
  await expect(panel.locator('[data-part="import-here"]')).toHaveText(
    "All 2 solves are already here.",
  );
  await expect(confirm).toHaveCount(0);
  await expect(panel.locator('[data-action="import-cancel"]')).toHaveText(
    "Close",
  );
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(picker).toBeFocused();

  // A date with no offset is read in this computer’s zone, and only then is that said.
  await picker.setInputFiles({
    name: "CubeTime - 3x3.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`${header}9.5,,R U,2026-01-03 10:00:00\n`),
  });
  await expect(panel.locator('[data-part="import-csv-zone"]')).toHaveText(
    /^Times without a zone are read as \S+\.$/,
  );
  await page.keyboard.press("Escape");

  // A csTimer file and CSV files at once: one kind at a time.
  await picker.setInputFiles([files[0] as (typeof files)[number], exportFile]);
  await expect(panel).toHaveCount(0);
  await expect(page.locator('[data-part="data-result"]')).toHaveText(
    "Choose one file, or CubeTime’s CSV files.",
  );
});

test("Twisty Timer backup keeps both attempts and the source category after a rename", async ({
  page,
}) => {
  const input = await openImport(page);
  const panel = page.locator(
    '[data-part="import-preview"][data-import-source="twisty"]',
  );
  const confirm = panel.locator('[data-action="import-confirm"]');
  const result = page.locator('[data-part="data-result"]');
  const buffer = await readFile(
    new URL(
      "../../../packages/importers/src/fixtures/twisty-backup.txt",
      import.meta.url,
    ),
  );
  const file = { name: "Backup.txt", mimeType: "text/plain", buffer };

  await expect(page.locator('[data-action="import-file"]')).toHaveCount(1);
  await input.setInputFiles(file);
  await expect(panel.locator('[data-part="import-sessions"] li')).toHaveText([
    "A3×32",
  ]);
  await expect(confirm).toHaveText("Import 2 solves");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(result).toHaveText("Added 2 solves.");
  await expect(input).toBeFocused();

  await page.goto("/#/");
  expect(await sessionNames(page)).toEqual(["A"]);
  await expect(solveRows(page)).toHaveCount(2);
  await renameCurrentSession(page, "Renamed A");

  await page.goto("/#/settings/data");
  await input.setInputFiles(file);
  await expect(panel.locator('[data-part="import-sessions"] li')).toHaveText([
    "A3×32",
  ]);
  await expect(panel.locator('[data-part="import-here"]')).toHaveText(
    "All 2 solves are already here.",
  );
  await expect(confirm).toHaveCount(0);
  await expect(panel.locator('[data-action="import-cancel"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(input).toBeFocused();

  await input.setInputFiles({
    ...file,
    buffer: Buffer.concat([
      buffer,
      Buffer.from('"333";"A";"12345";"";"R";"0";""\n'),
    ]),
  });
  // A record that cannot be read stays out by its row; the rest is already here.
  await expect(panel.locator('[data-part="import-issue"]')).toHaveText([
    "“A”: row 3 can’t be read and will stay out.",
  ]);
  await expect(panel.locator('[data-part="import-here"]')).toHaveText(
    "All 2 solves are already here.",
  );
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('[data-action="backup-save"]').click(),
  ]);
  const backup = JSON.parse(
    await readFile((await download.path()) as string, "utf8"),
  ) as { tables: Record<string, Record<string, unknown>[]> };
  expect(backup.tables.session).toEqual([
    expect.objectContaining({ name: "Renamed A" }),
  ]);
  const sessionId = backup.tables.session?.[0]?.id;
  expect(backup.tables.solve).toHaveLength(2);
  for (const solve of backup.tables.solve ?? []) {
    expect(solve).toMatchObject({
      session_id: sessionId,
      comment: "a;b",
      time_ms: 12345,
      started_at: 1700000000001,
      plus2: 1,
      import_source: "twisty",
    });
  }
  expect(backup.tables.import_session).toEqual([
    expect.objectContaining({
      session_id: sessionId,
      source: "twisty",
      source_key: '["333","A"]',
    }),
  ]);
});

test("CubeDesk import keeps both sessions and solve provenance after a refused file", async ({
  page,
}) => {
  const input = await openImport(page);
  const panel = page.locator('[data-part="import-preview"]');
  const result = page.locator('[data-part="data-result"]');
  const file = {
    name: "cubedesk.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(cubedesk)),
  };
  await input.setInputFiles(file);
  await expect(panel).toHaveAttribute("data-import-source", "cubedesk");
  await expect(panel.locator("li")).toHaveText([
    "Practice3×30",
    "Practice3×31",
  ]);
  await expect(panel.locator('[data-action="import-confirm"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(result).toHaveText("Added 1 solve.");
  await expect(input).toBeFocused();

  await input.setInputFiles(file);
  await expect(panel.locator('[data-part="import-here"]')).toHaveText(
    "This solve is already here.",
  );
  await expect(panel.locator('[data-action="import-cancel"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(input).toBeFocused();

  async function backup() {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator('[data-action="backup-save"]').click(),
    ]);
    return JSON.parse(
      await readFile((await download.path()) as string, "utf8"),
    ) as { tables: Record<string, Record<string, unknown>[]> };
  }
  const before = await backup();
  expect(before.tables.session).toHaveLength(2);
  expect(before.tables.session).toEqual([
    expect.objectContaining({ name: "Practice", event: "333" }),
    expect.objectContaining({ name: "Practice", event: "333" }),
  ]);
  const binding = before.tables.import_session?.find(
    ({ source_key }) => source_key === '["B","333"]',
  );
  expect(
    before.tables.import_session?.map(({ source_key }) => source_key).sort(),
  ).toEqual(['["A","333"]', '["B","333"]']);
  expect(binding).toMatchObject({ source: "cubedesk" });
  expect(JSON.parse(String(binding?.source_meta))).toEqual(
    cubedesk.sessions[1],
  );
  expect(before.tables.solve).toEqual([
    expect.objectContaining({
      session_id: binding?.session_id,
      time_ms: 12345,
      plus2: 1,
      dnf: 0,
      started_at: 1700000000123,
      scramble: "R",
      comment: "r",
      import_source: "cubedesk",
    }),
  ]);
  expect(JSON.parse(String(before.tables.solve?.[0]?.import_extra))).toEqual({
    v: 1,
    cubedesk: cubedesk.solves[0],
  });

  await input.setInputFiles({
    ...file,
    buffer: Buffer.from(
      JSON.stringify({ sessions: cubedesk.sessions, solves: {} }),
    ),
  });
  await expect(result).toHaveText(
    "This CubeDesk export can’t be read. Nothing was imported.",
  );
  await expect(panel).toHaveCount(0);
  await expect(input).toBeFocused();
  const after = await backup();
  expect(after.tables.session).toEqual(before.tables.session);
  expect(after.tables.solve).toEqual(before.tables.solve);
  expect(after.tables.import_session).toEqual(before.tables.import_session);
});
