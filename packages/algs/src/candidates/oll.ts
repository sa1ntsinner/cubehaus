import type { CaseSource } from "./types";

/**
 * OLL candidates, written from memory of the algorithms cubers commonly use, verified and
 * ranked by the data build like every other set.
 */
export const OLL: readonly CaseSource[] = [
  {
    label: "OLL 1",
    algs: ["R U2 R2 F R F' U2 R' F R F'", "R U B' R B R2 U' R' F R F'"],
  },
  {
    label: "OLL 2",
    algs: [
      "F R U R' U' F' f R U R' U' f'",
      "r U r' U2 r U2 R' U2 R U' r'",
      "F R U R' U' S R U R' U' f'",
    ],
  },
  {
    label: "OLL 3",
    algs: ["f R U R' U' f' U' F R U R' U' F'", "r' R2 U R' U r U2 r' U M'"],
  },
  {
    label: "OLL 4",
    algs: ["f R U R' U' f' U F R U R' U' F'", "M U' r U2 r' U' R U' R' M'"],
  },
  {
    label: "OLL 5",
    algs: ["r' U2 R U R' U r", "l' U2 L U L' U l"],
  },
  {
    label: "OLL 6",
    algs: ["r U2 R' U' R U' r'", "l U2 L' U' L U' l'"],
  },
  {
    label: "OLL 7",
    algs: ["r U R' U R U2 r'", "L' U2 L U L' U l"],
  },
  {
    label: "OLL 8",
    algs: ["l' U' L U' L' U2 l", "R U2 R' U2 R' F R F'"],
  },
  {
    label: "OLL 9",
    algs: ["R U R' U' R' F R2 U R' U' F'", "L' U' L U' L F' L' F L' U2 L"],
  },
  {
    label: "OLL 10",
    algs: ["R U R' U R' F R F' R U2 R'", "R U R' y R' F R U' R' F' R"],
  },
  {
    label: "OLL 11",
    algs: ["r U R' U R' F R F' R U2 r'", "M R U R' U R U2 R' U M'"],
  },
  {
    label: "OLL 12",
    algs: [
      "F R U R' U' F' U F R U R' U' F'",
      "M' R' U' R U' R' U2 R U' M",
      "r R2 U' R U' R' U2 R U' R r'",
    ],
  },
  {
    label: "OLL 13",
    algs: ["F U R U' R2 F' R U R U' R'", "r U' r' U' r U r' F' U F"],
  },
  {
    label: "OLL 14",
    algs: ["R' F R U R' F' R F U' F'", "r' U r U r' U' r F U' F'"],
  },
  {
    label: "OLL 15",
    algs: ["r' U' r R' U' R U r' U r", "l' U' l L' U' L U l' U l"],
  },
  {
    label: "OLL 16",
    algs: ["r U r' R U R' U' r U' r'", "R' F R U R' U' F' R U' R' U2 R"],
  },
  {
    label: "OLL 17",
    algs: ["R U R' U R' F R F' U2 R' F R F'", "F R' F' R2 r' U R U' R' U' M'"],
  },
  {
    label: "OLL 18",
    algs: [
      "r U R' U R U2 r2 U' R U' R' U2 r",
      "R U2 R2 F R F' U2 M' U R U' r'",
    ],
  },
  {
    label: "OLL 19",
    algs: ["M U R U R' U' M' R' F R F'", "r' R U R U R' U' M' R' F R F'"],
  },
  {
    label: "OLL 20",
    algs: ["r U R' U' M2 U R U' R' U' M'", "M' U2 M U2 M' U M U2 M' U2 M"],
  },
  {
    label: "OLL 21",
    algs: ["R U2 R' U' R U R' U' R U' R'", "R U R' U R U' R' U R U2 R'"],
  },
  {
    label: "OLL 22",
    algs: ["R U2 R2 U' R2 U' R2 U2 R", "f R U R' U' f' F R U R' U' F'"],
  },
  {
    label: "OLL 23",
    algs: ["R2 D' R U2 R' D R U2 R", "R2 D R' U2 R D' R' U2 R'"],
  },
  {
    label: "OLL 24",
    algs: ["r U R' U' r' F R F'", "L F R' F' L' F R F'"],
  },
  {
    label: "OLL 25",
    algs: ["F' r U R' U' r' F R", "R' F R B' R' F' R B"],
  },
  {
    label: "OLL 26",
    algs: ["R U2 R' U' R U' R'", "L' U' L U' L' U2 L"],
  },
  {
    label: "OLL 27",
    algs: ["R U R' U R U2 R'", "L' U2 L U L' U L"],
  },
  {
    label: "OLL 28",
    algs: ["r U R' U' M U R U' R'", "M' U M U2 M' U M"],
  },
  {
    label: "OLL 29",
    algs: ["R U R' U' R U' R' F' U' F R U R'", "M U R U R' U' R' F R F' M'"],
  },
  {
    label: "OLL 30",
    algs: ["F U R U2 R' U' R U2 R' U' F'", "F R' F R2 U' R' U' R U R' F2"],
  },
  {
    label: "OLL 31",
    algs: ["R' U' F U R U' R' F' R", "S' L' U' L U L F' L' f"],
  },
  {
    label: "OLL 32",
    algs: ["L U F' U' L' U L F L'", "R U B' U' R' U R B R'"],
  },
  {
    label: "OLL 33",
    algs: ["R U R' U' R' F R F'", "F R U' R' U R U R' F'"],
  },
  {
    label: "OLL 34",
    algs: ["R U R2 U' R' F R U R U' F'", "R U R' U' B' R' F R F' B"],
  },
  {
    label: "OLL 35",
    algs: ["R U2 R2 F R F' R U2 R'", "f R U R' U' f' R U R' U R U2 R'"],
  },
  {
    label: "OLL 36",
    algs: ["L' U' L U' L' U L U L F' L' F", "R' U' R U' R' U R U l U' R' U x"],
  },
  {
    label: "OLL 37",
    algs: ["F R' F' R U R U' R'", "F R U' R' U' R U R' F'"],
  },
  {
    label: "OLL 38",
    algs: ["R U R' U R U' R' U' R' F R F'", "L' U' L F L' U' L U L F' L' U L"],
  },
  {
    label: "OLL 39",
    algs: ["L F' L' U' L U F U' L'", "R B' R' U' R U B U' R'"],
  },
  {
    label: "OLL 40",
    algs: ["R' F R U R' U' F' U R", "L' B L U L' U' B' U L"],
  },
  {
    label: "OLL 41",
    algs: ["R U R' U R U2 R' F R U R' U' F'", "R U' R' U2 R U y R U' R' U' F'"],
  },
  {
    label: "OLL 42",
    algs: [
      "R' U' R U' R' U2 R F R U R' U' F'",
      "R' F R F' R' F R F' R U R' U' R U R'",
    ],
  },
  {
    label: "OLL 43",
    algs: ["R' U' F' U F R", "f' L' U' L U f"],
  },
  {
    label: "OLL 44",
    algs: ["f R U R' U' f'", "F U R U' R' F'"],
  },
  {
    label: "OLL 45",
    algs: ["F R U R' U' F'", "f U R U' R' f'"],
  },
  {
    label: "OLL 46",
    algs: ["R' U' R' F R F' U R", "R' F' U' F R U R' U R"],
  },
  {
    label: "OLL 47",
    algs: ["R' U' R' F R F' R' F R F' U R", "F' L' U' L U L' U' L U F"],
  },
  {
    label: "OLL 48",
    algs: ["F R U R' U' R U R' U' F'", "R U2 R' U' R U R' U2 R' F R F'"],
  },
  {
    label: "OLL 49",
    algs: ["r U' r2 U r2 U r2 U' r", "R B' R2 F R2 B R2 F' R"],
  },
  {
    label: "OLL 50",
    algs: ["r' U r2 U' r2 U' r2 U r'", "R' F R2 B' R2 F' R2 B R'"],
  },
  {
    label: "OLL 51",
    algs: ["F U R U' R' U R U' R' F'", "f R U R' U' R U R' U' f'"],
  },
  {
    label: "OLL 52",
    algs: ["R U R' U R U' B U' B' R'", "R' U' R U' R' U y' R' U R B"],
  },
  {
    label: "OLL 53",
    algs: ["r' U' R U' R' U R U' R' U2 r", "l' U2 L U L' U' L U L' U l"],
  },
  {
    label: "OLL 54",
    algs: ["r U R' U R U' R' U R U2 r'", "r U2 R' U' R U R' U' R U' r'"],
  },
  {
    label: "OLL 55",
    algs: [
      "R U2 R2 U' R U' R' U2 F R F'",
      "R' F R U R U' R2 F' R2 U' R' U R U R'",
    ],
  },
  {
    label: "OLL 56",
    algs: [
      "r' U' r U' R' U R U' R' U R r' U r",
      "F R U R' U' R F' r U R' U' r'",
    ],
  },
  {
    label: "OLL 57",
    algs: ["R U R' U' M' U R U' r'", "M' U M' U M' U2 M U M U M U2"],
  },
];
