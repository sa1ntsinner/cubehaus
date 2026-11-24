import type { Face } from "@cubehaus/cube";
import { holdingFaces } from "@cubehaus/cube/holding";
import type { TrainingBase, TrainingLL } from "@cubehaus/scramble";
import {
  type LastLayerCase,
  lastLayerCases,
} from "@cubehaus/scramble/last-layer";
import { useMemo, useState } from "react";
import { keepFocusInside } from "../input/tab-loop";
import type { Text } from "../text";
import { CaseDiagram } from "./TrainingDiagrams";
import { isChoosing, type TrainingProfile } from "./training-client";
import "../design/sheet.css";
import "../design/training.css";

/**
 * Drill scrambles for 3×3: the sheet that picks one, and the line under the scramble
 * that says a drill is on. A drill is not a WCA scramble; the line says so in words.
 */

/** The timer's drills: F2L and last-slot cases are drilled in the trainer only. */
export type DrillKind =
  | "official"
  | "cross-choice"
  | TrainingBase["kind"]
  | Exclude<TrainingLL["kind"], "f2l">;

/** The cross colours as cubers name them, by face in the scramble's orientation. */
export const FACES: readonly Face[] = ["U", "D", "F", "B", "R", "L"];
export const RANGES = { "easy-cross": 8, "easy-xcross": 6 } as const;

/** What a search matches: the name, and for OLL the shape of the top edges. */
function caseSearchText(c: LastLayerCase, words: Text): string {
  if (c.kind !== "oll") return c.label;
  const flipped = [0, 1, 2, 3].filter((e) => c.state.eo[e] === 1);
  const shape =
    flipped.length === 0
      ? "cross"
      : flipped.length === 4
        ? "dot"
        : (flipped[1] as number) - (flipped[0] as number) === 2
          ? "line"
          : "L";
  return `${c.label} ${words.drill.group[shape]}`;
}

const defaults = (kind: DrillKind, face: Face): TrainingProfile => {
  switch (kind) {
    case "official":
      return { request: null };
    case "cross-choice":
      return { request: null, choice: true };
    case "easy-cross":
      return { request: { kind, face, length: 4 } };
    case "easy-xcross":
      return { request: { kind, face, length: 3 } };
    case "cross-solved":
      return { request: { kind, face } };
    case "oll":
    case "pll":
    case "coll":
    case "ll":
      return { request: { kind, caseIds: [] } };
    default:
      return { request: { kind } };
  }
};

export function Training({
  profile,
  holding,
  colourAssigned = false,
  words,
  onChange,
  onClose,
}: {
  profile: TrainingProfile;
  holding: string;
  /** The session assigns the cross colour: a cross drill takes it, so it has no colour here. */
  colourAssigned?: boolean;
  words: Text;
  onChange(profile: TrainingProfile): void;
  onClose(): void;
}) {
  const t = words.drill;
  // The sheet shows each choice at once; the setting is saved behind it.
  const [draft, setDraft] = useState(profile);
  const change = (next: TrainingProfile) => {
    setDraft(next);
    onChange(next);
  };
  const request = draft.request;
  // F2L and last-slot cases are drilled in the trainer only.
  const kind: DrillKind = !request
    ? isChoosing(draft)
      ? "cross-choice"
      : "official"
    : request.kind === "f2l" ||
        request.kind === "ls-right" ||
        request.kind === "ls-front"
      ? "official"
      : request.kind;
  // A new cross drill is on the colour held at the bottom.
  const faces = holdingFaces(holding);
  const face: Face =
    request && "face" in request ? request.face : (faces.D as Face);
  const [query, setQuery] = useState("");
  const catalogue = useMemo(() => lastLayerCases(), []);
  const kinds: DrillKind[] = [
    "official",
    "easy-cross",
    "easy-xcross",
    "cross-solved",
    "cross-choice",
    "edges-only",
    "corners-only",
    "two-gen",
    "oll",
    "pll",
  ];
  const cases =
    kind === "oll" ? catalogue.oll : kind === "pll" ? catalogue.pll : [];
  const chosen = new Set(
    request && "caseIds" in request ? request.caseIds : [],
  );
  const shown = cases
    .filter((c) => !c.label.endsWith("skip"))
    .filter((c) =>
      caseSearchText(c, words)
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    );
  const setCases = (ids: Iterable<string>) =>
    change({
      request: { kind: kind as "oll" | "pll", caseIds: [...ids] },
    });

  return (
    <dialog
      data-part="training"
      tabIndex={-1}
      data-no-timer
      open
      aria-label={t.title}
      onBlur={keepFocusInside}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <button type="button" data-action="dialog-close" onClick={onClose}>
        {words.timer}
      </button>
      <fieldset data-part="training-kinds">
        <legend>{t.title}</legend>
        {kinds.map((option) => (
          <div key={option} data-kind={option}>
            <label>
              <input
                type="radio"
                name="drill"
                value={option}
                checked={kind === option}
                autoFocus={kind === option}
                onChange={() => change(defaults(option, face))}
              />{" "}
              {t.kind[option]}
            </label>
            {kind === option &&
              request &&
              "length" in request &&
              (option === "easy-cross" || option === "easy-xcross") && (
                <label data-part="training-length">
                  {t.turns}{" "}
                  <select
                    data-action="training-length"
                    value={request.length}
                    onChange={(event) =>
                      change({
                        request: {
                          ...request,
                          length: Number(event.target.value),
                        },
                      })
                    }
                  >
                    {Array.from(
                      { length: RANGES[option] + 1 },
                      (_, n) => n,
                    ).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            {kind === option &&
              request &&
              "face" in request &&
              !colourAssigned && (
                <label data-part="training-face">
                  {t.cross}{" "}
                  <select
                    data-action="training-face"
                    value={request.face}
                    onChange={(event) =>
                      change({
                        request: {
                          ...request,
                          face: event.target.value as Face,
                        },
                      })
                    }
                  >
                    {FACES.map((side) => (
                      <option key={side} value={side}>
                        {t.colour[side]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
          </div>
        ))}
      </fieldset>
      <p data-heard role="status">
        {(kind === "oll" || kind === "pll") && chosen.size === 0
          ? t.pickOne
          : ""}
      </p>
      {(kind === "oll" || kind === "pll") && (
        <section data-part="training-cases">
          <p data-part="training-case-tools">
            <input
              type="search"
              data-part="training-query"
              aria-label={t.find}
              placeholder={t.find}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />{" "}
            <button
              type="button"
              data-action="training-all"
              onClick={() =>
                setCases(new Set([...chosen, ...shown.map((c) => c.id)]))
              }
            >
              {t.all}
            </button>{" "}
            <button
              type="button"
              data-action="training-none"
              onClick={() =>
                setCases(
                  [...chosen].filter((id) => !shown.some((c) => c.id === id)),
                )
              }
            >
              {t.none}
            </button>
          </p>
          {chosen.size === 0 && <p data-part="training-empty">{t.pickOne}</p>}
          <ul data-part="training-case-list">
            {shown.map((c) => (
              <li key={c.id} data-case-id={c.id}>
                <button
                  type="button"
                  aria-pressed={chosen.has(c.id)}
                  onClick={() => {
                    const next = new Set(chosen);
                    if (next.has(c.id)) next.delete(c.id);
                    else next.add(c.id);
                    setCases(next);
                  }}
                >
                  <CaseDiagram
                    stickers={c.stickers}
                    faces={faces}
                    orientationOnly={kind === "oll"}
                  />
                  <span>{c.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </dialog>
  );
}
