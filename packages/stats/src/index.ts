export {
  best,
  parseStat,
  type Stat,
  statOf,
  summary,
  trimCount,
} from "./average";
export {
  ASSIGN,
  assignColour,
  type ColourEntry,
  type ColourStanding,
  colourAverage,
  colourGaps,
  colourSummary,
  gapTrend,
  seedOf,
} from "./colours";
export {
  type Forecast,
  type ForecastDay,
  type ForecastReason,
  forecast,
} from "./forecast";
export { OrderStatistics } from "./order-statistics";
export {
  byDay,
  type DayStat,
  distribution,
  histogram,
  pbHistory,
  practice,
  quantile,
} from "./progress";
export { rankedWindowThreshold, rolling } from "./rolling";

export type StatId = "best" | "mean" | "mo3" | `ao${number}`;
export { type SplitStanding, splitSummary } from "./splits";
