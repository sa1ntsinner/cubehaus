/**
 * COLL candidates written from memory: the corner algorithms for a cross on top that
 * cubers commonly use, without saying which COLL case each one is. The data build finds
 * the case each solves (from its inverse) and verifies it there; most of the set's
 * candidates come from our own search (coll-search.json, search.ts).
 */
export const COLL_WRITTEN: readonly string[] = [
  "R U R' U R U2 R'",
  "R U2 R' U' R U' R'",
  "R' U' R U' R' U2 R",
  "R' U2 R U R' U R",
  "R U2 R' U' R U R' U' R U' R'",
  "R U R' U R U' R' U R U2 R'",
  "F R U R' U' R U R' U' R U R' U' F'",
  "R U2 R2 U' R2 U' R2 U2 R",
  "R' U2 R2 U R2 U R2 U2 R'",
  "R2 D R' U2 R D' R' U2 R'",
  "R2 D' R U2 R' D R U2 R",
  "r U R' U' r' F R F'",
  "F' r U R' U' r' F R",
  "R U R' U R U' R' U R U' R' U R U2 R'",
  "R' U' R U' R' U R U' R' U R U' R' U2 R",
  "R U2 R' U' R U R' U' R U R' U' R U' R'",
  "F R U' R' U' R U2 R' U' F'",
  "F R U R' U' R U R' U' F' U R U2 R'",
  "R U R' U R U2 R' U R U2 R' U' R U' R'",
  "R' U2 R U R' U R2 U2 R' U' R U' R'",
  "R U2 R' U2 R' F R U R U' R' F'",
  "R' U' R U' R' U2 R2 U R' U R U2 R'",
];
