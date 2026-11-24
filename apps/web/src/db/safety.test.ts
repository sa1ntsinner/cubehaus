import { expect, test } from "vitest";
import {
  COPY_DAYS,
  COPY_SOLVES,
  DAY_MS,
  HOME_SOLVES,
  type SafetyFacts,
  safetyLine,
  wasWiped,
} from "./safety";

const now = 1_800_000_000_000;
const facts = (over: Partial<SafetyFacts> = {}): SafetyFacts => ({
  persisted: false,
  ios: false,
  safari: false,
  standalone: false,
  solves: COPY_SOLVES,
  now,
  savedAt: null,
  offeredAt: null,
  homeSaid: false,
  ...over,
});

test("a large history only this browser keeps is offered a copy", () => {
  expect(safetyLine(facts())).toBe("copy");
  expect(safetyLine(facts({ solves: COPY_SOLVES - 1 }))).toBeNull();
  // Chrome or Firefox granted persistence: nothing to say.
  expect(safetyLine(facts({ persisted: true }))).toBeNull();
});

test("the copy is offered again only after a quiet spell, and not after a saved one", () => {
  const recent = now - (COPY_DAYS * DAY_MS - 1);
  const old = now - COPY_DAYS * DAY_MS;
  expect(safetyLine(facts({ offeredAt: recent }))).toBeNull();
  expect(safetyLine(facts({ offeredAt: old }))).toBe("copy");
  expect(safetyLine(facts({ savedAt: recent }))).toBeNull();
  expect(safetyLine(facts({ savedAt: old, offeredAt: old }))).toBe("copy");
});

test("Safari outside the Home Screen stays at risk even with persistence", () => {
  expect(safetyLine(facts({ persisted: true, safari: true }))).toBe("copy");
  expect(
    safetyLine(facts({ persisted: true, safari: true, standalone: true })),
  ).toBeNull();
});

test("an iPhone outside the Home Screen hears how to keep its solves, once", () => {
  const phone = { ios: true, safari: true, solves: HOME_SOLVES };
  expect(safetyLine(facts(phone))).toBe("home");
  expect(safetyLine(facts({ ...phone, solves: HOME_SOLVES - 1 }))).toBeNull();
  expect(safetyLine(facts({ ...phone, standalone: true }))).toBeNull();
  // Said once; a large history is then offered the copy like anywhere else.
  expect(safetyLine(facts({ ...phone, homeSaid: true }))).toBeNull();
  expect(
    safetyLine(facts({ ...phone, homeSaid: true, solves: COPY_SOLVES })),
  ).toBe("copy");
});

test("an empty history where this device counted solves was wiped", () => {
  expect(wasWiped(120, 0)).toBe(true);
  expect(wasWiped(null, 0)).toBe(false);
  expect(wasWiped(0, 0)).toBe(false);
  expect(wasWiped(120, 3)).toBe(false);
});
