import { readFile } from "node:fs/promises";
import { expect, test } from "./fixtures";

test("the failure banner restores the newest desktop backup", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        async invoke(command: string, args?: { id: string }) {
          if (command === "db_open") throw new Error("File is damaged");
          if (command === "list_backups")
            return [{ id: "latest" }, { id: "older" }];
          if (command === "restore_backup") {
            sessionStorage.setItem("restored", args?.id ?? "");
            return;
          }
          throw new Error(command);
        },
      },
    });
  });
  await page.goto("/");
  const banner = page.locator('[data-part="db-state"][data-kind="failed"]');
  await banner.getByRole("button", { name: "Restore latest backup" }).click();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("restored")))
    .toBe("latest");
});

for (const { language, message } of [
  {
    language: "en",
    message: "This backup needs a newer version of cubehaus.",
  },
  {
    language: "ru",
    message: "Для этой копии нужна новая версия cubehaus.",
  },
]) {
  test(`the desktop banner explains a newer backup in ${language}`, async ({
    page,
  }) => {
    await page.addInitScript((language) => {
      Object.defineProperty(navigator, "language", { value: language });
      Object.assign(window, {
        __TAURI_INTERNALS__: {
          async invoke(command: string, args?: { id: string }) {
            if (command === "db_open") throw new Error("File is damaged");
            if (command === "list_backups") return [{ id: "latest" }];
            if (command === "restore_backup" && args?.id === "latest")
              throw "newer_backup_schema";
            throw new Error(command);
          },
        },
      });
    }, language);
    await page.goto("/");
    const banner = page.locator('[data-part="db-state"][data-kind="failed"]');
    const restore = banner.locator('[data-action="restore-latest-backup"]');
    await restore.click();
    await expect(banner.getByRole("status")).toHaveText(message);
    await expect(restore).toBeEnabled();
  });
}

test("a newer database offers an update message and no recovery actions", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        async invoke(command: string) {
          if (command === "db_open") return "synthetic.sqlite3";
          if (command === "db_all") return [{ user_version: 999 }];
          throw new Error(command);
        },
      },
    });
  });
  await page.goto("/");
  const banner = page.locator('[data-part="db-state"][data-kind="failed"]');
  await expect(banner).toHaveText(
    "This database needs a newer version of cubehaus.",
  );
  await expect(banner.getByRole("button")).toHaveCount(0);
});

test("a damaged web database rejects a newer backup, then restores the chosen file", async ({
  page,
}) => {
  const banner = page.locator('[data-part="db-state"]');
  await page.goto("/");
  await expect(banner).toHaveCount(0, { timeout: 15_000 });
  await page.route("**/__db-test", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
  );
  await page.goto("/__db-test");
  await page.evaluate(async () => {
    const code = `
      onmessage = async () => {
        try {
          await navigator.locks.request("cubehaus-db", async () => {
            const root = await navigator.storage.getDirectory();
            const pool = await root.getDirectoryHandle(".opfs-sahpool");
            const opaque = await pool.getDirectoryHandle(".opaque");
            for await (const entry of opaque.values()) {
              const file = await entry.getFile();
              const bytes = new Uint8Array(await file.arrayBuffer());
              const magic = new TextEncoder().encode("SQLite format 3");
              const offset = bytes.findIndex((byte, at) =>
                byte === magic[0] && magic.every((part, i) => bytes[at + i] === part)
              );
              if (offset < 0) continue;
              const handle = await entry.createSyncAccessHandle();
              try {
                handle.write(new Uint8Array(magic.length), { at: offset });
                handle.flush();
              } finally {
                handle.close();
              }
              return;
            }
            throw new Error("No SQLite file was found");
          });
          postMessage({ ok: true });
        } catch (error) {
          postMessage({ error: String(error) });
        }
      };
    `;
    const url = URL.createObjectURL(
      new Blob([code], { type: "text/javascript" }),
    );
    const worker = new Worker(url);
    try {
      await new Promise<void>((resolve, reject) => {
        worker.onmessage = ({ data }) =>
          data.ok ? resolve() : reject(new Error(data.error));
        worker.onerror = reject;
        worker.postMessage(null);
      });
    } finally {
      worker.terminate();
      URL.revokeObjectURL(url);
    }
  });
  await page.goto("/");
  await expect(banner).toHaveAttribute("data-kind", "failed");
  const saved = page.waitForEvent("download");
  await banner.getByRole("button", { name: "Save readable data" }).click();
  const download = await saved;
  expect(download.suggestedFilename()).toMatch(
    /cubehaus-recovered-.*\.sqlite3$/,
  );
  expect(
    (await readFile((await download.path()) as string)).length,
  ).toBeGreaterThan(4096);

  const picker = banner.locator('input[type="file"]');
  const backup = {
    format: "cubehaus",
    version: 1,
    exportedAt: 0,
    tables: {
      session: [
        {
          id: "synthetic",
          name: "Synthetic recovery",
          event: "333",
          order_key: "a",
          folder_id: null,
          archived: 0,
          created_at: 0,
          updated_at: 0,
          deleted_at: null,
        },
      ],
    },
  };
  const choose = (schema: number) =>
    picker.setInputFiles({
      name: "synthetic.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ ...backup, schema })),
    });
  await choose(999);
  await expect(banner.getByRole("status")).toHaveText(
    "This backup needs a newer version of cubehaus.",
  );
  await page.reload();
  await expect(banner).toHaveAttribute("data-kind", "failed");
  await choose(3);
  await expect(banner).toHaveCount(0, { timeout: 15_000 });
  await page.reload();
  await expect(banner).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('[data-action="session-switch"]')).toHaveText(
    "Synthetic recovery",
  );
});

test("an integrity failure can save the tables still readable on desktop", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        async invoke(command: string, args?: { sql: string }) {
          if (command === "db_open") return "synthetic.sqlite3";
          if (command === "list_backups") return [];
          if (command === "db_all") {
            if (args?.sql === "PRAGMA user_version")
              return [{ user_version: 3 }];
            if (args?.sql.includes("pragma_page_count"))
              return [{ bytes: 4096 }];
            if (args?.sql === "PRAGMA quick_check(1)")
              return [{ quick_check: "bad page" }];
            if (args?.sql.includes("FROM setting"))
              return [{ key: "theme", value: '"dark"', updated_at: 0 }];
            if (args?.sql.includes("FROM solve")) throw new Error("bad page");
            return [];
          }
          throw new Error(command);
        },
      },
    });
  });
  await page.goto("/");
  const banner = page.locator('[data-part="db-state"][data-kind="failed"]');
  await expect(
    banner.getByRole("button", { name: "Restore latest backup" }),
  ).toHaveCount(0);
  const saved = page.waitForEvent("download");
  await banner.getByRole("button", { name: "Save readable data" }).click();
  const download = await saved;
  const file = JSON.parse(
    await readFile((await download.path()) as string, "utf8"),
  );
  expect(file).toMatchObject({
    format: "cubehaus",
    schema: 3,
    tables: { solve: [], setting: [{ key: "theme", updated_at: 0 }] },
  });
});
