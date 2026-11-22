import { countMoves } from "@cubehaus/core";
import { puzzles } from "cubing/puzzles";

export async function checkFewestMoves(
  scramble: string,
  solution: string,
): Promise<{ moves: number } | { dnf: string }> {
  const count = countMoves(solution);
  if ("error" in count) return { dnf: count.error };
  if (count.etm > 80) return { dnf: "Solution exceeds 80 ETM" };

  // cubing treats lower-case face letters as wide moves. Normalize the
  // written WCA notation before using the library's parser.
  const normalized = solution
    .trim()
    .replace(/\s+/g, " ")
    .replace(
      /2?([rludfb])(w)?/gi,
      (_, face: string, wide?: string) =>
        face.toUpperCase() + (wide ? "w" : ""),
    )
    .replace(/[XYZ]/g, (axis) => axis.toLowerCase())
    .replaceAll("2'", "2");
  const kpuzzle = await puzzles["3x3x3"]?.kpuzzle();
  if (!kpuzzle) throw new Error("Missing 3x3x3 puzzle definition");
  const solved = kpuzzle
    .defaultPattern()
    .applyAlg(scramble)
    .applyAlg(normalized)
    .experimentalIsSolved({
      ignorePuzzleOrientation: true,
      ignoreCenterOrientation: true,
    });
  return solved
    ? { moves: count.obtm }
    : { dnf: "Solution does not solve the cube" };
}
