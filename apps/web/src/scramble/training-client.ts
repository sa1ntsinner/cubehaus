import type { CrossResult, Face } from "@cubehaus/cube";
import { holdingFaces, renameTurns } from "@cubehaus/cube/holding";
import type {
  TrainingBase,
  TrainingLastSlot,
  TrainingLL,
} from "@cubehaus/scramble";
import type { Text } from "../text";

/**
 * Drill scrambles and cross solutions from workers, so the timer never waits on them.
 *
 * Every request carries a sequence number; only the newest request's answer is shown.
 * An older answer that arrives late resolves to null, so a scramble asked for before
 * the drill changed can never become the one on screen (and so the one saved with the
 * solve). Scrambles come from one worker, kept for its tables; solutions from another,
 * which is ended and started afresh when a newer search arrives, so a long search never
 * holds up the next one.
 */
export type TrainingProfile =
  | { request: TrainingBase | TrainingLL | TrainingLastSlot }
  /** Official scrambles; `choice`: the drill of choosing the cross colour in inspection. */
  | { request: null; choice?: true };

export type WorkerLike = {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  terminate(): void;
};

/** The drill in a few words, for the line under the scramble. */
export function drillName(
  profile: TrainingProfile,
  words: Text,
  /** The cross colour is assigned and marked beside the line: the line leaves it out. */
  colourless = false,
): string | null {
  const request = profile.request;
  const t = words.drill;
  if (!request) return isChoosing(profile) ? t.choose : null;
  switch (request.kind) {
    case "easy-cross":
      return colourless
        ? t.anyCrossIn(request.length)
        : t.crossIn(request.length, t.colour[request.face]);
    case "easy-xcross":
      return colourless
        ? t.anyXcrossIn(request.length)
        : t.xcrossIn(request.length, t.colour[request.face]);
    case "cross-solved":
      return colourless
        ? t.anyCrossSolved
        : t.crossSolvedOn(t.colour[request.face]);
    case "edges-only":
      return t.edgesOnly;
    case "corners-only":
      return t.cornersOnly;
    case "two-gen":
      return t.twoGen;
    case "oll":
    case "pll":
    case "coll":
    case "ll":
    case "f2l":
      return t.cases(request.kind.toUpperCase(), request.caseIds.length);
    // Drilled in the trainer only (Algorithms), never as the timer's drill.
    case "ls-right":
    case "ls-front":
      return t.cases("LS", request.caseIds?.length ?? 0);
  }
}

/**
 * A drill scramble as the person applies it, in the scrambling orientation. Drills of
 * last-layer and F2L cases and of R and U mean the faces as the person holds them while solving,
 * so their turns are renamed for the holding; cross drills name a colour and stay.
 */
export function heldScramble(
  request: TrainingProfile["request"],
  scramble: string,
  holding: string,
): string {
  if (!request) return scramble;
  switch (request.kind) {
    case "oll":
    case "pll":
    case "coll":
    case "ll":
    case "f2l":
    case "ls-right":
    case "ls-front":
    case "two-gen":
      return renameTurns(scramble, holdingFaces(holding));
    default:
      return scramble;
  }
}

/** The drill of choosing the cross colour: official scrambles, inspection, a colour key. */
export function isChoosing(profile: TrainingProfile): boolean {
  return (
    profile.request === null && "choice" in profile && profile.choice === true
  );
}

type Reply = { id: number; ok: boolean; value?: unknown; error?: string };

/** False when a last-layer drill has no case picked: there is nothing to scramble. */
export function trainingReady(profile: TrainingProfile): boolean {
  const request = profile.request;
  return !(request && "caseIds" in request && request.caseIds.length === 0);
}

export type TrainingClient = {
  requestTraining(
    profile: TrainingProfile,
    sequence: number,
  ): Promise<{ sequence: number; scramble: string; caseId: string } | null>;
  requestSolution(
    scramble: string,
    face: Face,
    kind: "cross" | "xcross",
    sequence: number,
  ): Promise<
    (CrossResult & { sequence: number; slot?: number; pair?: Face[] }) | null
  >;
  /** Anything asked for before this sequence is dropped: a solution search ends. */
  reset(sequence: number): void;
  close(): void;
};

/** One worker and the requests waiting on it. */
function channel(spawn: () => WorkerLike) {
  let worker: WorkerLike | null = null;
  let next = 0;
  const waiting = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();
  const start = () => {
    const created = spawn();
    created.onmessage = ({ data }) => {
      const reply = data as Reply;
      const entry = waiting.get(reply.id);
      if (!entry) return;
      waiting.delete(reply.id);
      if (reply.ok) entry.resolve(reply.value);
      else entry.reject(new Error(reply.error ?? "Drill worker failed"));
    };
    return created;
  };
  return {
    send(message: Record<string, unknown>): Promise<unknown> {
      worker ??= start();
      const id = ++next;
      const sent = worker;
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        sent.postMessage({ ...message, id });
      });
    },
    get busy() {
      return waiting.size > 0;
    },
    /** Ends the worker; whatever waited on it gets null. */
    stop() {
      worker?.terminate();
      worker = null;
      for (const entry of waiting.values()) entry.resolve(null);
      waiting.clear();
    },
  };
}

export function createTrainingClient(spawn: () => WorkerLike): TrainingClient {
  const scrambles = channel(spawn);
  const solutions = channel(spawn);
  let latestTraining = Number.NEGATIVE_INFINITY;
  let latestSolution = Number.NEGATIVE_INFINITY;

  return {
    async requestTraining(profile, sequence) {
      latestTraining = Math.max(latestTraining, sequence);
      if (!profile.request || !trainingReady(profile)) return null;
      const value = (await scrambles.send({ type: "training", profile })) as {
        scramble: string;
        caseId: string;
      } | null;
      if (!value || sequence !== latestTraining) return null;
      return { sequence, ...value };
    },
    async requestSolution(scramble, face, kind, sequence) {
      latestSolution = Math.max(latestSolution, sequence);
      // A search still running is for an older scramble: end it.
      if (solutions.busy) solutions.stop();
      const value = (await solutions.send({
        type: "solution",
        scramble,
        face,
        kind,
      })) as (CrossResult & { slot?: number; pair?: Face[] }) | null;
      if (!value || sequence !== latestSolution) return null;
      return { sequence, ...value };
    },
    reset(sequence) {
      latestTraining = Math.max(latestTraining, sequence);
      latestSolution = Math.max(latestSolution, sequence);
      if (solutions.busy) solutions.stop();
    },
    close() {
      scrambles.stop();
      solutions.stop();
    },
  };
}
