/**
 * Field attributes for the short names people give their own things (a session, a folder,
 * a session coming in from a file). iOS Safari offers "AutoFill Contact" over the keyboard
 * on a field whose label, placeholder, name or id says "name" (seen in the simulator, iOS
 * 27): autocomplete="off" does not stop it, so no such field's words say "name" (fields.test.ts
 * holds the words to it), and its own name says what it holds. No autocorrect: it turns
 * "OH" into "Oh" and "pll" into "pill".
 */
export function titleField(name: string) {
  return {
    name,
    autoComplete: "off",
    autoCorrect: "off",
    autoCapitalize: "sentences",
    spellCheck: false,
    inputMode: "text",
    enterKeyHint: "done",
  } as const;
}
