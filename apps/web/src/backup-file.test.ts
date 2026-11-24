import { listen } from "@tauri-apps/api/event";
import { afterEach, expect, test, vi } from "vitest";
import { download } from "./backup-file";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("a desktop download without a completion event fails after 30 seconds", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  const link = { href: "", download: "", click: vi.fn() };
  vi.stubGlobal("document", { createElement: () => link });
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const unlisten = vi.fn().mockResolvedValue(undefined);
  vi.mocked(listen).mockResolvedValue(unlisten);

  const failed = vi.fn();
  const writing = download("backup.json", "{}");
  const settled = writing?.catch(failed);

  await vi.advanceTimersByTimeAsync(29_999);
  expect(link.click).toHaveBeenCalledOnce();
  expect(failed).not.toHaveBeenCalled();
  expect(unlisten).not.toHaveBeenCalled();
  expect(revoke).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(1);
  expect(failed).toHaveBeenCalledExactlyOnceWith(
    new Error("The download failed"),
  );
  await settled;
  expect(unlisten).toHaveBeenCalledOnce();
  expect(revoke).toHaveBeenCalledExactlyOnceWith(link.href);
});
