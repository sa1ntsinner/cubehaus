import type { EventId } from "@cubehaus/core";
import type { SolveDraft } from "./cstimer";

const encoder = new TextEncoder();

export async function importHash(
  source: string,
  event: EventId,
  solve: SolveDraft,
  occurrence: number,
): Promise<string> {
  const data = [
    source,
    event,
    solve.timeMs,
    solve.plus2,
    Number(solve.dnf),
    solve.startedAt,
    solve.scramble,
    occurrence,
  ].join("\n");
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(data),
  );
  return Array.from(new Uint8Array(digest, 0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
