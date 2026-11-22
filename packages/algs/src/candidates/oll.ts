import { top, up } from "../diagram";
import type { CaseSource } from "./types";

const CROSS = ["UB", "UL", "UR", "UF"];
const CORNERS = ["UBL", "UBR", "UFL", "UFR"];

/**
 * OLL candidates, written from memory of the algorithms cubers commonly use, verified and
 * ranked by the data build like every other set.
 */
export const OLL: readonly CaseSource[] = [
  {
    label: "OLL 1",
    algs: ["R U2 R2 F R F' U2 R' F R F'", "R U B' R B R2 U' R' F R F'"],
    recognise: {
      en: "A dot with no corner up; the top colour makes a bar on the left and one on the right.",
      ru: "Точка, углов сверху нет; верхний цвет полосами слева и справа.",
      check: (d) => top(d) && up(d, "L0", "L1", "L2", "R0", "R1", "R2"),
    },
  },
  {
    label: "OLL 2",
    algs: [
      "F R U R' U' F' f R U R' U' f'",
      "r U r' U2 r U2 R' U2 R U' r'",
      "F R U R' U' S R U R' U' f'",
    ],
    recognise: {
      en: "A dot with no corner up; a bar of the top colour at the back, and the front corners show it on the left and the right.",
      ru: "Точка, углов сверху нет; сзади полоса верхнего цвета, у передних углов он смотрит влево и вправо.",
      check: (d) => top(d) && up(d, "B0", "B1", "B2", "L2", "R0"),
    },
  },
  {
    label: "OLL 3",
    algs: ["f R U R' U' f' U' F R U R' U' F'", "r' R2 U R' U r U2 r' U M'"],
    recognise: {
      en: "A dot with one corner up, the front left. The front right corner's top colour faces the front.",
      ru: "Точка, сверху один угол, передний левый. У переднего правого угла верхний цвет смотрит вперёд.",
      check: (d) => top(d, "UFL") && up(d, "F2"),
    },
  },
  {
    label: "OLL 4",
    algs: ["f R U R' U' f' U F R U R' U' F'", "M U' r U2 r' U' R U' R' M'"],
    recognise: {
      en: "A dot with one corner up, the front right. The front left corner's top colour faces the front.",
      ru: "Точка, сверху один угол, передний правый. У переднего левого угла верхний цвет смотрит вперёд.",
      check: (d) => top(d, "UFR") && up(d, "F0"),
    },
  },
  {
    label: "OLL 5",
    algs: ["r' U2 R U R' U r", "l' U2 L U L' U l"],
    recognise: {
      en: "The front and right edges and the front right corner up, a small square. The back left corner's top colour faces the back.",
      ru: "Сверху переднее и правое рёбра и передний правый угол, маленький квадрат. У заднего левого угла верхний цвет смотрит назад.",
      check: (d) => top(d, "UF", "UR", "UFR") && up(d, "B2"),
    },
  },
  {
    label: "OLL 6",
    algs: ["r U2 R' U' R U' r'", "l U2 L' U' L U' l'"],
    recognise: {
      en: "The back and right edges and the back right corner up, a small square. The front left corner's top colour faces the front.",
      ru: "Сверху заднее и правое рёбра и задний правый угол, маленький квадрат. У переднего левого угла верхний цвет смотрит вперёд.",
      check: (d) => top(d, "UB", "UR", "UBR") && up(d, "F0"),
    },
  },
  {
    label: "OLL 7",
    algs: ["r U R' U R U2 r'", "L' U2 L U L' U l"],
    recognise: {
      en: "The back and left edges and the front left corner up. The front right corner's top colour faces the front.",
      ru: "Сверху заднее и левое рёбра и передний левый угол. У переднего правого угла верхний цвет смотрит вперёд.",
      check: (d) => top(d, "UB", "UL", "UFL") && up(d, "F2"),
    },
  },
  {
    label: "OLL 8",
    algs: ["l' U' L U' L' U2 l", "R U2 R' U2 R' F R F'"],
    recognise: {
      en: "The back and right edges and the front right corner up. The front left corner's top colour faces the front.",
      ru: "Сверху заднее и правое рёбра и передний правый угол. У переднего левого угла верхний цвет смотрит вперёд.",
      check: (d) => top(d, "UB", "UR", "UFR") && up(d, "F0"),
    },
  },
  {
    label: "OLL 9",
    algs: ["R U R' U' R' F R2 U R' U' F'", "L' U' L U' L F' L' F L' U2 L"],
    recognise: {
      en: "The back and left edges and the front right corner up. The front left corner's top colour faces the front, the back right corner's faces the back.",
      ru: "Сверху заднее и левое рёбра и передний правый угол. У переднего левого угла верхний цвет смотрит вперёд, у заднего правого назад.",
      check: (d) => top(d, "UB", "UL", "UFR") && up(d, "F0", "B0"),
    },
  },
  {
    label: "OLL 10",
    algs: ["R U R' U R' F R F' R U2 R'", "R U R' y R' F R U' R' F' R"],
    recognise: {
      en: "The front and left edges and the back right corner up. The front right corner's top colour faces the front, the back left corner's faces the back.",
      ru: "Сверху переднее и левое рёбра и задний правый угол. У переднего правого угла верхний цвет смотрит вперёд, у заднего левого назад.",
      check: (d) => top(d, "UF", "UL", "UBR") && up(d, "F2", "B2"),
    },
  },
  {
    label: "OLL 11",
    algs: ["r U R' U R' F R F' R U2 r'", "M R U R' U R U2 R' U M'"],
    recognise: {
      en: "The front and right edges and the front left corner up. The front right corner's top colour faces the front.",
      ru: "Сверху переднее и правое рёбра и передний левый угол. У переднего правого угла верхний цвет смотрит вперёд.",
      check: (d) => top(d, "UF", "UR", "UFL") && up(d, "F2"),
    },
  },
  {
    label: "OLL 12",
    algs: [
      "F R U R' U' F' U F R U R' U' F'",
      "M' R' U' R U' R' U2 R U' M",
      "r R2 U' R U' R' U2 R U' R r'",
    ],
    recognise: {
      en: "The back and right edges and the back left corner up. The front left corner's top colour faces the front.",
      ru: "Сверху заднее и правое рёбра и задний левый угол. У переднего левого угла верхний цвет смотрит вперёд.",
      check: (d) => top(d, "UB", "UR", "UBL") && up(d, "F0"),
    },
  },
  {
    label: "OLL 13",
    algs: ["F U R U' R2 F' R U R U' R'", "r U' r' U' r U r' F' U F"],
    recognise: {
      en: "A line from left to right and the front left corner up. The front right corner's top colour faces the front.",
      ru: "Линия слева направо и передний левый угол сверху. У переднего правого угла верхний цвет смотрит вперёд.",
      check: (d) => top(d, "UL", "UR", "UFL") && up(d, "F2"),
    },
  },
  {
    label: "OLL 14",
    algs: ["R' F R U R' F' R F U' F'", "r' U r U r' U' r F U' F'"],
    recognise: {
      en: "A line from left to right and the front right corner up. The front left corner's top colour faces the front.",
      ru: "Линия слева направо и передний правый угол сверху. У переднего левого угла верхний цвет смотрит вперёд.",
      check: (d) => top(d, "UL", "UR", "UFR") && up(d, "F0"),
    },
  },
  {
    label: "OLL 15",
    algs: ["r' U' r R' U' R U r' U r", "l' U' l L' U' L U l' U l"],
    recognise: {
      en: "A line from left to right and the front right corner up. The front left corner's top colour faces left.",
      ru: "Линия слева направо и передний правый угол сверху. У переднего левого угла верхний цвет смотрит влево.",
      check: (d) => top(d, "UL", "UR", "UFR") && up(d, "L2"),
    },
  },
  {
    label: "OLL 16",
    algs: ["r U r' R U R' U' r U' r'", "R' F R U R' U' F' R U' R' U2 R"],
    recognise: {
      en: "A line from left to right and the back right corner up. The front right corner's top colour faces right.",
      ru: "Линия слева направо и задний правый угол сверху. У переднего правого угла верхний цвет смотрит вправо.",
      check: (d) => top(d, "UL", "UR", "UBR") && up(d, "R0"),
    },
  },
  {
    label: "OLL 17",
    algs: ["R U R' U R' F R F' U2 R' F R F'", "F R' F' R2 r' U R U' R' U' M'"],
    recognise: {
      en: "A dot with two corners up across the diagonal, the back left and the front right. The front left corner's top colour faces the front.",
      ru: "Точка и два угла сверху по диагонали, задний левый и передний правый. У переднего левого угла верхний цвет смотрит вперёд.",
      check: (d) => top(d, "UBL", "UFR") && up(d, "F0"),
    },
  },
  {
    label: "OLL 18",
    algs: [
      "r U R' U R U2 r2 U' R U' R' U2 r",
      "R U2 R2 F R F' U2 M' U R U' r'",
    ],
    recognise: {
      en: "A dot with both back corners up, and a bar of the top colour in front.",
      ru: "Точка, оба задних угла сверху, спереди полоса верхнего цвета.",
      check: (d) => top(d, "UBL", "UBR") && up(d, "F0", "F1", "F2"),
    },
  },
  {
    label: "OLL 19",
    algs: ["M U R U R' U' M' R' F R F'", "r' R U R U R' U' M' R' F R F'"],
    recognise: {
      en: "A dot with both back corners up; the front corners' top colour faces left and right.",
      ru: "Точка, оба задних угла сверху; у передних углов верхний цвет смотрит влево и вправо.",
      check: (d) => top(d, "UBL", "UBR") && up(d, "L2", "R0"),
    },
  },
  {
    label: "OLL 20",
    algs: ["r U R' U' M2 U R U' R' U' M'", "M' U2 M U2 M' U M U2 M' U2 M"],
    recognise: {
      en: "All four corners up and no edge.",
      ru: "Все четыре угла сверху, рёбер нет.",
      check: (d) => top(d, "UBL", "UBR", "UFL", "UFR"),
    },
  },
  {
    label: "OLL 21",
    algs: ["R U2 R' U' R U R' U' R U' R'", "R U R' U R U' R' U R U2 R'"],
    recognise: {
      en: "A cross with no corner up; the corners' top colour faces left and right.",
      ru: "Крест, углов сверху нет; у углов верхний цвет смотрит влево и вправо.",
      check: (d) => top(d, ...CROSS) && up(d, "L0", "L2", "R0", "R2"),
    },
  },
  {
    label: "OLL 22",
    algs: ["R U2 R2 U' R2 U' R2 U2 R", "f R U R' U' f' F R U R' U' F'"],
    recognise: {
      en: "A cross with no corner up; the left corners' top colour faces left, the right corners' faces the front and the back.",
      ru: "Крест, углов сверху нет; у левых углов верхний цвет смотрит влево, у правых вперёд и назад.",
      check: (d) => top(d, ...CROSS) && up(d, "L0", "L2", "F2", "B0"),
    },
  },
  {
    label: "OLL 23",
    algs: ["R2 D' R U2 R' D R U2 R", "R2 D R' U2 R D' R' U2 R'"],
    recognise: {
      en: "A cross with both back corners up; the front corners' top colour faces the front.",
      ru: "Крест, оба задних угла сверху; у передних углов верхний цвет смотрит вперёд.",
      check: (d) => top(d, ...CROSS, "UBL", "UBR") && up(d, "F0", "F2"),
    },
  },
  {
    label: "OLL 24",
    algs: ["r U R' U' r' F R F'", "L F R' F' L' F R F'"],
    recognise: {
      en: "A cross with both right corners up; the left corners' top colour faces the front and the back.",
      ru: "Крест, оба правых угла сверху; у левых углов верхний цвет смотрит вперёд и назад.",
      check: (d) => top(d, ...CROSS, "UBR", "UFR") && up(d, "F0", "B2"),
    },
  },
  {
    label: "OLL 25",
    algs: ["F' r U R' U' r' F R", "R' F R B' R' F' R B"],
    recognise: {
      en: "A cross with two corners up across the diagonal, the back right and the front left.",
      ru: "Крест и два угла сверху по диагонали, задний правый и передний левый.",
      check: (d) => top(d, ...CROSS, "UBR", "UFL"),
    },
  },
  {
    label: "OLL 26",
    algs: ["R U2 R' U' R U' R'", "L' U' L U' L' U2 L"],
    recognise: {
      en: "A cross with one corner up, the back right. The front left corner's top colour faces the front.",
      ru: "Крест, сверху один угол, задний правый. У переднего левого угла верхний цвет смотрит вперёд.",
      check: (d) => top(d, ...CROSS, "UBR") && up(d, "F0"),
    },
  },
  {
    label: "OLL 27",
    algs: ["R U R' U R U2 R'", "L' U2 L U L' U L"],
    recognise: {
      en: "A cross with one corner up, the front left. The front right corner's top colour faces the front.",
      ru: "Крест, сверху один угол, передний левый. У переднего правого угла верхний цвет смотрит вперёд.",
      check: (d) => top(d, ...CROSS, "UFL") && up(d, "F2"),
    },
  },
  {
    label: "OLL 28",
    algs: ["r U R' U' M U R U' R'", "M' U M U2 M' U M"],
    recognise: {
      en: "All four corners up, the front and right edges up, the back and left edges not.",
      ru: "Все четыре угла сверху, переднее и правое рёбра тоже, заднее и левое нет.",
      check: (d) => top(d, ...CORNERS, "UF", "UR"),
    },
  },
  {
    label: "OLL 29",
    algs: ["R U R' U' R U' R' F' U' F R U R'", "M U R U R' U' R' F R F' M'"],
    recognise: {
      en: "The back and left edges and both right corners up. The front left corner's top colour faces the front.",
      ru: "Сверху заднее и левое рёбра и оба правых угла. У переднего левого угла верхний цвет смотрит вперёд.",
      check: (d) => top(d, "UB", "UL", "UBR", "UFR") && up(d, "F0"),
    },
  },
  {
    label: "OLL 30",
    algs: ["F U R U2 R' U' R U2 R' U' F'", "F R' F R2 U' R' U' R U R' F2"],
    recognise: {
      en: "The back and left edges and both front corners up. The back corners' top colour faces left and right.",
      ru: "Сверху заднее и левое рёбра и оба передних угла. У задних углов верхний цвет смотрит влево и вправо.",
      check: (d) => top(d, "UB", "UL", "UFL", "UFR") && up(d, "L0", "R2"),
    },
  },
  {
    label: "OLL 31",
    algs: ["R' U' F U R U' R' F' R", "S' L' U' L U L F' L' f"],
    recognise: {
      en: "The back and right edges and both right corners up. The left corners' top colour faces the front and the back.",
      ru: "Сверху заднее и правое рёбра и оба правых угла. У левых углов верхний цвет смотрит вперёд и назад.",
      check: (d) => top(d, "UB", "UR", "UBR", "UFR") && up(d, "F0", "B2"),
    },
  },
  {
    label: "OLL 32",
    algs: ["L U F' U' L' U L F L'", "R U B' U' R' U R B R'"],
    recognise: {
      en: "The front and right edges and both right corners up. The left corners' top colour faces the front and the back.",
      ru: "Сверху переднее и правое рёбра и оба правых угла. У левых углов верхний цвет смотрит вперёд и назад.",
      check: (d) => top(d, "UF", "UR", "UBR", "UFR") && up(d, "F0", "B2"),
    },
  },
  {
    label: "OLL 33",
    algs: ["R U R' U' R' F R F'", "F R U' R' U R U R' F'"],
    recognise: {
      en: "A line from left to right and both right corners up. The left corners' top colour faces the front and the back.",
      ru: "Линия слева направо и оба правых угла сверху. У левых углов верхний цвет смотрит вперёд и назад.",
      check: (d) => top(d, "UL", "UR", "UBR", "UFR") && up(d, "F0", "B2"),
    },
  },
  {
    label: "OLL 34",
    algs: ["R U R2 U' R' F R U R U' F'", "R U R' U' B' R' F R F' B"],
    recognise: {
      en: "A line from left to right and both front corners up. The back corners' top colour faces left and right.",
      ru: "Линия слева направо и оба передних угла сверху. У задних углов верхний цвет смотрит влево и вправо.",
      check: (d) => top(d, "UL", "UR", "UFL", "UFR") && up(d, "L0", "R2"),
    },
  },
  {
    label: "OLL 35",
    algs: ["R U2 R2 F R F' R U2 R'", "f R U R' U' f' R U R' U R U2 R'"],
    recognise: {
      en: "The front and right edges with the back left and front right corners up. The front left corner's top colour faces the front.",
      ru: "Сверху переднее и правое рёбра, задний левый и передний правый углы. У переднего левого угла верхний цвет смотрит вперёд.",
      check: (d) => top(d, "UF", "UR", "UBL", "UFR") && up(d, "F0"),
    },
  },
  {
    label: "OLL 36",
    algs: ["L' U' L U' L' U L U L F' L' F", "R' U' R U' R' U R U l U' R' U x"],
    recognise: {
      en: "The front and left edges with the back left and front right corners up. The front left corner's top colour faces the front, the back right corner's faces right.",
      ru: "Сверху переднее и левое рёбра, задний левый и передний правый углы. У переднего левого угла верхний цвет смотрит вперёд, у заднего правого вправо.",
      check: (d) => top(d, "UF", "UL", "UBL", "UFR") && up(d, "F0", "R2"),
    },
  },
  {
    label: "OLL 37",
    algs: ["F R' F' R U R U' R'", "F R U' R' U' R U R' F'"],
    recognise: {
      en: "The back and left edges with the back left and front right corners up. The front left corner's top colour faces the front.",
      ru: "Сверху заднее и левое рёбра, задний левый и передний правый углы. У переднего левого угла верхний цвет смотрит вперёд.",
      check: (d) => top(d, "UB", "UL", "UBL", "UFR") && up(d, "F0"),
    },
  },
  {
    label: "OLL 38",
    algs: ["R U R' U R U' R' U' R' F R F'", "L' U' L F L' U' L U L F' L' U L"],
    recognise: {
      en: "The back and left edges with the back right and front left corners up. The front right corner's top colour faces right.",
      ru: "Сверху заднее и левое рёбра, задний правый и передний левый углы. У переднего правого угла верхний цвет смотрит вправо.",
      check: (d) => top(d, "UB", "UL", "UBR", "UFL") && up(d, "R0"),
    },
  },
  {
    label: "OLL 39",
    algs: ["L F' L' U' L U F U' L'", "R B' R' U' R U B U' R'"],
    recognise: {
      en: "A line from left to right with the back right and front left corners up. The front right corner's top colour faces the front.",
      ru: "Линия слева направо, задний правый и передний левый углы сверху. У переднего правого угла верхний цвет смотрит вперёд.",
      check: (d) => top(d, "UL", "UR", "UBR", "UFL") && up(d, "F2"),
    },
  },
  {
    label: "OLL 40",
    algs: ["R' F R U R' U' F' U R", "L' B L U L' U' B' U L"],
    recognise: {
      en: "A line from left to right with the back left and front right corners up. The front left corner's top colour faces left.",
      ru: "Линия слева направо, задний левый и передний правый углы сверху. У переднего левого угла верхний цвет смотрит влево.",
      check: (d) => top(d, "UL", "UR", "UBL", "UFR") && up(d, "L2"),
    },
  },
  {
    label: "OLL 41",
    algs: ["R U R' U R U2 R' F R U R' U' F'", "R U' R' U2 R U y R U' R' U' F'"],
    recognise: {
      en: "The front and right edges and both back corners up. The front corners' top colour faces the front.",
      ru: "Сверху переднее и правое рёбра и оба задних угла. У передних углов верхний цвет смотрит вперёд.",
      check: (d) => top(d, "UF", "UR", "UBL", "UBR") && up(d, "F0", "F2"),
    },
  },
  {
    label: "OLL 42",
    algs: [
      "R' U' R U' R' U2 R F R U R' U' F'",
      "R' F R F' R' F R F' R U R' U' R U R'",
    ],
    recognise: {
      en: "The front and left edges and both back corners up. The front corners' top colour faces the front.",
      ru: "Сверху переднее и левое рёбра и оба задних угла. У передних углов верхний цвет смотрит вперёд.",
      check: (d) => top(d, "UF", "UL", "UBL", "UBR") && up(d, "F0", "F2"),
    },
  },
  {
    label: "OLL 43",
    algs: ["R' U' F' U F R", "f' L' U' L U f"],
    recognise: {
      en: "The back and left edges and both back corners up, and a bar of the top colour in front.",
      ru: "Сверху заднее и левое рёбра и оба задних угла, спереди полоса верхнего цвета.",
      check: (d) => top(d, "UB", "UL", "UBL", "UBR") && up(d, "F0", "F1", "F2"),
    },
  },
  {
    label: "OLL 44",
    algs: ["f R U R' U' f'", "F U R U' R' F'"],
    recognise: {
      en: "The back and left edges and both left corners up, and a bar of the top colour on the right.",
      ru: "Сверху заднее и левое рёбра и оба левых угла, справа полоса верхнего цвета.",
      check: (d) => top(d, "UB", "UL", "UBL", "UFL") && up(d, "R0", "R1", "R2"),
    },
  },
  {
    label: "OLL 45",
    algs: ["F R U R' U' F'", "f U R U' R' f'"],
    recognise: {
      en: "A line from left to right and both right corners up. The left corners' top colour faces left.",
      ru: "Линия слева направо и оба правых угла сверху. У левых углов верхний цвет смотрит влево.",
      check: (d) => top(d, "UL", "UR", "UBR", "UFR") && up(d, "L0", "L2"),
    },
  },
  {
    label: "OLL 46",
    algs: ["R' U' R' F R F' U R", "R' F' U' F R U R' U R"],
    recognise: {
      en: "A line from back to front and both left corners up, and a bar of the top colour on the right.",
      ru: "Линия спереди назад и оба левых угла сверху, справа полоса верхнего цвета.",
      check: (d) => top(d, "UB", "UF", "UBL", "UFL") && up(d, "R0", "R1", "R2"),
    },
  },
  {
    label: "OLL 47",
    algs: ["R' U' R' F R F' R' F R F' U R", "F' L' U' L U L' U' L U F"],
    recognise: {
      en: "The back and right edges up, no corner. The right corners' top colour faces right, the left corners' faces the front and the back.",
      ru: "Сверху заднее и правое рёбра, углов нет. У правых углов верхний цвет смотрит вправо, у левых вперёд и назад.",
      check: (d) => top(d, "UB", "UR") && up(d, "R0", "R2", "F0", "B2"),
    },
  },
  {
    label: "OLL 48",
    algs: ["F R U R' U' R U R' U' F'", "R U2 R' U' R U R' U2 R' F R F'"],
    recognise: {
      en: "The back and left edges up, no corner. The left corners' top colour faces left, the right corners' faces the front and the back.",
      ru: "Сверху заднее и левое рёбра, углов нет. У левых углов верхний цвет смотрит влево, у правых вперёд и назад.",
      check: (d) => top(d, "UB", "UL") && up(d, "L0", "L2", "F2", "B0"),
    },
  },
  {
    label: "OLL 49",
    algs: ["r U' r2 U r2 U r2 U' r", "R B' R2 F R2 B R2 F' R"],
    recognise: {
      en: "The back and right edges up, no corner, and a bar of the top colour on the left. The right corners' top colour faces the front and the back.",
      ru: "Сверху заднее и правое рёбра, углов нет, слева полоса верхнего цвета. У правых углов он смотрит вперёд и назад.",
      check: (d) => top(d, "UB", "UR") && up(d, "L0", "L1", "L2", "F2", "B0"),
    },
  },
  {
    label: "OLL 50",
    algs: ["r' U r2 U' r2 U' r2 U r'", "R' F R2 B' R2 F' R2 B R'"],
    recognise: {
      en: "The front and right edges up, no corner, and a bar of the top colour on the left. The right corners' top colour faces the front and the back.",
      ru: "Сверху переднее и правое рёбра, углов нет, слева полоса верхнего цвета. У правых углов он смотрит вперёд и назад.",
      check: (d) => top(d, "UF", "UR") && up(d, "L0", "L1", "L2", "F2", "B0"),
    },
  },
  {
    label: "OLL 51",
    algs: ["F U R U' R' U R U' R' F'", "f R U R' U' R U R' U' f'"],
    recognise: {
      en: "A line from left to right, no corner up. The right corners' top colour faces right, the left corners' faces the front and the back.",
      ru: "Линия слева направо, углов сверху нет. У правых углов верхний цвет смотрит вправо, у левых вперёд и назад.",
      check: (d) => top(d, "UL", "UR") && up(d, "R0", "R2", "F0", "B2"),
    },
  },
  {
    label: "OLL 52",
    algs: ["R U R' U R U' B U' B' R'", "R' U' R U' R' U y' R' U R B"],
    recognise: {
      en: "A line from back to front, no corner up, and a bar of the top colour on the right. The left corners' top colour faces the front and the back.",
      ru: "Линия спереди назад, углов сверху нет, справа полоса верхнего цвета. У левых углов он смотрит вперёд и назад.",
      check: (d) => top(d, "UB", "UF") && up(d, "R0", "R1", "R2", "F0", "B2"),
    },
  },
  {
    label: "OLL 53",
    algs: ["r' U' R U' R' U R U' R' U2 r", "l' U2 L U L' U' L U L' U l"],
    recognise: {
      en: "The front and right edges up, no corner, and a bar of the top colour on the left. The right corners' top colour faces right.",
      ru: "Сверху переднее и правое рёбра, углов нет, слева полоса верхнего цвета. У правых углов он смотрит вправо.",
      check: (d) => top(d, "UF", "UR") && up(d, "L0", "L1", "L2", "R0", "R2"),
    },
  },
  {
    label: "OLL 54",
    algs: ["r U R' U R U' R' U R U2 r'", "r U2 R' U' R U R' U' R U' r'"],
    recognise: {
      en: "The back and right edges up, no corner, and a bar of the top colour on the left. The right corners' top colour faces right.",
      ru: "Сверху заднее и правое рёбра, углов нет, слева полоса верхнего цвета. У правых углов он смотрит вправо.",
      check: (d) => top(d, "UB", "UR") && up(d, "L0", "L1", "L2", "R0", "R2"),
    },
  },
  {
    label: "OLL 55",
    algs: [
      "R U2 R2 U' R U' R' U2 F R F'",
      "R' F R U R U' R2 F' R2 U' R' U R U R'",
    ],
    recognise: {
      en: "A line from back to front, no corner up, and bars of the top colour on the left and the right.",
      ru: "Линия спереди назад, углов сверху нет, слева и справа полосы верхнего цвета.",
      check: (d) =>
        top(d, "UB", "UF") && up(d, "L0", "L1", "L2", "R0", "R1", "R2"),
    },
  },
  {
    label: "OLL 56",
    algs: [
      "r' U' r U' R' U R U' R' U R r' U r",
      "F R U R' U' R F' r U R' U' r'",
    ],
    recognise: {
      en: "A line from left to right, no corner up; every corner's top colour faces left or right.",
      ru: "Линия слева направо, углов сверху нет; у всех углов верхний цвет смотрит влево или вправо.",
      check: (d) => top(d, "UL", "UR") && up(d, "L0", "L2", "R0", "R2"),
    },
  },
  {
    label: "OLL 57",
    algs: ["R U R' U' M' U R U' r'", "M' U M' U M' U2 M U M U M U2"],
    recognise: {
      en: "All four corners up and a line from left to right; the front and back edges are not up.",
      ru: "Все четыре угла сверху и линия слева направо; переднее и заднее рёбра не сверху.",
      check: (d) => top(d, ...CORNERS, "UL", "UR"),
    },
  },
];
