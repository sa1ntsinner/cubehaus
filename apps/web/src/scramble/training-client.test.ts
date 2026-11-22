import { expect, it } from "vitest";
import {
  createTrainingClient,
  heldScramble,
  type TrainingProfile,
  trainingReady,
  type WorkerLike,
} from "./training-client";

/** A worker stand-in whose replies are released by hand, in any order. */
function fakeWorker() {
  const held: { message: Record<string, unknown>; reply: () => void }[] = [];
  const workers: { terminated: boolean }[] = [];
  const spawn = (): WorkerLike => {
    const self = { terminated: false };
    workers.push(self);
    let listener: ((event: { data: unknown }) => void) | null = null;
    return {
      postMessage(message: Record<string, unknown>) {
        const reply = () => {
          if (self.terminated) return;
          if (message.type === "training")
            listener?.({
              data: {
                id: message.id,
                ok: true,
                value: {
                  scramble: `scramble for ${JSON.stringify(message.profile)}`,
                  caseId: (
                    message.profile as { request: { caseIds: string[] } }
                  ).request.caseIds[0],
                },
              },
            });
          else
            listener?.({
              data: {
                id: message.id,
                ok: true,
                value: { moves: ["R'"], length: 1 },
              },
            });
        };
        held.push({ message, reply });
      },
      set onmessage(handler: ((event: { data: unknown }) => void) | null) {
        listener = handler;
      },
      terminate() {
        self.terminated = true;
      },
    };
  };
  return { spawn, held, workers };
}

const pllH: TrainingProfile = { request: { kind: "pll", caseIds: ["pll-H"] } };
const oll27: TrainingProfile = {
  request: { kind: "oll", caseIds: ["oll-27"] },
};

it("late PLL result cannot replace the selected OLL scramble", async () => {
  const worker = fakeWorker();
  const client = createTrainingClient(worker.spawn);

  const four = client.requestTraining(pllH, 4);
  const five = client.requestTraining(oll27, 5);
  // The newer request completes first, the older one after it.
  worker.held[1]?.reply();
  worker.held[0]?.reply();
  const [late, shown] = await Promise.all([four, five]);
  expect(late).toBeNull();
  expect(shown).toEqual({
    sequence: 5,
    scramble: `scramble for ${JSON.stringify(oll27)}`,
    caseId: "oll-27",
  });

  // A solution asked for, then the normal 3×3 chosen before it comes: never shown.
  const solution = client.requestSolution("R", "D", "cross", 6);
  client.reset(7);
  worker.held[2]?.reply();
  expect(await solution).toBeNull();

  // Nothing picked: no scramble, so the timer cannot start.
  expect(trainingReady({ request: { kind: "pll", caseIds: [] } })).toBe(false);
  expect(trainingReady(oll27)).toBe(true);
  expect(trainingReady({ request: null })).toBe(true);
  await expect(
    client.requestTraining({ request: { kind: "pll", caseIds: [] } }, 8),
  ).resolves.toBeNull();

  // A long search is ended for a newer one: its worker goes, the next one answers.
  const slow = client.requestSolution("R U F", "D", "xcross", 9);
  const quick = client.requestSolution("R", "D", "cross", 10);
  expect(worker.workers.filter((w) => w.terminated).length).toBeGreaterThan(0);
  worker.held.at(-1)?.reply();
  expect(await slow).toBeNull();
  expect(await quick).toEqual({ sequence: 10, moves: ["R'"], length: 1 });
});

it("a last-layer drill is renamed for the colours held, a cross drill is not", () => {
  const ll = { kind: "pll", caseIds: ["x"] } as const;
  // Yellow on top, green in front: the case must come up on the yellow side.
  expect(heldScramble(ll, "R U R' F2 D", "DF")).toBe("L D L' F2 U");
  expect(heldScramble(ll, "R U R'", "UF")).toBe("R U R'");
  expect(heldScramble({ kind: "two-gen" }, "R U2 R'", "DF")).toBe("L D2 L'");
  const cross = { kind: "easy-cross", face: "U", length: 3 } as const;
  expect(heldScramble(cross, "R U F", "DF")).toBe("R U F");
  expect(heldScramble(null, "R U F", "DF")).toBe("R U F");
});
