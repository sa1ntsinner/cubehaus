import { describe, expect, it } from "vitest";
import { keyLabel } from "./label";

describe("keyLabel", () => {
  it("names letters and digits by what is printed on the key", () => {
    expect(keyLabel("KeyD", true)).toBe("D");
    expect(keyLabel("Digit2", false)).toBe("2");
    expect(keyLabel("F2", true)).toBe("F2");
  });

  it("draws arrows, brackets and the erase key as on the keyboard (DESIGN.md §8, §18)", () => {
    expect(keyLabel("ArrowUp", true)).toBe("↑");
    expect(keyLabel("ArrowDown", false)).toBe("↓");
    expect(keyLabel("ArrowLeft", true)).toBe("←");
    expect(keyLabel("ArrowRight", true)).toBe("→");
    expect(keyLabel("BracketLeft", true)).toBe("[");
    expect(keyLabel("BracketRight", false)).toBe("]");
    expect(keyLabel("Backspace", true)).toBe("⌫");
    expect(keyLabel("Delete", false)).toBe("Del");
    expect(keyLabel("Escape", true)).toBe("Esc");
    expect(keyLabel("Space", true)).toBe("Space");
  });

  it("writes Mod as ⌘ on a Mac and Ctrl elsewhere", () => {
    expect(keyLabel("Mod+KeyZ", true)).toBe("⌘Z");
    expect(keyLabel("Mod+KeyZ", false)).toBe("Ctrl+Z");
    expect(keyLabel("Mod+KeyK", false)).toBe("Ctrl+K");
  });

  it("writes Alt as ⌥ on a Mac and Alt elsewhere", () => {
    expect(keyLabel("Alt+Digit6", true)).toBe("⌥6");
    expect(keyLabel("Alt+Digit6", false)).toBe("Alt+6");
  });

  it("names a shifted key by the character it types", () => {
    expect(keyLabel("Shift+Slash", true)).toBe("?");
    expect(keyLabel("Shift+Slash", false)).toBe("?");
  });

  it("writes the size keys by what is printed on them", () => {
    expect(keyLabel("Shift+Equal", true)).toBe("+");
    expect(keyLabel("Equal", false)).toBe("=");
    expect(keyLabel("Minus", true)).toBe("-");
    expect(keyLabel("NumpadAdd", true)).toBe("Num +");
    expect(keyLabel("NumpadSubtract", false)).toBe("Num -");
  });

  it("leaves a code it does not know as it is", () => {
    expect(keyLabel("NumpadEnter", true)).toBe("NumpadEnter");
  });
});
