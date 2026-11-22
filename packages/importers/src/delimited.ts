/** Read comma- or semicolon-delimited records, preserving line endings inside quotes. */
export function readDelimited(text: string, separator: "," | ";"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let state: "start" | "plain" | "quoted" | "closed" = "start";
  const endCell = () => {
    row.push(cell);
    cell = "";
    state = "start";
  };
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (state === "quoted") {
      if (char !== '"') cell += char;
      else if (text[i + 1] === '"') {
        cell += char;
        i++;
      } else state = "closed";
    } else if (char === separator) {
      endCell();
    } else if (char === "\n" || char === "\r") {
      endCell();
      rows.push(row);
      row = [];
      if (char === "\r" && text[i + 1] === "\n") i++;
    } else if (char === '"' && state === "start") {
      state = "quoted";
    } else {
      if (char === '"' || state === "closed")
        throw new SyntaxError(`Invalid quoting in record ${rows.length + 1}`);
      state = "plain";
      cell += char;
    }
  }
  if (state === "quoted")
    throw new SyntaxError(`Unclosed quote in record ${rows.length + 1}`);
  if (state !== "start" || row.length > 0) {
    endCell();
    rows.push(row);
  }
  return rows;
}
