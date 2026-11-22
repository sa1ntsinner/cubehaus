import {
  bar,
  lights,
  lightsOpposite,
  mixed,
  pair,
  type Side,
} from "../diagram";
import type { CaseSource } from "./types";

const SIDES: readonly Side[] = ["F", "R", "B", "L"];

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
    recognise: {
      en: "Headlights at the back. Around the front left corner both sides show a pair.",
      ru: "Фары сзади. У переднего левого угла с обеих сторон по паре.",
      check: (d) =>
        lights(d, "B") && pair(d, "F", "left") && pair(d, "L", "right"),
    },
  },
  {
    label: "Ab",
    algs: [
      "x R2 D2 R U R' D2 R U' R x'",
      "x L U' L D2 L' U L D2 L2 x'",
      "R B' R F2 R' B R F2 R2",
      "x' R U' R D2 R' U R D2 R2 x",
    ],
    recognise: {
      en: "Headlights on the right. Around the front left corner both sides show a pair.",
      ru: "Фары справа. У переднего левого угла с обеих сторон по паре.",
      check: (d) =>
        lights(d, "R") && pair(d, "F", "left") && pair(d, "L", "right"),
    },
  },
  {
    label: "E",
    algs: [
      "x' R U' R' D R U R' D' R U R' D R U' R' D' x",
      "R2 U R' U' y R U R' U' R U R' U' R U R' y' R U' R2",
      "x' L' U L D' L' U' L D L' U' L D' L' U L D x",
    ],
    recognise: {
      en: "No headlights and no bars: every side shows three different colours.",
      ru: "Ни фар, ни полос: на каждой стороне три разных цвета.",
      check: (d) => SIDES.every((s) => mixed(d, s)),
    },
  },
  {
    label: "F",
    algs: [
      "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R",
      "R' U R U' R2 F' U' F U R F R' F' R2",
      "M' U2 L F' R U2 r' U r' R2 U2 R2",
    ],
    recognise: {
      en: "A bar in front; every other side shows three different colours.",
      ru: "Полоса спереди, на остальных сторонах по три разных цвета.",
      check: (d) =>
        bar(d, "F") && mixed(d, "R") && mixed(d, "B") && mixed(d, "L"),
    },
  },
  {
    label: "Ga",
    algs: [
      "R2 U R' U R' U' R U' R2 U' D R' U R D'",
      "R2 u R' U R' U' R u' R2 y' R' U R",
      "R U2 R' U' F' R U R2 U' R' F R U R2 U2 R'",
    ],
    recognise: {
      en: "Headlights on the left; the front has a pair at its right end.",
      ru: "Фары слева, спереди пара у правого края.",
      check: (d) =>
        lights(d, "L") &&
        pair(d, "F", "right") &&
        mixed(d, "R") &&
        mixed(d, "B"),
    },
  },
  {
    label: "Gb",
    algs: [
      "R' U' R U D' R2 U R' U R U' R U' R2 D",
      "F' U' F R2 u R' U R U' R u' R2",
      "R' d' F R2 u R' U R U' R u' R2",
    ],
    recognise: {
      en: "Headlights at the back; the front has a pair at its right end.",
      ru: "Фары сзади, спереди пара у правого края.",
      check: (d) =>
        lights(d, "B") &&
        pair(d, "F", "right") &&
        mixed(d, "R") &&
        mixed(d, "L"),
    },
  },
  {
    label: "Gc",
    algs: [
      "R2 U' R U' R U R' U R2 U D' R U' R' D",
      "R2 u' R U' R U R' u R2 y R U' R'",
      "R2 F2 R U2 R U2 R' F R U R' U' R' F R2",
    ],
    recognise: {
      en: "Headlights on the left; the back has a pair next to the right side.",
      ru: "Фары слева, сзади пара у правой стороны.",
      check: (d) =>
        lights(d, "L") &&
        pair(d, "B", "left") &&
        mixed(d, "F") &&
        mixed(d, "R"),
    },
  },
  {
    label: "Gd",
    algs: [
      "R U R' U' D R2 U' R U' R' U R' U R2 D'",
      "R U R' y' R2 u' R U' R' U R' u R2",
      "f R f' R2 u' R U' R' U R' u R2",
    ],
    recognise: {
      en: "Headlights on the left; the right side has a pair next to the front.",
      ru: "Фары слева, справа пара у передней стороны.",
      check: (d) =>
        lights(d, "L") &&
        pair(d, "R", "left") &&
        mixed(d, "F") &&
        mixed(d, "B"),
    },
  },
  {
    label: "H",
    algs: [
      "M2 U M2 U2 M2 U M2",
      "M2 U' M2 U2 M2 U' M2",
      "R2 U2 R U2 R2 U2 R2 U2 R U2 R2",
    ],
    recognise: {
      en: "Headlights on all four sides, each edge the opposite colour of its corners.",
      ru: "Фары на всех четырёх сторонах, ребро между ними противоположного цвета.",
      check: (d) => SIDES.every((s) => lightsOpposite(d, s)),
    },
  },
  {
    label: "Ja",
    algs: [
      "x R2 F R F' R U2 r' U r U2 x'",
      "L' U' L F L' U' L U L F' L2 U L",
      "R' U L' U2 R U' R' U2 R L",
      "R' U2 R U R' U2 L U' R U L'",
    ],
    recognise: {
      en: "A bar in front. The right side's pair touches the bar.",
      ru: "Полоса спереди. Пара справа примыкает к полосе.",
      check: (d) => bar(d, "F") && pair(d, "R", "left"),
    },
  },
  {
    label: "Jb",
    algs: [
      "R U R' F' R U R' U' R' F R2 U' R'",
      "R U2 R' U' R U2 L' U R' U' L",
      "L' U R U' L U2 R' U R U2 R'",
    ],
    recognise: {
      en: "A bar on the left. The front's pair is at its far end from the bar.",
      ru: "Полоса слева. Пара спереди у дальнего от полосы края.",
      check: (d) => bar(d, "L") && pair(d, "F", "right"),
    },
  },
  {
    label: "Na",
    algs: [
      "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'",
      "L U' R U2 L' U R' L U' R U2 L' U R'",
      "z D R' U R2 D' R D U' R' U R2 D' R U' R z'",
    ],
    recognise: {
      en: "A pair on every side, each at its right end.",
      ru: "Пара на каждой стороне, везде у правого края.",
      check: (d) => SIDES.every((s) => pair(d, s, "right")),
    },
  },
  {
    label: "Nb",
    algs: [
      "R' U R U' R' F' U' F R U R' F R' F' R U' R",
      "R' U L' U2 R U' L R' U L' U2 R U' L",
      "z U' R D' R2 U R' D U' R D' R2 U R' D z'",
    ],
    recognise: {
      en: "A pair on every side, each at its left end.",
      ru: "Пара на каждой стороне, везде у левого края.",
      check: (d) => SIDES.every((s) => pair(d, s, "left")),
    },
  },
  {
    label: "Ra",
    algs: [
      "R U' R' U' R U R D R' U' R D' R' U2 R'",
      "R U R' F' R U2 R' U2 R' F R U R U2 R'",
      "L U2 L' U2 L F' L' U' L U L F L2",
    ],
    recognise: {
      en: "Headlights on the left; the front has a pair next to them.",
      ru: "Фары слева, спереди пара рядом с ними.",
      check: (d) =>
        lights(d, "L") &&
        pair(d, "F", "left") &&
        mixed(d, "R") &&
        mixed(d, "B"),
    },
  },
  {
    label: "Rb",
    algs: [
      "R2 F R U R U' R' F' R U2 R' U2 R",
      "R' U2 R U2 R' F R U R' U' R' F' R2",
      "R' U2 R' D' R U R' D R U R U' R' U' R",
    ],
    recognise: {
      en: "Headlights in front; the left side has a pair next to them.",
      ru: "Фары спереди, слева пара рядом с ними.",
      check: (d) =>
        lights(d, "F") &&
        pair(d, "L", "right") &&
        mixed(d, "R") &&
        mixed(d, "B"),
    },
  },
  {
    label: "T",
    algs: [
      "R U R' U' R' F R2 U' R' U' R U R' F'",
      "R U R' U' R2 D R' U R D' R2 U' R U' R'",
    ],
    recognise: {
      en: "Headlights on the left; the front and the back each have a pair next to them.",
      ru: "Фары слева, спереди и сзади по паре рядом с ними.",
      check: (d) =>
        lights(d, "L") && pair(d, "F", "left") && pair(d, "B", "right"),
    },
  },
  {
    label: "Ua",
    algs: [
      "M2 U M U2 M' U M2",
      "R U' R U R U R U' R' U' R2",
      "R2 U' R' U' R U R U R U' R",
    ],
    recognise: {
      en: "A bar at the back, headlights on the other sides. The front edge has the colour of the right side's corners.",
      ru: "Полоса сзади, на остальных сторонах фары. Переднее ребро цвета углов справа.",
      check: (d) =>
        bar(d, "B") &&
        lights(d, "F") &&
        lights(d, "R") &&
        lights(d, "L") &&
        d[10] === d[12],
    },
  },
  {
    label: "Ub",
    algs: [
      "M2 U' M U2 M' U' M2",
      "R2 U R U R' U' R' U' R' U R'",
      "R' U R' U' R' U' R' U R U R2",
    ],
    recognise: {
      en: "A bar at the back, headlights on the other sides. The front edge has the colour of the left side's corners.",
      ru: "Полоса сзади, на остальных сторонах фары. Переднее ребро цвета углов слева.",
      check: (d) =>
        bar(d, "B") &&
        lights(d, "F") &&
        lights(d, "R") &&
        lights(d, "L") &&
        d[10] === d[20],
    },
  },
  {
    label: "V",
    algs: [
      "R' U R' U' y R' F' R2 U' R' U R' F R F",
      "R' U R' d' R' F' R2 U' R' U R' F R F",
      "R U' R U R' D R D' R U' D R2 U R2 D' R2",
    ],
    recognise: {
      en: "Around the front left corner both sides show a pair; no side has headlights.",
      ru: "У переднего левого угла с обеих сторон по паре, фар нет.",
      check: (d) =>
        pair(d, "F", "left") &&
        pair(d, "L", "right") &&
        SIDES.every((s) => !lights(d, s)),
    },
  },
  {
    label: "Y",
    algs: [
      "F R U' R' U' R U R' F' R U R' U' R' F R F'",
      "F R' F R2 U' R' U' R U R' F' R U R' U' F'",
      "R2 U' R2 U' R2 U y' R U R' B2 R U' R'",
    ],
    recognise: {
      en: "Two pairs that do not meet: the front's at the left, the right side's at the back. No headlights.",
      ru: "Две пары, которые не сходятся: спереди у левого края, справа у задней стороны. Фар нет.",
      check: (d) =>
        pair(d, "F", "left") &&
        pair(d, "R", "right") &&
        SIDES.every((s) => !lights(d, s)),
    },
  },
  {
    label: "Z",
    algs: [
      "M' U M2 U M2 U M' U2 M2",
      "M2 U M2 U M' U2 M2 U2 M'",
      "R' U' R U' R U R U' R' U R U R2 U' R'",
    ],
    recognise: {
      en: "Headlights on all four sides, each edge the colour of a neighbouring side.",
      ru: "Фары на всех четырёх сторонах, ребро между ними цвета соседней стороны.",
      check: (d) => SIDES.every((s) => lights(d, s) && !lightsOpposite(d, s)),
    },
  },
];
