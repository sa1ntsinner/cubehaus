import type { CaseSource } from "./types";

/**
 * PLL candidates, written from memory of the algorithms cubers commonly use. Nothing here
 * ships as it is: the data build verifies each one on two cube models, drops what fails
 * and keeps the best three by score (metrics.ts).
 */
export const PLL: readonly CaseSource[] = [
  {
    label: "Aa",
    algs: [
      "x R' U R' D2 R U' R' D2 R2 x'",
      "x L2 D2 L' U' L D2 L' U L' x'",
      "R' F R' B2 R F' R' B2 R2",
      "l' U R' D2 R U' R' D2 R2 x'",
    ],
  },
  {
    label: "Ab",
    algs: [
      "x R2 D2 R U R' D2 R U' R x'",
      "x L U' L D2 L' U L D2 L2 x'",
      "R B' R F2 R' B R F2 R2",
      "x' R U' R D2 R' U R D2 R2 x",
    ],
  },
  {
    label: "E",
    algs: [
      "x' R U' R' D R U R' D' R U R' D R U' R' D' x",
      "R2 U R' U' y R U R' U' R U R' U' R U R' y' R U' R2",
      "x' L' U L D' L' U' L D L' U' L D' L' U L D x",
    ],
  },
  {
    label: "F",
    algs: [
      "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R",
      "R' U R U' R2 F' U' F U R F R' F' R2",
      "M' U2 L F' R U2 r' U r' R2 U2 R2",
    ],
  },
  {
    label: "Ga",
    algs: [
      "R2 U R' U R' U' R U' R2 U' D R' U R D'",
      "R2 u R' U R' U' R u' R2 y' R' U R",
      "R U2 R' U' F' R U R2 U' R' F R U R2 U2 R'",
    ],
  },
  {
    label: "Gb",
    algs: [
      "R' U' R U D' R2 U R' U R U' R U' R2 D",
      "F' U' F R2 u R' U R U' R u' R2",
      "R' d' F R2 u R' U R U' R u' R2",
    ],
  },
  {
    label: "Gc",
    algs: [
      "R2 U' R U' R U R' U R2 U D' R U' R' D",
      "R2 u' R U' R U R' u R2 y R U' R'",
      "R2 F2 R U2 R U2 R' F R U R' U' R' F R2",
    ],
  },
  {
    label: "Gd",
    algs: [
      "R U R' U' D R2 U' R U' R' U R' U R2 D'",
      "R U R' y' R2 u' R U' R' U R' u R2",
      "f R f' R2 u' R U' R' U R' u R2",
    ],
  },
  {
    label: "H",
    algs: [
      "M2 U M2 U2 M2 U M2",
      "M2 U' M2 U2 M2 U' M2",
      "R2 U2 R U2 R2 U2 R2 U2 R U2 R2",
    ],
  },
  {
    label: "Ja",
    algs: [
      "x R2 F R F' R U2 r' U r U2 x'",
      "L' U' L F L' U' L U L F' L2 U L",
      "R' U L' U2 R U' R' U2 R L",
      "R' U2 R U R' U2 L U' R U L'",
    ],
  },
  {
    label: "Jb",
    algs: [
      "R U R' F' R U R' U' R' F R2 U' R'",
      "R U2 R' U' R U2 L' U R' U' L",
      "L' U R U' L U2 R' U R U2 R'",
    ],
  },
  {
    label: "Na",
    algs: [
      "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'",
      "L U' R U2 L' U R' L U' R U2 L' U R'",
      "z D R' U R2 D' R D U' R' U R2 D' R U' R z'",
    ],
  },
  {
    label: "Nb",
    algs: [
      "R' U R U' R' F' U' F R U R' F R' F' R U' R",
      "R' U L' U2 R U' L R' U L' U2 R U' L",
      "z U' R D' R2 U R' D U' R D' R2 U R' D z'",
    ],
  },
  {
    label: "Ra",
    algs: [
      "R U' R' U' R U R D R' U' R D' R' U2 R'",
      "R U R' F' R U2 R' U2 R' F R U R U2 R'",
      "L U2 L' U2 L F' L' U' L U L F L2",
    ],
  },
  {
    label: "Rb",
    algs: [
      "R2 F R U R U' R' F' R U2 R' U2 R",
      "R' U2 R U2 R' F R U R' U' R' F' R2",
      "R' U2 R' D' R U R' D R U R U' R' U' R",
    ],
  },
  {
    label: "T",
    algs: [
      "R U R' U' R' F R2 U' R' U' R U R' F'",
      "R U R' U' R2 D R' U R D' R2 U' R U' R'",
    ],
  },
  {
    label: "Ua",
    algs: [
      "M2 U M U2 M' U M2",
      "R U' R U R U R U' R' U' R2",
      "R2 U' R' U' R U R U R U' R",
    ],
  },
  {
    label: "Ub",
    algs: [
      "M2 U' M U2 M' U' M2",
      "R2 U R U R' U' R' U' R' U R'",
      "R' U R' U' R' U' R' U R U R2",
    ],
  },
  {
    label: "V",
    algs: [
      "R' U R' U' y R' F' R2 U' R' U R' F R F",
      "R' U R' d' R' F' R2 U' R' U R' F R F",
      "R U' R U R' D R D' R U' D R2 U R2 D' R2",
    ],
  },
  {
    label: "Y",
    algs: [
      "F R U' R' U' R U R' F' R U R' U' R' F R F'",
      "F R' F R2 U' R' U' R U R' F' R U R' U' F'",
      "R2 U' R2 U' R2 U y' R U R' B2 R U' R'",
    ],
  },
  {
    label: "Z",
    algs: [
      "M' U M2 U M2 U M' U2 M2",
      "M2 U M2 U M' U2 M2 U2 M'",
      "R' U' R U' R U R U' R' U R U R2 U' R'",
    ],
  },
];
