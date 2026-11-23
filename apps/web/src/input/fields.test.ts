import { expect, test } from "vitest";
import { textFor } from "../text";
import { titleField } from "./fields";

// iOS offers a contact's details over the keyboard on any field whose label or placeholder
// has the word "name" in it, whatever autocomplete says.
test("no title field's words or name say 'name'", () => {
  for (const language of ["en", "ru"] as const) {
    const words = textFor(language);
    for (const label of [words.sessionName, words.switcher.folder])
      expect(label).not.toMatch(/\bname\b/i);
  }
  for (const field of ["session-title", "folder-title", "import-session-title"])
    expect(titleField(field).name).not.toMatch(/\bname\b/i);
  expect(titleField("session-title").autoComplete).toBe("off");
});
