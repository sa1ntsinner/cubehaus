import type { EventId, Solve } from "@cubehaus/core";
import type { TimerPhase } from "@cubehaus/timer";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Timer } from "./Timer";

const solve: Solve = {
  id: "a",
  sessionId: "s",
  event: "333",
  timeMs: 11_284,
  plus2: 0,
  dnf: false,
  scramble: "R",
  startedAt: 0,
  inspectionMs: null,
  comment: null,
  input: "keyboard",
};

const render = (
  newest: Solve | undefined,
  event: EventId = newest?.event ?? "333",
  phase: TimerPhase = "idle",
  displayMs = 0,
) =>
  renderToStaticMarkup(
    createElement(Timer, {
      scramble: "R F",
      event,
      pending: false,
      retry: () => {},
      phase,
      displayMs,
      newest,
      justStopped: false,
      showPicture: false,
      pictureButton: null,
      pictureZoom: null,
      onPictureOpen: () => {},
      onPictureClosed: () => {},
    }),
  );

const note = (html: string) =>
  html.match(/<p data-part="time-note"[^>]*>([^<]*)<\/p>/)?.slice(0, 2);

test("DESIGN §7: a +2 shows its sum under the time", () => {
  const html = render({ ...solve, plus2: 1 });
  expect(note(html)?.[1]).toBe("11.28 + 2");
  expect(html).toContain('data-part="time-note" data-kind="sum"');
  expect(note(render({ ...solve, plus2: 2 }))?.[1]).toBe("11.28 + 4");
});

test("DESIGN §7: a DNF shows its raw result under the time, without the +2", () => {
  const html = render({ ...solve, plus2: 1, dnf: true });
  expect(note(html)?.[1]).toBe("(11.28)");
  expect(html).toContain('data-part="time-note" data-kind="raw"');
  expect(
    note(render({ ...solve, event: "333fm", moves: 81, dnf: true }))?.[1],
  ).toBe("(81)");
});

test("a clean result, no result and the inspection count have no note", () => {
  expect(render(solve)).not.toContain("time-note");
  expect(render(undefined)).not.toContain("time-note");
});

const multi: Solve = {
  ...solve,
  event: "333mbf",
  timeMs: 1_470_000,
  cubesSolved: 3,
  cubesAttempted: 3,
};

test("a stored Multi-Blind attempt carries a sizing hook on the large time", () => {
  expect(render(multi)).toMatch(
    /<output[^>]*data-result-kind="multi"[^>]*>3\/3 24:30<\/output>/,
  );
});

test("a Multi-Blind DNF includes its counts and time on a single line", () => {
  const html = render({
    ...multi,
    cubesSolved: 1,
    timeMs: 1_712_000,
    dnf: true,
  });
  expect(html).toContain(">DNF (1/3 28:32)</output>");
  expect(note(html)).toBeUndefined();
});

test("Multi-Blind shows zero with no attempt and a clock while running", () => {
  const idle = render(undefined, "333mbf");
  const running = render(multi, "333mbf", "running", 11_284);
  expect(idle).toContain(">0.00</output>");
  expect(running).toContain(">11.28</output>");
  expect(idle + running).not.toContain("data-result-kind");
});
