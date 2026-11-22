// How a binding is written on screen (DESIGN.md sections 8 and 18): by what is printed
// on the key, with the Mac's modifier signs on a Mac and their names elsewhere.

const keys: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  BracketLeft: "[",
  BracketRight: "]",
  Backspace: "⌫",
  Delete: "Del",
  Escape: "Esc",
  Slash: "/",
  Equal: "=",
  Minus: "-",
  NumpadAdd: "Num +",
  NumpadSubtract: "Num -",
  Space: "Space",
  Enter: "Enter",
};

// Keys whose shifted character is what a person looks for.
const shifted: Record<string, string> = { Slash: "?", Equal: "+" };

const mac: Record<string, string> = {
  Mod: "⌘",
  Meta: "⌘",
  Ctrl: "⌃",
  Alt: "⌥",
  Shift: "⇧",
};
const other: Record<string, string> = {
  Mod: "Ctrl",
  Meta: "Win",
  Ctrl: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
};

const sideNames = {
  en: { Left: "Left", Right: "Right" },
  ru: { Left: "Левый", Right: "Правый" },
};

function keyName(code: string, language: "en" | "ru"): string {
  const match = /^(Control|Alt|Shift|Meta)(Left|Right)$/.exec(code);
  if (match) {
    const [, name, side] = match;
    const label = name === "Control" ? "Ctrl" : name === "Meta" ? "Meta" : name;
    return `${sideNames[language][side as "Left" | "Right"]} ${label}`;
  }
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1] as string;
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1] as string;
  return keys[code] ?? code;
}

export function keyLabel(
  binding: string,
  isMac: boolean,
  language: "en" | "ru" = "en",
): string {
  const parts = binding.split("+");
  const code = parts.pop() as string;
  if (parts.length === 1 && parts[0] === "Shift" && shifted[code])
    return shifted[code];
  const names = isMac ? mac : other;
  const modifiers = parts.map((part) => names[part] ?? part);
  const key = keyName(code, language);
  return isMac ? modifiers.join("") + key : [...modifiers, key].join("+");
}

export const isMacPlatform = (): boolean =>
  /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "");
