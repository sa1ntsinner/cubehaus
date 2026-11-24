import { expect, test } from "vitest";
import { isHardwareKey, launched, showsKeys } from "./hardware-keys";

test("keys show on a pointer's screen, never on a phone, on a tablet after a hardware key for three quiet launches", () => {
  const field = { tagName: "INPUT", type: "text" } as unknown as EventTarget;
  const page = { tagName: "MAIN" } as unknown as EventTarget;

  expect(showsKeys(null, false, false)).toBe(true);
  expect(showsKeys({ quiet: 0 }, true, true)).toBe(false);
  expect(showsKeys(null, true, false)).toBe(false);

  // A screen keyboard types into fields and composes; outside a field any key is physical.
  expect(isHardwareKey({ key: "a", target: field })).toBe(false);
  expect(isHardwareKey({ key: "a", isComposing: true, target: page })).toBe(
    false,
  );
  expect(isHardwareKey({ key: "Unidentified", target: page })).toBe(false);
  expect(isHardwareKey({ key: " ", isTrusted: false, target: page })).toBe(
    false,
  );
  for (const key of [" ", "Escape", "ArrowUp", "Shift", "Meta"])
    expect(isHardwareKey({ key, target: page })).toBe(true);

  let memory = launched({ quiet: 0 });
  expect(showsKeys(memory, true, false)).toBe(true);
  memory = launched(launched(memory));
  expect(memory).toEqual({ quiet: 3 });
  expect(showsKeys(memory, true, false)).toBe(true);
  expect(launched(memory)).toBeNull();
  expect(launched(null)).toBeNull();
});
