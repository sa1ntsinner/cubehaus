export type EventId =
  | "333"
  | "222"
  | "444"
  | "555"
  | "666"
  | "777"
  | "333bf"
  | "333fm"
  | "333oh"
  | "clock"
  | "minx"
  | "pyram"
  | "skewb"
  | "sq1"
  | "444bf"
  | "555bf"
  | "333mbf"
  | "fto";

export type RoundFormat = "ao5" | "mo3" | "bo1" | "bo2" | "bo3" | "bo5";
export type ResultKind = "time" | "moves" | "multi";

export interface EventInfo {
  id: EventId;
  rank: number;
  name: string;
  nameRu: string;
  label: string;
  format: RoundFormat;
  recognised: "ao5" | "mo3" | null;
  kind: ResultKind;
  inspectionMs: number | null;
  officialFrom: string | null;
  officialUntil: string | null;
}

type EventRules = Omit<EventInfo, "id" | "rank" | "name" | "nameRu" | "label">;

function event(
  id: EventId,
  rank: number,
  name: string,
  nameRu: string,
  label: string,
  rules?: Partial<EventRules>,
): EventInfo {
  return {
    id,
    rank,
    name,
    nameRu,
    label,
    format: "ao5",
    recognised: null,
    kind: "time",
    inspectionMs: 15000,
    officialFrom: null,
    officialUntil: null,
    ...rules,
  };
}

export const EVENTS: readonly EventInfo[] = [
  event("333", 10, "3x3x3 Cube", "Кубик 3x3x3", "3×3"),
  event("222", 20, "2x2x2 Cube", "Кубик 2x2x2", "2×2"),
  event("444", 30, "4x4x4 Cube", "Кубик 4x4x4", "4×4"),
  event("555", 40, "5x5x5 Cube", "Кубик 5x5x5", "5×5"),
  event("666", 50, "6x6x6 Cube", "Кубик 6x6x6", "6×6", { format: "mo3" }),
  event("777", 60, "7x7x7 Cube", "Кубик 7x7x7", "7×7", { format: "mo3" }),
  event("333bf", 70, "3x3x3 Blindfolded", "3x3x3 вслепую", "3BLD", {
    format: "bo5",
    recognised: "ao5",
    inspectionMs: null,
  }),
  event(
    "333fm",
    80,
    "3x3x3 Fewest Moves",
    "Сборка 3x3x3 на количество ходов",
    "FMC",
    {
      format: "mo3",
      kind: "moves",
      inspectionMs: null,
    },
  ),
  event("333oh", 90, "3x3x3 One-Handed", "3x3x3 одной рукой", "OH"),
  event("clock", 110, "Clock", "Clock", "Clock", {
    officialUntil: "2027-07-18",
  }),
  event("minx", 120, "Megaminx", "Мегаминкс", "Mega"),
  event("pyram", 130, "Pyraminx", "Пираминкс", "Pyraminx"),
  event("skewb", 140, "Skewb", "Скьюб", "Skewb"),
  event("sq1", 150, "Square-1", "Square-1", "Square-1"),
  event("444bf", 160, "4x4x4 Blindfolded", "4x4x4 вслепую", "4BLD", {
    format: "bo3",
    recognised: "mo3",
    inspectionMs: null,
  }),
  event("555bf", 170, "5x5x5 Blindfolded", "5x5x5 вслепую", "5BLD", {
    format: "bo3",
    recognised: "mo3",
    inspectionMs: null,
  }),
  event("333mbf", 180, "3x3x3 Multi-Blind", "Мульти-блайнд", "MBLD", {
    format: "bo3",
    kind: "multi",
    inspectionMs: null,
  }),
  event("fto", 810, "Face Turning Octahedron", "FTO", "FTO", {
    officialFrom: "2027-01-02",
  }),
];

export function isEventId(value: string): value is EventId {
  return EVENTS.some((event) => event.id === value);
}

export function eventInfo(id: EventId): EventInfo {
  const event = EVENTS.find((event) => event.id === id);
  if (!event) throw new RangeError(`Unknown event: ${id}`);
  return event;
}

export function hasTimePenalty(id: EventId): boolean {
  return eventInfo(id).kind !== "moves";
}

export function defaultStats(id: EventId): [string, string] {
  const { kind, format, recognised } = eventInfo(id);
  if (kind === "multi") return ["best", "count"];
  if (kind === "moves") return ["mo3", "best"];
  if (recognised) return ["best", recognised];
  if (format === "mo3") return ["mo3", "ao5"];
  return ["ao5", "ao12"];
}
