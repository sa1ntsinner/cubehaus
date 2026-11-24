/**
 * The trainer widget's set, read from the trainer's own storage and data. Loaded on its
 * own (it brings the set's cases), and only in the phone app once a set is chosen.
 */
import { loadTrainerSet, type SetId } from "@cubehaus/algs/trainer";
import type { Store } from "@cubehaus/storage";
import { caseLabels, familyOf, setWord, type TrainSet } from "./train-state";
import { type WidgetTrainer, widgetTrainer } from "./widget-snapshot";

export async function readWidgetTrainer(
  trainer: Store["trainer"],
  set: string,
  bottoms: { adj: string; diag: string },
): Promise<WidgetTrainer | null> {
  let cases: Awaited<ReturnType<typeof loadTrainerSet>>;
  try {
    cases = await loadTrainerSet(set as SetId);
  } catch {
    // A set this build does not know (a setting from a newer one): no widget set.
    return null;
  }
  // The word the set row shows; OLL's and COLL's members by their own names (CMLL).
  const family = familyOf(set as TrainSet);
  return widgetTrainer({
    set,
    name: setWord(family === "oll" || family === "coll" ? set : family),
    ids: cases.map((c) => c.id),
    learning: await trainer.cases(set),
    labels: caseLabels(set as TrainSet, cases, bottoms),
  });
}
