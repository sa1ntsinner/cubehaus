import type { Solve } from "@cubehaus/core";

export const performanceName = "Synthetic performance history";
export const performanceSettings = {
  calls: "off",
  inspection: "off",
} as const;

export function performanceSeedKey(count: number, grouped = false): string {
  return `cubehaus.test.seed.v1.${count}${grouped ? ".grouped" : ""}`;
}

export function performanceSolve(
  index: number,
  sessionId: string,
  seed: number,
): Solve {
  let random = Math.imul(index + 1, 0x9e3779b1) ^ seed;
  random = Math.imul(random ^ (random >>> 16), 0x85ebca6b);
  random = (random ^ (random >>> 13)) >>> 0;
  return {
    id: `${sessionId}-${index.toString().padStart(6, "0")}`,
    sessionId,
    event: "333",
    timeMs: 8_000 + (random % 14_000),
    plus2: Number(index % 31 === 30),
    dnf: index % 127 === 126,
    scramble: "R2 U' F2 D L2 B' R U2 F' D2 L B2 U R' D' F L' U B",
    startedAt: Date.UTC(2025, 0, 1) + index * 120_000,
    inspectionMs: null,
    comment: null,
    input: "keyboard",
  };
}
